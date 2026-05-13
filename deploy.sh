#!/bin/bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/luyungeng/FramePicker.git}"
REF="${REF:-}"
NODE_IMAGE="${NODE_IMAGE:-node:20-bullseye}"

DEPLOY_DIR="${DEPLOY_DIR:-$(pwd)}"
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
  REF="$(git ls-remote --symref "$REPO_URL" HEAD 2>/dev/null | awk '/^ref:/ {sub(\"refs/heads/\",\"\",$2); print $2; exit}')"
  if [[ -z "$REF" ]]; then
    REF="main"
  fi
fi

SRC_DIR="$WORKDIR/src"
echo ">>> 克隆仓库 ($REF)..."
if ! git clone --depth 1 --branch "$REF" "$REPO_URL" "$SRC_DIR" >/dev/null 2>&1; then
  if [[ "$REF" != "master" ]]; then
    REF="master"
    git clone --depth 1 --branch "$REF" "$REPO_URL" "$SRC_DIR" >/dev/null
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
cat > "$SRC_DIR/next.config.js" <<'EOF'
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
}

module.exports = nextConfig
EOF

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
$SUDO rm -rf "${DEPLOY_DIR:?}/"*
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

  $SUDO nginx -t >/dev/null
  $SUDO nginx -s reload >/dev/null
fi

echo "==========================================="
echo "部署完成"
echo "静态站点目录: $DEPLOY_DIR"
echo "Nginx 提示：请使用 HTTPS 访问，否则 ffmpeg.wasm 可能无法启用 SharedArrayBuffer"
echo "==========================================="
