/// <reference lib="webworker" />
import { createWorker } from 'tesseract.js';

let tesseractWorker: any = null;

async function getWorker() {
  if (!tesseractWorker) {
    tesseractWorker = await createWorker('eng');
  }
  return tesseractWorker;
}

function preprocessImageData(
  imageData: ImageData,
  options: { grayscale: boolean; contrast: boolean; threshold: boolean; denoise: boolean }
): ImageData {
  const data = imageData.data;
  const len = data.length;
  const width = imageData.width;
  const height = imageData.height;

  // 1. Grayscale
  if (options.grayscale) {
    for (let i = 0; i < len; i += 4) {
      const gray = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }
  }

  // 2. Contrast Normalization (Min-Max Stretch)
  if (options.contrast) {
    let min = 255;
    let max = 0;
    for (let i = 0; i < len; i += 4) {
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = Math.max(1, max - min);
    for (let i = 0; i < len; i += 4) {
      const normalized = Math.min(255, Math.max(0, ((data[i] - min) / range) * 255));
      data[i] = normalized;
      data[i + 1] = normalized;
      data[i + 2] = normalized;
    }
  }

  // 3. Adaptive Thresholding
  if (options.threshold) {
    const threshold = 128;
    for (let i = 0; i < len; i += 4) {
      const b = data[i] > threshold ? 255 : 0;
      data[i] = b;
      data[i + 1] = b;
      data[i + 2] = b;
    }
  }

  // 4. Light Denoise (3x3 Fast Median Kernel)
  if (options.denoise && width > 2 && height > 2) {
    const copy = new Uint8ClampedArray(data);
    for (let y = 1; y < height - 1; y += 2) {
      for (let x = 1; x < width - 1; x += 2) {
        const idx = (y * width + x) * 4;
        const neighbors = [
          copy[idx - (width + 1) * 4],
          copy[idx - width * 4],
          copy[idx - (width - 1) * 4],
          copy[idx - 4],
          copy[idx],
          copy[idx + 4],
          copy[idx + (width - 1) * 4],
          copy[idx + width * 4],
          copy[idx + (width + 1) * 4],
        ].sort((a, b) => a - b);
        const median = neighbors[4];
        data[idx] = median;
        data[idx + 1] = median;
        data[idx + 2] = median;
      }
    }
  }

  return imageData;
}

self.onmessage = async (e: MessageEvent) => {
  const { imageBitmap, options } = e.data;
  const startTime = performance.now();

  try {
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to create OffscreenCanvas 2D context');

    ctx.drawImage(imageBitmap, 0, 0);
    const rawData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const processed = preprocessImageData(rawData, options);
    ctx.putImageData(processed, 0, 0);

    const worker = await getWorker();
    const result = await worker.recognize(canvas);

    const rawWords = (result.data.words || []).map((w: any) => ({
      text: w.text || '',
      confidence: w.confidence || 0,
      bbox: {
        x0: w.bbox ? w.bbox.x0 : 0,
        y0: w.bbox ? w.bbox.y0 : 0,
        x1: w.bbox ? w.bbox.x1 : 0,
        y1: w.bbox ? w.bbox.y1 : 0,
      },
    }));

    const latency = performance.now() - startTime;
    self.postMessage({
      type: 'SUCCESS',
      words: rawWords,
      latencyMs: latency,
      width: canvas.width,
      height: canvas.height,
    });
  } catch (err: any) {
    self.postMessage({
      type: 'ERROR',
      error: err.message || 'Worker OCR failed',
    });
  }
};
