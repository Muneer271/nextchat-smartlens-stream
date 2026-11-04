import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Camera,
  Upload,
  Volume2,
  Copy,
  Check,
  Sparkles,
  Sliders,
  RotateCcw,
  ShieldAlert,
  Save,
  CheckCircle2,
  Gauge,
  Sun,
  SunMedium,
  Thermometer,
  SlidersHorizontal,
} from 'lucide-react';
import { TextBlock, LensMetrics, PreprocessingOptions, LensCalibration } from '../types';
import { structureOCRBlocks } from '../utils/ocrPostprocess';
import { TemporalStabilizer } from '../utils/temporalStabilizer';
import { auth, saveLensScan } from '../firebase/config';

export const SmartLens: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [targetLang, setTargetLang] = useState('es');
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [vlmInsights, setVlmInsights] = useState<{ [id: string]: string }>({});
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [savedScanId, setSavedScanId] = useState<string | null>(null);

  // Preprocessing Stages (Toggleable)
  const [options, setOptions] = useState<PreprocessingOptions>({
    grayscale: true,
    contrast: true,
    threshold: false,
    denoise: true,
  });
  const [showOptions, setShowOptions] = useState(false);

  // Manual Lens Calibration (Exposure & White Balance)
  const [calibration, setCalibration] = useState<LensCalibration>({
    exposure: 0.0, // -2.0 to +2.0 EV
    whiteBalance: 5500, // 2500K to 8000K
    tint: 0, // -50 to +50
    contrast: 1.0, // 0.7x to 1.5x
  });
  const [showCalibration, setShowCalibration] = useState(false);

  // Dev Performance Metrics
  const [metrics, setMetrics] = useState<LensMetrics>({
    fps: 0,
    ocrLatencyMs: 0,
    translationLatencyMs: 0,
    cacheHitRate: 100,
  });

  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());
  const stabilizerRef = useRef(new TemporalStabilizer(3, 0.82));
  const translationCacheHits = useRef({ hits: 0, total: 0 });

  // Apply Hardware Sensor Constraints when supported
  const applyHardwareConstraints = useCallback((cal: LensCalibration) => {
    if (!videoRef.current?.srcObject) return;
    const stream = videoRef.current.srcObject as MediaStream;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    try {
      const caps = (track.getCapabilities && track.getCapabilities()) as any;
      const adv: any = {};
      if (caps?.exposureCompensation) {
        const min = caps.exposureCompensation.min ?? -2;
        const max = caps.exposureCompensation.max ?? 2;
        adv.exposureCompensation = Math.max(min, Math.min(max, cal.exposure));
        adv.exposureMode = 'manual';
      }
      if (caps?.colorTemperature) {
        const min = caps.colorTemperature.min ?? 2500;
        const max = caps.colorTemperature.max ?? 8000;
        adv.colorTemperature = Math.max(min, Math.min(max, cal.whiteBalance));
        adv.whiteBalanceMode = 'manual';
      }
      if (Object.keys(adv).length > 0) {
        track.applyConstraints({ advanced: [adv] } as any).catch(() => {});
      }
    } catch (_) {}
  }, []);

  const handleCalibrationChange = (updates: Partial<LensCalibration>) => {
    setCalibration((prev) => {
      const next = { ...prev, ...updates };
      applyHardwareConstraints(next);
      return next;
    });
  };

  // Compute CSS filter for real-time video preview
  const videoFilterStyle = useMemo(() => {
    const expMult = Math.pow(2, calibration.exposure);
    const brightness = Math.round(expMult * 100);
    const contrast = Math.round(calibration.contrast * 100);
    const tempShift = (calibration.whiteBalance - 5500) / 2500; // -1.2 to +1.0
    const sepia = tempShift < 0 ? Math.round(Math.abs(tempShift) * 35) : 0;
    const hueRotate = Math.round(calibration.tint * 0.4);
    return `brightness(${brightness}%) contrast(${contrast}%) sepia(${sepia}%) hue-rotate(${hueRotate}deg)`;
  }, [calibration]);

  // Presets for Lens Calibration
  const calibrationPresets = [
    { label: 'Daylight', exposure: 0.0, wb: 5500, tint: 0, cont: 1.0 },
    { label: 'Warm Bulb', exposure: 0.6, wb: 3200, tint: 5, cont: 1.05 },
    { label: 'Fluorescent', exposure: 0.2, wb: 4200, tint: -8, cont: 1.1 },
    { label: 'Document (High-Key)', exposure: 0.9, wb: 6200, tint: 0, cont: 1.25 },
  ];

  // Initialize Worker
  useEffect(() => {
    try {
      const worker = new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent) => {
        setIsProcessing(false);
        const { type, words, latencyMs } = e.data;
        if (type === 'SUCCESS' && words) {
          setMetrics((m) => ({ ...m, ocrLatencyMs: Math.round(latencyMs) }));
          const structured = structureOCRBlocks(words, 35.0);
          const stabilized = stabilizerRef.current.pushFrame(structured);

          if (stabilized.length > 0) {
            setBlocks(stabilized);
            dispatchTranslation(stabilized, targetLang);
          }
        }
      };

      return () => {
        worker.terminate();
      };
    } catch (e: any) {
      console.warn('Worker initialization error:', e);
    }
  }, [targetLang]);

  // Start Camera
  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
        applyHardwareConstraints(calibration);
      }
    } catch (err: any) {
      setCameraError(err.message || 'Camera permission denied or camera not found. Use image upload below.');
      setIsCameraActive(false);
    }
  };

  useEffect(() => {
    startCamera();
    return () => {
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Frame Capture Loop with Pixel-Level Sensor Calibration for OCR
  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || isProcessing || !isCameraActive) return;

    const video = videoRef.current;
    if (video.readyState < 2) return;

    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Apply software sensor calibration to canvas pixels so OCR worker receives calibrated image
    if (
      calibration.exposure !== 0 ||
      calibration.whiteBalance !== 5500 ||
      calibration.contrast !== 1.0 ||
      calibration.tint !== 0
    ) {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      const expMult = Math.pow(2, calibration.exposure);
      const tempRatio = (calibration.whiteBalance - 5500) / 2500;
      const rGain = tempRatio < 0 ? 1 + Math.abs(tempRatio) * 0.35 : 1 - tempRatio * 0.18;
      const bGain = tempRatio > 0 ? 1 + tempRatio * 0.35 : 1 - Math.abs(tempRatio) * 0.18;
      const gGain = 1 - Math.abs(calibration.tint) * 0.003;
      const cont = calibration.contrast;

      for (let i = 0; i < data.length; i += 4) {
        let r = data[i] * expMult * rGain;
        let g = data[i + 1] * expMult * gGain;
        let b = data[i + 2] * expMult * bGain;

        if (cont !== 1.0) {
          r = (r - 128) * cont + 128;
          g = (g - 128) * cont + 128;
          b = (b - 128) * cont + 128;
        }

        data[i] = Math.min(255, Math.max(0, r));
        data[i + 1] = Math.min(255, Math.max(0, g));
        data[i + 2] = Math.min(255, Math.max(0, b));
      }
      ctx.putImageData(imgData, 0, 0);
    }

    createImageBitmap(canvas).then((bitmap) => {
      setIsProcessing(true);
      workerRef.current?.postMessage(
        {
          imageBitmap: bitmap,
          options,
        },
        [bitmap]
      );
    });

    frameCountRef.current++;
    const now = performance.now();
    if (now - lastFpsTimeRef.current >= 1000) {
      setMetrics((m) => ({ ...m, fps: frameCountRef.current }));
      frameCountRef.current = 0;
      lastFpsTimeRef.current = now;
    }
  }, [isProcessing, isCameraActive, options, calibration]);

  useEffect(() => {
    const interval = setInterval(captureFrame, 450);
    return () => clearInterval(interval);
  }, [captureFrame]);

  // Process Uploaded Image
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canvasRef.current) return;

    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current!;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(img, 0, 0);
      createImageBitmap(canvas).then((bitmap) => {
        setIsProcessing(true);
        workerRef.current?.postMessage(
          {
            imageBitmap: bitmap,
            options,
          },
          [bitmap]
        );
      });
    };
    img.src = URL.createObjectURL(file);
  };

  // Dispatch Translation
  const dispatchTranslation = async (activeBlocks: TextBlock[], lang: string) => {
    const t0 = performance.now();
    translationCacheHits.current.total += activeBlocks.length;

    try {
      const response = await fetch('/api/lens/translate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_language: lang,
          blocks: activeBlocks.map((b) => ({
            id: b.id,
            text: b.text,
            confidence: b.confidence,
            bbox: b.bbox,
          })),
        }),
      });

      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.replace('data: ', '').trim();
            if (!raw) continue;
            try {
              const payload = JSON.parse(raw);
              if (payload.id && payload.final) {
                if (payload.cached) {
                  translationCacheHits.current.hits++;
                }
                setBlocks((prev) =>
                  prev.map((b) => (b.id === payload.id ? { ...b, translation: payload.final } : b))
                );
              }
            } catch (_) {}
          }
        }
      }

      const hitRate =
        translationCacheHits.current.total > 0
          ? Math.round((translationCacheHits.current.hits / translationCacheHits.current.total) * 100)
          : 100;

      setMetrics((m) => ({
        ...m,
        translationLatencyMs: Math.round(performance.now() - t0),
        cacheHitRate: hitRate,
      }));
    } catch (_) {}
  };

  // VLM Fallback for Low-Confidence Bounding Boxes
  const handleVlmFallback = async (block: TextBlock) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const { x0, y0, x1, y1 } = block.bbox;
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = w;
    cropCanvas.height = h;
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) return;

    cropCtx.drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
    const b64 = cropCanvas.toDataURL('image/jpeg', 0.85);

    setVlmInsights((prev) => ({ ...prev, [block.id]: 'Consulting Gemini Vision model...' }));
    try {
      const res = await fetch('/api/lens/vlm-fallback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: b64 }),
      });
      const data = await res.json();
      setVlmInsights((prev) => ({ ...prev, [block.id]: data.transcription }));
    } catch (err: any) {
      setVlmInsights((prev) => ({ ...prev, [block.id]: 'VLM fallback inspection failed.' }));
    }
  };

  // Web Speech API
  const speakText = (text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = targetLang;
      window.speechSynthesis.speak(utterance);
    }
  };

  // Save scan to Firestore
  const handleSaveScan = async () => {
    if (!auth.currentUser || blocks.length === 0) return;
    const combinedOriginal = blocks.map((b) => b.text).join('\n');
    const combinedTranslated = blocks.map((b) => b.translation || b.text).join('\n');
    const avgConfidence = Math.round(blocks.reduce((acc, b) => acc + b.confidence, 0) / blocks.length);

    try {
      const id = await saveLensScan(auth.currentUser.uid, {
        rawText: combinedOriginal,
        cleanedText: combinedOriginal,
        translatedText: combinedTranslated,
        targetLang,
        confidence: avgConfidence,
      });
      setSavedScanId(id);
      setTimeout(() => setSavedScanId(null), 3000);
    } catch (e) {
      console.warn('Failed to save scan:', e);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-3.5rem)] max-w-7xl mx-auto p-2 sm:p-4 gap-4 bg-slate-950 text-slate-100">
      {/* Video Viewport & AR Overlay */}
      <div className="relative flex-1 bg-black rounded-2xl overflow-hidden border border-slate-800 flex items-center justify-center min-h-[380px] shadow-2xl">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ filter: videoFilterStyle }}
          className={`w-full h-full object-contain transition-all duration-75 ${!isCameraActive ? 'hidden' : ''}`}
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Fallback Camera Error / Upload Box */}
        {(!isCameraActive || cameraError) && (
          <div className="flex flex-col items-center justify-center p-6 text-center text-slate-400 space-y-3">
            <Camera className="w-12 h-12 text-slate-600 animate-pulse" />
            <div>
              <p className="text-sm font-semibold text-slate-200">Camera Inactive or Denied</p>
              <p className="text-xs text-slate-400 max-w-xs mt-1">
                {cameraError || 'Click below to start rear camera or upload an image file to test OCR.'}
              </p>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={startCamera}
                className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow"
              >
                <Camera className="w-3.5 h-3.5" /> Start Camera
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-slate-700"
              >
                <Upload className="w-3.5 h-3.5" /> Upload Image
              </button>
            </div>
          </div>
        )}

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImageUpload}
          accept="image/*"
          className="hidden"
        />

        {/* AR Bounding Box Overlays */}
        <div className="absolute inset-0 pointer-events-none">
          {blocks.map((block) => {
            const vW = canvasRef.current?.width || 640;
            const vH = canvasRef.current?.height || 480;
            const topPct = (block.bbox.y0 / vH) * 100;
            const leftPct = (block.bbox.x0 / vW) * 100;
            const widthPct = ((block.bbox.x1 - block.bbox.x0) / vW) * 100;
            const heightPct = ((block.bbox.y1 - block.bbox.y0) / vH) * 100;

            return (
              <div
                key={block.id}
                className="absolute border-2 border-cyan-400 bg-cyan-950/30 rounded transition-all duration-150 pointer-events-auto"
                style={{
                  top: `${topPct}%`,
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                }}
              >
                <div className="absolute -top-6 left-0 bg-cyan-600/95 text-[10px] text-white font-mono px-1.5 py-0.5 rounded shadow whitespace-nowrap overflow-hidden max-w-[220px] text-ellipsis">
                  {block.translation || block.text}
                </div>
              </div>
            );
          })}
        </div>

        {/* Live Dev Performance Floating Badge */}
        <div className="absolute top-3 left-3 bg-slate-950/85 backdrop-blur border border-slate-800/90 rounded-xl p-2.5 text-[11px] font-mono text-slate-300 space-y-1 shadow-md">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">FPS:</span>
            <span className="text-emerald-400 font-bold">{metrics.fps}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">OCR:</span>
            <span className="text-cyan-400 font-bold">{metrics.ocrLatencyMs}ms</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Translate:</span>
            <span className="text-cyan-400 font-bold">{metrics.translationLatencyMs}ms</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Cache Hit:</span>
            <span className="text-amber-400 font-bold">{metrics.cacheHitRate}%</span>
          </div>
        </div>

        {/* Top Control Bar: Calibrate, Preprocess, Lang, Upload */}
        <div className="absolute top-3 right-3 flex items-center gap-2">
          {/* Lens Calibration Tool Button */}
          <button
            onClick={() => {
              setShowCalibration(!showCalibration);
              if (showOptions) setShowOptions(false);
            }}
            className={`px-2.5 py-2 backdrop-blur border text-xs font-semibold rounded-xl shadow flex items-center gap-1.5 transition-all ${
              showCalibration
                ? 'bg-cyan-600 border-cyan-400 text-white'
                : calibration.exposure !== 0 || calibration.whiteBalance !== 5500
                ? 'bg-amber-950/80 border-amber-500/80 text-amber-300'
                : 'bg-slate-950/85 border-slate-800 text-slate-300 hover:text-white'
            }`}
            title="Manual Lens Calibration (Exposure & White Balance)"
          >
            <Gauge className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Calibrate</span>
            {(calibration.exposure !== 0 || calibration.whiteBalance !== 5500) && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 bg-slate-950/85 backdrop-blur border border-slate-800 text-slate-300 hover:text-white rounded-xl shadow"
            title="Upload Test Frame"
          >
            <Upload className="w-4 h-4" />
          </button>

          <select
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            className="bg-slate-950/85 backdrop-blur border border-slate-800 text-xs font-semibold text-white rounded-xl px-2.5 py-2 focus:outline-none shadow"
          >
            <option value="es">Spanish (ES)</option>
            <option value="fr">French (FR)</option>
            <option value="de">German (DE)</option>
            <option value="it">Italian (IT)</option>
            <option value="ja">Japanese (JA)</option>
            <option value="zh">Chinese (ZH)</option>
          </select>

          <button
            onClick={() => {
              setShowOptions(!showOptions);
              if (showCalibration) setShowCalibration(false);
            }}
            className="p-2 bg-slate-950/85 backdrop-blur border border-slate-800 text-slate-300 hover:text-white rounded-xl shadow"
            title="Toggle Preprocessing Stages"
          >
            <Sliders className="w-4 h-4" />
          </button>
        </div>

        {/* Lens Calibration Modal / Drawer */}
        {showCalibration && (
          <div className="absolute top-14 right-3 bg-slate-900/95 backdrop-blur border border-slate-800 p-4 rounded-2xl text-xs space-y-3.5 z-20 w-80 sm:w-88 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-1.5">
                <Gauge className="w-4 h-4 text-cyan-400" />
                <span className="font-bold text-white text-xs">Lens Calibration Tool</span>
              </div>
              <button
                onClick={() =>
                  handleCalibrationChange({
                    exposure: 0.0,
                    whiteBalance: 5500,
                    tint: 0,
                    contrast: 1.0,
                  })
                }
                className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            </div>

            {/* Exposure Compensation Slider */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-300 font-semibold flex items-center gap-1">
                  <SunMedium className="w-3.5 h-3.5 text-amber-400" /> Exposure (EV)
                </span>
                <span className="font-mono text-cyan-400 font-bold bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                  {calibration.exposure > 0 ? `+${calibration.exposure.toFixed(1)}` : calibration.exposure.toFixed(1)} EV
                </span>
              </div>
              <input
                type="range"
                min="-2.0"
                max="2.0"
                step="0.1"
                value={calibration.exposure}
                onChange={(e) => handleCalibrationChange({ exposure: parseFloat(e.target.value) })}
                className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                <span>-2.0</span>
                <span>-1.0</span>
                <span>0.0</span>
                <span>+1.0</span>
                <span>+2.0</span>
              </div>
            </div>

            {/* White Balance / Color Temperature Slider */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-300 font-semibold flex items-center gap-1">
                  <Thermometer className="w-3.5 h-3.5 text-blue-400" /> White Balance (Kelvin)
                </span>
                <span className="font-mono text-cyan-400 font-bold bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                  {calibration.whiteBalance} K
                </span>
              </div>
              <input
                type="range"
                min="2500"
                max="8000"
                step="100"
                value={calibration.whiteBalance}
                onChange={(e) => handleCalibrationChange({ whiteBalance: parseInt(e.target.value, 10) })}
                className="w-full accent-amber-400 h-1.5 bg-gradient-to-r from-amber-500 via-amber-200 to-sky-400 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                <span className="text-amber-400">2500K (Warm)</span>
                <span className="text-slate-300">5500K (Daylight)</span>
                <span className="text-sky-400">8000K (Cool)</span>
              </div>
            </div>

            {/* Contrast Gain Slider */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-300 font-semibold flex items-center gap-1">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" /> Contrast Gain
                </span>
                <span className="font-mono text-cyan-400 font-bold bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                  {calibration.contrast.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min="0.7"
                max="1.5"
                step="0.05"
                value={calibration.contrast}
                onChange={(e) => handleCalibrationChange({ contrast: parseFloat(e.target.value) })}
                className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Calibration Presets */}
            <div className="pt-2 border-t border-slate-800/80">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">
                Environment Presets
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {calibrationPresets.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() =>
                      handleCalibrationChange({
                        exposure: preset.exposure,
                        whiteBalance: preset.wb,
                        tint: preset.tint,
                        contrast: preset.cont,
                      })
                    }
                    className="p-1.5 text-left bg-slate-950/80 hover:bg-slate-800 border border-slate-800 rounded-lg text-[10px] text-slate-300 hover:text-white transition-colors"
                  >
                    <div className="font-semibold text-cyan-300">{preset.label}</div>
                    <div className="text-[9px] text-slate-500">{preset.wb}K | {preset.exposure > 0 ? `+${preset.exposure}` : preset.exposure}EV</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Preprocessing Toggles Drawer */}
        {showOptions && (
          <div className="absolute top-14 right-3 bg-slate-900/95 backdrop-blur border border-slate-800 p-3.5 rounded-2xl text-xs space-y-2.5 z-20 w-52 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
              <span className="font-semibold text-slate-200">Worker Preprocessing</span>
              <button
                onClick={() => setOptions({ grayscale: true, contrast: true, threshold: false, denoise: true })}
                className="text-[10px] text-cyan-400 hover:underline"
              >
                Reset
              </button>
            </div>
            {Object.keys(options).map((key) => (
              <label key={key} className="flex items-center justify-between cursor-pointer">
                <span className="capitalize text-slate-300 text-xs">{key}</span>
                <input
                  type="checkbox"
                  checked={(options as any)[key]}
                  onChange={(e) => setOptions((prev) => ({ ...prev, [key]: e.target.checked }))}
                  className="rounded text-cyan-600 focus:ring-0 bg-slate-800 border-slate-700"
                />
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Side-by-Side Recognized & Translated List Panel */}
      <div className="w-full lg:w-[420px] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl p-3.5 overflow-hidden shadow-xl">
        <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2.5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            Live Stabilized Text Blocks ({blocks.length})
          </h3>

          {auth.currentUser && blocks.length > 0 && (
            <button
              onClick={handleSaveScan}
              className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-medium flex items-center gap-1 transition-colors"
            >
              {savedScanId ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" /> : <Save className="w-3.5 h-3.5" />}
              {savedScanId ? 'Saved' : 'Save to Cloud'}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
          {blocks.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-slate-500 text-xs text-center space-y-2">
              <Camera className="w-8 h-8 opacity-40" />
              <p>Point camera at clear text or upload a document.</p>
              <p className="text-[11px] text-slate-600">
                Stabilized OCR consensus blocks will appear here automatically.
              </p>
            </div>
          )}

          {blocks.map((b) => (
            <div
              key={b.id}
              className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2 text-xs hover:border-slate-700 transition-all"
            >
              <div className="flex justify-between items-center text-slate-400">
                <span className="font-mono text-[10px] bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                  Confidence: {b.confidence}%
                </span>
                <div className="flex items-center gap-1">
                  {b.confidence < 60 && (
                    <button
                      onClick={() => handleVlmFallback(b)}
                      className="text-amber-400 hover:text-amber-300 p-1 rounded hover:bg-slate-800"
                      title="Request Gemini Vision VLM Second-Opinion Read"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {b.translation && (
                    <button
                      onClick={() => speakText(b.translation!)}
                      className="hover:text-cyan-400 p-1 rounded hover:bg-slate-800"
                      title="Speak Translation"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(b.translation || b.text);
                      setCopiedId(b.id);
                      setTimeout(() => setCopiedId(null), 1500);
                    }}
                    className="hover:text-cyan-400 p-1 rounded hover:bg-slate-800"
                    title="Copy Text"
                  >
                    {copiedId === b.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">OCR Original:</span>
                <p className="text-slate-300 mt-0.5 font-medium">{b.text}</p>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-cyan-500 block">Translation ({targetLang.toUpperCase()}):</span>
                <p className="text-cyan-300 font-medium mt-0.5">{b.translation || 'Translating stream...'}</p>
              </div>

              {vlmInsights[b.id] && (
                <div className="mt-1.5 p-2 bg-amber-950/40 border border-amber-800/60 rounded-lg text-[11px] text-amber-200">
                  <span className="font-bold block mb-0.5">Gemini Vision 2nd Opinion:</span>
                  {vlmInsights[b.id]}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
