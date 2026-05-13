#!/bin/bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/luyungeng/FramePicker.git}"
REF="${REF:-}"
NODE_IMAGE="${NODE_IMAGE:-node:20-bullseye}"

REPO_URL="$(printf "%s" "$REPO_URL" | tr -d '\r`')"

DEPLOY_DIR="${DEPLOY_DIR:-$(pwd)}"
BASE_PATH="${BASE_PATH:-}"
SERVER_NAME="${SERVER_NAME:-_}"
LISTEN_PORT="${LISTEN_PORT:-80}"
NGINX_CONF_NAME="${NGINX_CONF_NAME:-framepicker.conf}"
CONFIGURE_NGINX="${CONFIGURE_NGINX:-1}"
INSTALL_NGINX="${INSTALL_NGINX:-1}"

SUDO=""
if [[ "$(id -u)" != "0" ]]; then
  SUDO="sudo"
fi

WORKDIR="$(mktemp -d /tmp/framepicker-deploy.XXXXXX)"
cleanup() {
  rm -rf "$WORKDIR" || true
}
trap cleanup EXIT

echo "==========================================="
echo "FramePicker 一键部署（静态版）"
echo "部署目录: $DEPLOY_DIR"
echo "站点路径: ${BASE_PATH:-/}"
echo "仓库: $REPO_URL"
echo "==========================================="

echo ">>> 安装基础工具..."
$SUDO yum install -y git curl >/dev/null

RUNTIME=""
if command -v podman >/dev/null 2>&1; then
  RUNTIME="podman"
elif command -v docker >/dev/null 2>&1; then
  RUNTIME="docker"
else
  echo ">>> 未检测到 podman/docker，尝试安装 podman..."
  $SUDO yum install -y podman >/dev/null 2>&1 || true
  if command -v podman >/dev/null 2>&1; then
    RUNTIME="podman"
  else
    echo ">>> podman 安装失败，尝试安装 docker..."
    $SUDO yum install -y docker >/dev/null
    $SUDO systemctl enable docker >/dev/null
    $SUDO systemctl start docker >/dev/null
    RUNTIME="docker"
  fi
fi

if [[ -z "$REF" ]]; then
  REF="master"
fi

SRC_DIR="$WORKDIR/src"
echo ">>> 克隆仓库 ($REF)..."
if ! git clone --depth 1 --branch "$REF" "$REPO_URL" "$SRC_DIR" >/dev/null 2>&1; then
  if [[ "$REF" != "main" ]]; then
    REF="main"
    if ! git clone --depth 1 --branch "$REF" "$REPO_URL" "$SRC_DIR" >/dev/null 2>&1; then
      echo "克隆失败：请检查仓库地址或分支名"
      exit 1
    fi
  else
    echo "克隆失败：请检查仓库地址或分支名"
    exit 1
  fi
fi

echo ">>> 启用 Next 静态导出..."
for cfg in "$SRC_DIR/next.config.js" "$SRC_DIR/next.config.mjs" "$SRC_DIR/next.config.ts"; do
  if [[ -f "$cfg" ]]; then
    mv "$cfg" "$cfg.bak.$(date +%s)"
  fi
