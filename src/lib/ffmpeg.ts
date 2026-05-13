import { FFmpeg } from "@ffmpeg/ffmpeg";

let ffmpeg: FFmpeg | null = null;

const toBlobURLWithTimeout = async (url: string, mimeType: string, timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "force-cache" });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    const blob = await res.blob();
    const typedBlob = new Blob([blob], { type: mimeType });
    return URL.createObjectURL(typedBlob);
  } finally {
    clearTimeout(timeout);
  }
};

export const loadFFmpeg = async (): Promise<FFmpeg> => {
  if (ffmpeg) return ffmpeg;

  const instance = new FFmpeg();

  const localBaseURL =
    typeof window !== "undefined"
      ? new URL("./ffmpeg", window.location.href).toString().replace(/\/$/, "")
      : "";

  const baseURLs = [
    localBaseURL,
    (process.env.NEXT_PUBLIC_FFMPEG_BASE_URL || "").trim(),
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd",
    "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd",
  ]
    .map((s) => s.trim())
    .filter(Boolean) as string[];

  let lastError: unknown = null;
  for (const baseURL of baseURLs) {
    try {
      await instance.load({
        coreURL: await toBlobURLWithTimeout(`${baseURL}/ffmpeg-core.js`, "text/javascript", 30000),
        wasmURL: await toBlobURLWithTimeout(`${baseURL}/ffmpeg-core.wasm`, "application/wasm", 30000),
        workerURL: await toBlobURLWithTimeout(`${baseURL}/ffmpeg-core.worker.js`, "text/javascript", 30000),
      });
      ffmpeg = instance;
      return instance;
    } catch (e) {
      lastError = e;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("FFmpeg load failed.");
};

export const getFFmpeg = () => {
  if (!ffmpeg) {
    throw new Error("FFmpeg not loaded. Call loadFFmpeg first.");
  }
  return ffmpeg;
};
