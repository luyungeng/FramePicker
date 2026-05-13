"use client";

import { useState, useEffect, useRef } from "react";
import { Upload, Video, Image as ImageIcon, Download, Settings, Layers, Scissors, Zap, Loader2, Trash2, Clock, Pipette, CheckCircle2, Circle, Play, Pause, FastForward } from "lucide-react";
import { loadFFmpeg } from "@/lib/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { downloadAsZip, generateSpriteSheet, removeBackground, hexToRgb } from "@/lib/image-utils";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [frames, setFrames] = useState<string[]>([]);
  const [fps, setFps] = useState(30);
  const [exportFormat, setExportFormat] = useState("zip");
  const [spriteFrameWidth, setSpriteFrameWidth] = useState(0);
  const [spriteFrameHeight, setSpriteFrameHeight] = useState(0);
  const [spriteSizeAuto, setSpriteSizeAuto] = useState(true);
  const [bgRemoval, setBgRemoval] = useState("none");
  const [threshold, setThreshold] = useState(30);
  const [bgColorHex, setBgColorHex] = useState("#000000");
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [ffmpegError, setFfmpegError] = useState<string | null>(null);
  const [startTime, setStartTime] = useState("00:00:00");
  const [duration, setDuration] = useState("");
  const [videoDuration, setVideoDuration] = useState(0);
  
  const [selectedFrames, setSelectedFrames] = useState<Set<number>>(new Set());
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewFrameIndex, setPreviewFrameIndex] = useState(0);
  const [previewFps, setPreviewFps] = useState(10);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewTimerRef = useRef<NodeJS.Timeout | null>(null);

  const initFFmpeg = async () => {
    setFfmpegError(null);
    setFfmpegLoaded(false);
    try {
      await Promise.race([
        loadFFmpeg(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("load-timeout")), 30000)),
      ]);
      setFfmpegLoaded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFfmpegError(message);
    }
  };

  useEffect(() => {
    initFFmpeg();
  }, []);

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setVideoUrl(null);
      setFrames([]);
      setSelectedFrames(new Set());
      setVideoDuration(0);
      setSpriteSizeAuto(true);
      setSpriteFrameWidth(0);
      setSpriteFrameHeight(0);
    }
  }, [file]);

  useEffect(() => {
    if (!spriteSizeAuto) return;
    if (frames.length === 0) return;
    const img = new Image();
    img.onload = () => {
      setSpriteFrameWidth(img.width);
      setSpriteFrameHeight(img.height);
    };
    img.src = frames[0];
  }, [frames, spriteSizeAuto]);

  useEffect(() => {
    if (isPreviewPlaying && frames.length > 0) {
      const selectedIndices = Array.from(selectedFrames).sort((a, b) => a - b);
      if (selectedIndices.length === 0) {
        setIsPreviewPlaying(false);
        return;
      }

      previewTimerRef.current = setInterval(() => {
        setPreviewFrameIndex((prev) => {
          const currentIndexInSelected = selectedIndices.indexOf(prev);
          const nextIndexInSelected = (currentIndexInSelected + 1) % selectedIndices.length;
          return selectedIndices[nextIndexInSelected];
        });
      }, 1000 / previewFps);
    } else {
      if (previewTimerRef.current) clearInterval(previewTimerRef.current);
    }

    return () => {
      if (previewTimerRef.current) clearInterval(previewTimerRef.current);
    };
  }, [isPreviewPlaying, frames, selectedFrames, previewFps]);

  const toggleFrameSelection = (index: number) => {
    const newSelection = new Set(selectedFrames);
    if (newSelection.has(index)) {
      newSelection.delete(index);
    } else {
      newSelection.add(index);
    }
    setSelectedFrames(newSelection);
    
    if (!newSelection.has(previewFrameIndex)) {
      const remaining = Array.from(newSelection).sort((a, b) => a - b);
      if (remaining.length > 0) {
        setPreviewFrameIndex(remaining[0]);
      }
    }
  };

  const selectAllFrames = () => {
    setSelectedFrames(new Set(frames.keys()));
  };

  const deselectAllFrames = () => {
    setSelectedFrames(new Set());
    setIsPreviewPlaying(false);
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setVideoDuration(videoRef.current.duration);
      setDuration(videoRef.current.duration.toFixed(2));
    }
  };

  const openEyeDropper = async () => {
    if (typeof window !== "undefined" && "EyeDropper" in window) {
      try {
        const eyeDropper = new (window as any).EyeDropper();
        const result = await eyeDropper.open();
        setBgColorHex(result.sRGBHex);
        setBgRemoval("threshold");
      } catch (e) {
        console.error("EyeDropper failed:", e);
      }
    } else {
      alert("您的浏览器不支持吸色器功能，请手动输入颜色或使用现代浏览器（如 Chrome/Edge）。");
    }
  };

  const extractFrames = async () => {
    if (!file || !ffmpegLoaded) return;

    setIsProcessing(true);
    setProgress(0);
    setFrames([]);

    try {
      const ffmpeg = await loadFFmpeg();
      const inputName = "input.mp4";
      const outputPattern = "frame_%04d.png";

      await ffmpeg.writeFile(inputName, await fetchFile(file));

      ffmpeg.on("progress", ({ progress }) => {
        setProgress(Math.round(progress * 100));
      });

      const args = [
        "-ss", startTime,
        "-t", duration || videoDuration.toString(),
        "-i", inputName,
        "-vf", `fps=${fps}`,
        "-f", "image2",
        outputPattern
      ];

      await ffmpeg.exec(args);

      const files = await ffmpeg.listDir(".");
      const frameFiles = files
        .filter(f => f.name.startsWith("frame_") && f.name.endsWith(".png"))
        .sort((a, b) => a.name.localeCompare(b.name));

      let frameUrls = await Promise.all(
        frameFiles.map(async (f) => {
          const data = await ffmpeg.readFile(f.name);
          const blob = new Blob([data as any], { type: "image/png" });
          return URL.createObjectURL(blob);
        })
      );

      if (bgRemoval === "threshold") {
        const rgb = hexToRgb(bgColorHex);
        frameUrls = await Promise.all(
          frameUrls.map(url => removeBackground(url, threshold, rgb))
        );
      }

      setFrames(frameUrls);
      setSelectedFrames(new Set(frameUrls.keys()));
      
      await ffmpeg.deleteFile(inputName);
      for (const f of frameFiles) {
        await ffmpeg.deleteFile(f.name);
      }
    } catch (error) {
      console.error("Extraction failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (frames.length === 0 || selectedFrames.size === 0) return;

    const framesToExport = Array.from(selectedFrames)
      .sort((a, b) => a - b)
      .map(index => frames[index]);

    if (exportFormat === "zip") {
      await downloadAsZip(framesToExport, "frame-picker-sequence.zip");
    } else if (exportFormat === "spritesheet") {
      const blob = await generateSpriteSheet(framesToExport, {
        frameWidth: spriteFrameWidth > 0 ? spriteFrameWidth : undefined,
        frameHeight: spriteFrameHeight > 0 ? spriteFrameHeight : undefined,
      });
      if (blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "spritesheet.png";
        link.click();
        URL.revokeObjectURL(url);
      }
    } else if (exportFormat === "gif") {
      if (!file || !ffmpegLoaded) return;
      setIsProcessing(true);
      try {
        const ffmpeg = await loadFFmpeg();
        const inputName = "input.mp4";
        const outputName = "output.gif";
        await ffmpeg.writeFile(inputName, await fetchFile(file));
        
        await ffmpeg.exec([
          "-ss", startTime,
          "-t", duration || videoDuration.toString(),
          "-i", inputName,
          "-vf", `fps=${fps},scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
          outputName
        ]);

        const data = await ffmpeg.readFile(outputName);
        const blob = new Blob([data as any], { type: "image/gif" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "animation.gif";
        link.click();
        URL.revokeObjectURL(url);
        
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
      } catch (error) {
        console.error("GIF generation failed:", error);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      {/* Header */}
      <header className="border-b bg-white dark:bg-slate-900 sticky top-0 z-10">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg">
              <ImageIcon className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">FramePicker</span>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#" className="text-sm font-medium hover:text-blue-600 transition-colors">功能</a>
            <a href="#" className="text-sm font-medium hover:text-blue-600 transition-colors">教程</a>
          </nav>
          <div className="flex items-center gap-4">
            {!ffmpegLoaded && !ffmpegError && (
              <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                <Loader2 className="w-3 h-3 animate-spin" />
                正在加载核心组件...
              </div>
            )}
            {!ffmpegLoaded && ffmpegError && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">
                <span className="font-bold">核心组件加载失败</span>
                <button
                  onClick={initFFmpeg}
                  className="text-red-700 underline font-bold"
                >
                  重试
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <section className="flex-1 py-8 md:py-12">
        <div className="container mx-auto px-4">
          {!file ? (
            <div className="max-w-4xl mx-auto text-center">
              <h1 className="text-4xl md:text-6xl font-extrabold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 leading-tight">
                视频秒转序列帧，<br/>专为游戏特效设计
              </h1>
              <p className="text-lg text-slate-600 dark:text-slate-400 mb-12 max-w-2xl mx-auto">
                浏览器端在线视频转透明底 PNG 序列、精灵图集或 GIF 动图。<br/>
                <span className="font-semibold text-slate-800 dark:text-slate-200">本地处理，隐私安全，无需上传。</span>
              </p>

              <div className="bg-white dark:bg-slate-900 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-3xl p-16 hover:border-blue-500 transition-all group cursor-pointer shadow-xl shadow-blue-500/5">
                <input
                  type="file"
                  className="hidden"
                  id="video-upload"
                  accept="video/*"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <label htmlFor="video-upload" className="cursor-pointer flex flex-col items-center">
                  <div className="w-20 h-20 bg-blue-50 dark:bg-blue-900/20 text-blue-600 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-transform">
                    <Upload className="w-10 h-10" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3">点击或拖拽视频文件</h3>
                  <p className="text-slate-500 text-sm mb-6">支持 MP4, MOV, WEBM 等格式，最大 200MB</p>
                  <div className="flex gap-4 text-xs font-medium text-slate-400">
                    <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> 极速转换</span>
                    <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> 自动图集</span>
                  </div>
                </label>
              </div>

              {/* Features Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-24">
                <div className="p-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 hover:shadow-xl transition-shadow text-left">
                  <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-xl flex items-center justify-center mb-6">
                    <Scissors className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold mb-3">精准提取</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">
                    支持 1-60fps 自定义帧率，可精确选择时间范围，满足游戏引擎对每一帧的需求。
                  </p>
                </div>
                <div className="p-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 hover:shadow-xl transition-shadow text-left">
                  <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 text-purple-600 rounded-xl flex items-center justify-center mb-6">
                    <Layers className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold mb-3">图集生成</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">
                    自动将序列帧打包成紧凑的精灵图集（Sprite Sheet），并导出 JSON/XML 配置文件。
                  </p>
                </div>
                <div className="p-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 hover:shadow-xl transition-shadow text-left">
                  <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-xl flex items-center justify-center mb-6">
                    <Zap className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold mb-3">本地处理</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">
                    基于 ffmpeg.wasm 技术，所有视频处理均在浏览器本地完成，不消耗流量且保护隐私。
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-6xl mx-auto bg-white dark:bg-slate-900 border rounded-3xl shadow-2xl overflow-hidden flex flex-col lg:flex-row min-h-[700px]">
              {/* Left: Preview & Results */}
              <div className="flex-1 flex flex-col border-r dark:border-slate-800">
                <div className="p-6 border-b dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white dark:bg-slate-700 rounded-xl border shadow-sm">
                      <Video className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-bold text-sm truncate max-w-[200px] md:max-w-[400px]">{file.name}</p>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">{(file.size / 1024 / 1024).toFixed(2)} MB • {file.type}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setFile(null)}
                    className="p-2 text-slate-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="更换视频"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 p-6 flex flex-col gap-8 overflow-y-auto">
                  {/* Top Section: Video & Preview Animation */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Video Preview */}
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                          <Video className="w-3 h-3" />
                          原视频预览
                        </h3>
                      </div>
                      <div className="aspect-video bg-slate-900 rounded-2xl overflow-hidden shadow-2xl relative group border border-slate-800">
                        {videoUrl && (
                          <video 
                            ref={videoRef}
                            src={videoUrl} 
                            className="w-full h-full object-contain"
                            controls
                            onLoadedMetadata={handleLoadedMetadata}
                          />
                        )}
                      </div>
                    </div>

                    {/* Animation Preview */}
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                          <Play className="w-3 h-3 text-emerald-500" />
                          序列帧预览 (已选 {selectedFrames.size} 帧)
                        </h3>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">
                            {previewFps} FPS
                          </span>
                        </div>
                      </div>
                      <div className="aspect-video bg-slate-900 rounded-2xl overflow-hidden shadow-2xl relative border border-slate-800 flex items-center justify-center bg-[url('https://www.transparenttextures.com/patterns/checkerboard.png')]">
                        {frames.length > 0 && selectedFrames.size > 0 ? (
                          <div className="relative w-full h-full flex items-center justify-center">
                            <img 
                              src={frames[previewFrameIndex]} 
                              alt="Preview" 
                              className="max-w-full max-h-full object-contain"
                            />
                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
                              <button 
                                onClick={() => setIsPreviewPlaying(!isPreviewPlaying)}
                                className="text-white hover:text-emerald-400 transition-colors"
                              >
                                {isPreviewPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
                              </button>
                              <div className="w-px h-4 bg-white/20" />
                              <div className="flex items-center gap-2">
                                <FastForward className="w-3 h-3 text-white/60" />
                                <input 
                                  type="range" 
                                  min="1" 
                                  max="60" 
                                  value={previewFps}
                                  onChange={(e) => setPreviewFps(parseInt(e.target.value))}
                                  className="w-20 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                />
                              </div>
                            </div>
                            <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md px-2 py-1 rounded text-[10px] font-mono text-white border border-white/10">
                              FRAME {previewFrameIndex + 1}
                            </div>
                          </div>
                        ) : (
                          <div className="text-center p-6">
                            <ImageIcon className="w-8 h-8 text-slate-700 mb-2 mx-auto opacity-20" />
                            <p className="text-xs text-slate-500">请先提取帧并选中至少一帧</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Frames Results Grid */}
                  <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-4">
                        <h3 className="text-sm font-bold flex items-center gap-2">
                          <Layers className="w-4 h-4 text-blue-600" />
                          提取结果 
                          {frames.length > 0 && (
                            <span className="bg-blue-100 text-blue-600 text-[10px] px-2 py-0.5 rounded-full">
                              {frames.length} 帧
                            </span>
                          )}
                        </h3>
                        {frames.length > 0 && (
                          <div className="flex items-center gap-2 border-l pl-4 dark:border-slate-800">
                            <button 
                              onClick={selectAllFrames}
                              className="text-[10px] font-bold text-slate-500 hover:text-blue-600 transition-colors uppercase tracking-tight"
                            >
                              全选
                            </button>
                            <span className="text-slate-300">|</span>
                            <button 
                              onClick={deselectAllFrames}
                              className="text-[10px] font-bold text-slate-500 hover:text-red-500 transition-colors uppercase tracking-tight"
                            >
                              取消全选
                            </button>
                          </div>
                        )}
                      </div>
                      {frames.length > 0 && (
                        <button 
                          onClick={handleDownload}
                          disabled={selectedFrames.size === 0}
                          className="text-xs text-blue-600 disabled:text-slate-300 font-bold flex items-center gap-1 hover:underline"
                        >
                          <Download className="w-3 h-3" />
                          导出已选 ({selectedFrames.size})
                        </button>
                      )}
                    </div>
                    
                    {frames.length > 0 ? (
                      <div className="grid [grid-template-columns:repeat(auto-fill,minmax(84px,1fr))] gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 max-h-[400px] overflow-y-auto">
                        {frames.map((url, i) => (
                          <div 
                            key={i} 
                            onClick={() => toggleFrameSelection(i)}
                            className={`aspect-square rounded-xl border-2 overflow-hidden relative group shadow-sm hover:shadow-md transition-all cursor-pointer ${
                              selectedFrames.has(i) 
                              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" 
                              : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 opacity-60 grayscale-[0.5]"
                            }`}
                          >
                            <img src={url} alt={`Frame ${i}`} className="w-full h-full object-contain" />
                            <div className={`absolute top-1.5 right-1.5 transition-transform ${selectedFrames.has(i) ? "scale-110" : "scale-100 opacity-0 group-hover:opacity-100"}`}>
                              {selectedFrames.has(i) 
                                ? <CheckCircle2 className="w-4 h-4 text-blue-500 fill-white" /> 
                                : <Circle className="w-4 h-4 text-slate-400 fill-white" />
                              }
                            </div>
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity backdrop-blur-[1px]">
                              <span className="text-[10px] text-white font-mono font-bold">#{i+1}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex-1 min-h-[300px] flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl text-slate-400 bg-slate-50/50 dark:bg-slate-800/20">
                        {isProcessing ? (
                          <div className="flex flex-col items-center gap-4">
                            <div className="relative">
                              <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
                              <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-blue-600">
                                {progress}%
                              </div>
                            </div>
                            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">正在处理视频帧...</p>
                            <p className="text-xs text-slate-400">正在浏览器本地解析，请勿关闭页面</p>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center text-center p-8">
                            <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-4">
                              <ImageIcon className="w-8 h-8 opacity-20" />
                            </div>
                            <p className="text-sm font-bold mb-1">等待处理</p>
                            <p className="text-xs max-w-[200px]">在右侧面板配置参数后，点击“开始处理”即可生成序列帧</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: Controls Sidebar */}
              <div className="w-full lg:w-96 bg-slate-50/50 dark:bg-slate-900/50 flex flex-col">
                <div className="p-6 border-b dark:border-slate-800">
                  <h2 className="font-bold flex items-center gap-2">
                    <Settings className="w-5 h-5 text-blue-600" />
                    处理面板
                  </h2>
                </div>

                <div className="flex-1 p-6 overflow-y-auto space-y-8 text-left">
                  {/* Extraction Settings */}
                  <section>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">提取设置</h4>
                      <Zap className="w-3 h-3 text-blue-500" />
                    </div>
                    <div className="space-y-6">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-sm font-bold">帧率 (FPS)</label>
                          <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded">{fps}</span>
                        </div>
                        <input 
                          type="range" 
                          min="1" 
                          max="60" 
                          value={fps}
                          onChange={(e) => setFps(parseInt(e.target.value))}
                          className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600" 
                        />
                        <div className="flex justify-between mt-2 text-[10px] text-slate-400 font-medium">
                          <span>1 FPS</span>
                          <span>30 FPS</span>
                          <span>60 FPS</span>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <Clock className="w-4 h-4 text-slate-400" />
                          <label className="text-sm font-bold">提取范围 (秒)</label>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 shadow-sm">
                            <span className="text-[10px] text-slate-400 block mb-1 uppercase font-bold tracking-tighter">起始时间</span>
                            <input 
                              type="text" 
                              value={startTime}
                              onChange={(e) => setStartTime(e.target.value)}
                              placeholder="00:00:00"
                              className="bg-transparent w-full text-sm font-mono font-bold outline-none"
                            />
                          </div>
                          <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 shadow-sm">
                            <span className="text-[10px] text-slate-400 block mb-1 uppercase font-bold tracking-tighter">持续时长</span>
                            <input 
                              type="text" 
                              value={duration}
                              onChange={(e) => setDuration(e.target.value)}
                              placeholder={videoDuration.toFixed(2)}
                              className="bg-transparent w-full text-sm font-mono font-bold outline-none"
                            />
                          </div>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-2 font-medium italic">* 留空则提取至视频结束</p>
                      </div>
                    </div>
                  </section>

                  {/* Background Processing */}
                  <section>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">背景处理</h4>
                      <Layers className="w-3 h-3 text-purple-500" />
                    </div>
                    <div className="space-y-3">
                      <button 
                        onClick={() => setBgRemoval("none")}
                        className={`w-full text-left px-4 py-3 text-sm rounded-xl font-bold transition-all border ${
                          bgRemoval === "none" 
                          ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-500/20" 
                          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-blue-500 shadow-sm"
                        }`}
                      >
                        保持原样 (黑色背景)
                      </button>
                      <div className={`p-4 rounded-xl border transition-all shadow-sm ${
                        bgRemoval === "threshold"
                        ? "bg-purple-50 dark:bg-purple-900/10 border-purple-500"
                        : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-purple-500"
                      }`}>
                        <button 
                          onClick={() => setBgRemoval("threshold")}
                          className="w-full text-left text-sm font-bold flex items-center justify-between mb-3"
                        >
                          阈值去背景 (透明底)
                          {bgRemoval === "threshold" && <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />}
                        </button>
                        {bgRemoval === "threshold" && (
                          <div className="space-y-4 animate-in fade-in slide-in-from-top-2 pt-2 border-t border-purple-100 dark:border-purple-900/30">
                            {/* Color Selection */}
                            <div className="space-y-2">
                              <label className="text-[11px] font-bold text-slate-500">背景颜色</label>
                              <div className="flex items-center gap-2">
                                <input 
                                  type="color"
                                  value={bgColorHex}
                                  onChange={(e) => setBgColorHex(e.target.value)}
                                  className="w-8 h-8 rounded-lg border shadow-sm shrink-0 cursor-pointer overflow-hidden p-0"
                                />
                                <input 
                                  type="text"
                                  value={bgColorHex}
                                  onChange={(e) => setBgColorHex(e.target.value)}
                                  className="flex-1 bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-mono font-bold outline-none"
                                />
                                <button 
                                  onClick={openEyeDropper}
                                  className="p-2 bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
                                  title="从屏幕吸取颜色"
                                >
                                  <Pipette className="w-4 h-4 text-purple-600" />
                                </button>
                              </div>
                              <p className="text-[9px] text-slate-400 italic">提示：点击吸管图标可从视频画面直接吸色</p>
                            </div>

                            {/* Threshold Slider */}
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <label className="text-[11px] font-bold text-slate-500">敏感度 (Threshold)</label>
                                <span className="text-[11px] font-mono font-bold text-purple-600">{threshold}</span>
                              </div>
                              <input 
                                type="range" 
                                min="1" 
                                max="100" 
                                value={threshold}
                                onChange={(e) => setThreshold(parseInt(e.target.value))}
                                className="w-full h-1.5 bg-purple-200 dark:bg-purple-900/30 rounded-lg appearance-none cursor-pointer accent-purple-600" 
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>

                  {/* Export Options */}
                  <section>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">导出选项</h4>
                      <Download className="w-3 h-3 text-emerald-500" />
                    </div>
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: "zip", label: "序列帧", sub: "ZIP" },
                          { id: "spritesheet", label: "精灵图", sub: "PNG" },
                          { id: "gif", label: "动图", sub: "GIF" }
                        ].map((fmt) => (
                          <button
                            key={fmt.id}
                            onClick={() => setExportFormat(fmt.id)}
                            className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all shadow-sm ${
                              exportFormat === fmt.id
                              ? "bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-500/20"
                              : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-emerald-500"
                            }`}
                          >
                            <span className="text-[11px] font-bold">{fmt.label}</span>
                            <span className={`text-[9px] font-black opacity-60 ${exportFormat === fmt.id ? "text-white" : "text-slate-400"}`}>{fmt.sub}</span>
                          </button>
                        ))}
                      </div>
                      {exportFormat === "spritesheet" && (
                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-600 dark:text-slate-200">单格大小 (像素)</span>
                            <button
                              type="button"
                              onClick={() => setSpriteSizeAuto(true)}
                              className="text-[10px] font-bold text-slate-500 hover:text-blue-600 transition-colors uppercase tracking-tight"
                            >
                              使用原图尺寸
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
                              <span className="text-[10px] text-slate-400 block mb-1 uppercase font-bold tracking-tighter">宽度</span>
                              <input
                                type="number"
                                min={1}
                                value={spriteFrameWidth || ""}
                                onChange={(e) => {
                                  setSpriteSizeAuto(false);
                                  const v = e.target.value === "" ? 0 : Math.max(1, Math.floor(Number(e.target.value)));
                                  setSpriteFrameWidth(v);
                                }}
                                className="w-full text-sm font-mono font-bold bg-transparent outline-none text-slate-800 dark:text-slate-100"
                                placeholder="自动"
                              />
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
                              <span className="text-[10px] text-slate-400 block mb-1 uppercase font-bold tracking-tighter">高度</span>
                              <input
                                type="number"
                                min={1}
                                value={spriteFrameHeight || ""}
                                onChange={(e) => {
                                  setSpriteSizeAuto(false);
                                  const v = e.target.value === "" ? 0 : Math.max(1, Math.floor(Number(e.target.value)));
                                  setSpriteFrameHeight(v);
                                }}
                                className="w-full text-sm font-mono font-bold bg-transparent outline-none text-slate-800 dark:text-slate-100"
                                placeholder="自动"
                              />
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            导出精灵图时会将每帧缩放到指定宽高，并按网格严格排列。
                          </p>
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                {/* Action Buttons */}
                <div className="p-6 bg-white dark:bg-slate-900 border-t dark:border-slate-800 space-y-3">
                  <button 
                    onClick={extractFrames}
                    disabled={isProcessing || !ffmpegLoaded}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none text-white py-4 rounded-2xl text-base font-black flex items-center justify-center gap-3 transition-all shadow-xl shadow-blue-500/25 active:scale-[0.98]"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        处理中...
                      </>
                    ) : (
                      <>
                        <Zap className="w-5 h-5 fill-current" />
                        开始提取并处理
                      </>
                    )}
                  </button>
                  {frames.length > 0 && (
                    <button 
                      onClick={handleDownload}
                      disabled={isProcessing}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white py-4 rounded-2xl text-base font-black flex items-center justify-center gap-3 transition-all shadow-xl shadow-emerald-500/25 active:scale-[0.98]"
                    >
                      <Download className="w-5 h-5" />
                      打包并下载
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t bg-white dark:bg-slate-900 mt-auto">
        <div className="container mx-auto px-4 text-center">
          <p className="text-slate-400 text-xs font-medium tracking-wide uppercase">
            © 2024 FramePicker • Browser-Based Game VFX Tool
          </p>
        </div>
      </footer>
    </main>
  );
}