done
BASE_PATH_CLEAN="$(printf "%s" "$BASE_PATH" | tr -d '\r')"
if [[ -n "$BASE_PATH_CLEAN" ]]; then
  if [[ "$BASE_PATH_CLEAN" != /* ]]; then
    BASE_PATH_CLEAN="/$BASE_PATH_CLEAN"
  fi
  if [[ "$BASE_PATH_CLEAN" != "/" ]]; then
    BASE_PATH_CLEAN="${BASE_PATH_CLEAN%/}"
  else
    BASE_PATH_CLEAN=""
  fi
fi

if [[ -n "$BASE_PATH_CLEAN" ]]; then
  cat > "$SRC_DIR/next.config.js" <<EOF
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: '${BASE_PATH_CLEAN}',
  assetPrefix: '${BASE_PATH_CLEAN}',
}

module.exports = nextConfig
EOF
else
  cat > "$SRC_DIR/next.config.js" <<'EOF'
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
}

module.exports = nextConfig
EOF
fi

VOLUME_SUFFIX=""
if command -v getenforce >/dev/null 2>&1; then
  ENFORCE_STATE="$(getenforce || true)"
  if [[ "$ENFORCE_STATE" == "Enforcing" ]]; then
    VOLUME_SUFFIX=":Z"
  fi
fi

echo ">>> 使用容器构建静态产物..."
$SUDO "$RUNTIME" run --rm \
  -v "$SRC_DIR":/app$VOLUME_SUFFIX \
  -w /app \
  "$NODE_IMAGE" \
  bash -lc "(npm ci || npm install) && npm run build" || {
    echo "构建失败：容器构建命令执行失败"
    exit 1
  }

if [[ ! -d "$SRC_DIR/out" ]]; then
  echo "构建失败：未找到 out 目录（Next 静态导出失败）"
  echo "提示：正常情况下 next build 会出现 Exporting (x/y) 并生成 out/"
  echo "当前目录内容："
  ls -la "$SRC_DIR" || true
  exit 1
fi

echo ">>> 发布静态文件到部署目录..."
$SUDO mkdir -p "$DEPLOY_DIR"
if [[ -f "$DEPLOY_DIR/deploy.sh" ]]; then
  $SUDO find "$DEPLOY_DIR" -mindepth 1 -maxdepth 1 ! -name "deploy.sh" -exec rm -rf {} +
else
  $SUDO rm -rf "${DEPLOY_DIR:?}/"*
fi
$SUDO cp -a "$SRC_DIR/out/." "$DEPLOY_DIR/"
$SUDO chmod -R a+rX "$DEPLOY_DIR"

if command -v getenforce >/dev/null 2>&1; then
  ENFORCE_STATE="$(getenforce || true)"
  if [[ "$ENFORCE_STATE" == "Enforcing" ]] && command -v chcon >/dev/null 2>&1; then
    $SUDO chcon -R -t httpd_sys_content_t "$DEPLOY_DIR" >/dev/null 2>&1 || true
  fi
fi

if [[ "$INSTALL_NGINX" == "1" ]]; then
  if ! command -v nginx >/dev/null 2>&1; then
    echo ">>> 安装 Nginx..."
    $SUDO yum install -y nginx >/dev/null
  fi
  $SUDO systemctl enable nginx >/dev/null 2>&1 || true
  $SUDO systemctl start nginx >/dev/null 2>&1 || true
fi

if [[ "$CONFIGURE_NGINX" == "1" ]] && [[ -d "/etc/nginx" ]]; then
  echo ">>> 写入 Nginx 配置并重载..."
  $SUDO mkdir -p /etc/nginx/conf.d
  if [[ -n "$BASE_PATH_CLEAN" ]]; then
    PARENT_DIR="$(dirname "$DEPLOY_DIR")"
    $SUDO tee "/etc/nginx/conf.d/$NGINX_CONF_NAME" >/dev/null <<EOF
server {
  listen ${LISTEN_PORT};
  server_name ${SERVER_NAME};

  root ${PARENT_DIR};
  index index.html;

  location = ${BASE_PATH_CLEAN} {
    return 301 ${BASE_PATH_CLEAN}/;
  }

  location ${BASE_PATH_CLEAN}/ {
    try_files \$uri \$uri/ ${BASE_PATH_CLEAN}/index.html;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "credentialless" always;
  }
}
EOF
  else
    $SUDO tee "/etc/nginx/conf.d/$NGINX_CONF_NAME" >/dev/null <<EOF
server {
  listen ${LISTEN_PORT};
  server_name ${SERVER_NAME};

  root ${DEPLOY_DIR};
  index index.html;

  location / {
    try_files \$uri \$uri/ /index.html;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "credentialless" always;
  }
}
EOF
  fi

  $SUDO nginx -t >/dev/null
  $SUDO nginx -s reload >/dev/null
fi

echo "==========================================="
echo "部署完成"
echo "静态站点目录: $DEPLOY_DIR"
echo "Nginx 提示：请使用 HTTPS 访问，否则 ffmpeg.wasm 可能无法启用 SharedArrayBuffer"
echo "==========================================="
