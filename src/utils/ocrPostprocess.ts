import { BoundingBox, OCRWord, TextBlock } from '../types';

export function computeIoU(a: BoundingBox, b: BoundingBox): number {
  const xA = Math.max(a.x0, b.x0);
  const yA = Math.max(a.y0, b.y0);
  const xB = Math.min(a.x1, b.x1);
  const yB = Math.min(a.y1, b.y1);

  const interWidth = Math.max(0, xB - xA);
  const interHeight = Math.max(0, yB - yA);
  const interArea = interWidth * interHeight;

  const boxAArea = (a.x1 - a.x0) * (a.y1 - a.y0);
  const boxBArea = (b.x1 - b.x0) * (b.y1 - b.y0);
  const unionArea = boxAArea + boxBArea - interArea;

  return unionArea <= 0 ? 0 : interArea / unionArea;
}

export function nmsWords(words: OCRWord[], iouThreshold: number = 0.45): OCRWord[] {
  if (!words || words.length === 0) return [];
  const sorted = [...words].sort((a, b) => b.confidence - a.confidence);
  const kept: OCRWord[] = [];

  while (sorted.length > 0) {
    const best = sorted.shift()!;
    kept.push(best);
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (computeIoU(best.bbox, sorted[i].bbox) >= iouThreshold) {
        sorted.splice(i, 1);
      }
    }
  }
  return kept;
}

export function fixOpticalConfusions(text: string): string {
  const tokens = text.split(' ');
  const cleaned = tokens.map((token) => {
    // 0 -> O when surrounded by letters
    let t = token.replace(/([a-zA-Z])0([a-zA-Z])/g, '$1O$2');
    // O -> 0 when surrounded by numbers
    t = t.replace(/(\d)O(\d)/g, '$10$2');
    // 1 or | -> l inside alpha context
    t = t.replace(/([a-z])[1|]([a-z])/g, '$1l$2');
    // rn -> m in typical ligature misreads
    t = t.replace(/\brn([a-z]{2,})/g, 'm$1');
    return t;
  });
  return cleaned.join(' ');
}

export function isPlausibleToken(word: string): boolean {
  if (!word || word.length === 0) return false;
  if (word.length === 1 && !/[a-zA-Z0-9]/.test(word)) return false;
  const symbols = (word.match(/[^a-zA-Z0-9\s]/g) || []).length;
  if (word.length >= 3 && symbols / word.length > 0.45) return false;
  if (/(.)\1{3,}/.test(word)) return false;
  return true;
}

export function groupWordsIntoLines(words: OCRWord[], verticalOverlapThresh: number = 0.5): OCRWord[][] {
  if (!words || words.length === 0) return [];
  const sortedByY = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const lines: OCRWord[][] = [];

  for (const word of sortedByY) {
    const h = Math.max(1, word.bbox.y1 - word.bbox.y0);
    let matchedLine: OCRWord[] | null = null;

    for (const line of lines) {
      const lineY0 = Math.min(...line.map((w) => w.bbox.y0));
      const lineY1 = Math.max(...line.map((w) => w.bbox.y1));
      const overlap = Math.min(word.bbox.y1, lineY1) - Math.max(word.bbox.y0, lineY0);
      if (overlap / h >= verticalOverlapThresh) {
        matchedLine = line;
        break;
      }
    }

    if (matchedLine) {
      matchedLine.push(word);
    } else {
      lines.push([word]);
    }
  }

  // Sort words left-to-right inside each line
  for (const line of lines) {
    line.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  }

  // Sort lines top-to-bottom
  lines.sort((a, b) => Math.min(...a.map((w) => w.bbox.y0)) - Math.min(...b.map((w) => w.bbox.y0)));
  return lines;
}

export function clusterLinesIntoBlocks(lines: OCRWord[][], lineSpacingMultiplier: number = 1.6): TextBlock[] {
  if (!lines || lines.length === 0) return [];
  const blocks: TextBlock[] = [];
  let currentBlockLines: OCRWord[][] = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const prevLine = lines[i - 1];
    const currLine = lines[i];

    const prevY1 = Math.max(...prevLine.map((w) => w.bbox.y1));
    const currY0 = Math.min(...currLine.map((w) => w.bbox.y0));
    const prevH = Math.max(...prevLine.map((w) => w.bbox.y1 - w.bbox.y0));

    if (currY0 - prevY1 > prevH * lineSpacingMultiplier) {
      blocks.push(compileBlock(currentBlockLines, blocks.length));
      currentBlockLines = [currLine];
    } else {
      currentBlockLines.push(currLine);
    }
  }

  if (currentBlockLines.length > 0) {
    blocks.push(compileBlock(currentBlockLines, blocks.length));
  }

  return blocks;
}

function compileBlock(blockLines: OCRWord[][], index: number): TextBlock {
  const allWords = blockLines.flat();
  const validWords = allWords.filter((w) => isPlausibleToken(w.text));
  const chosenWords = validWords.length > 0 ? validWords : allWords;

  const lineTexts: string[] = [];
  for (const line of blockLines) {
    const tokens = line
      .filter((w) => isPlausibleToken(w.text))
      .map((w) => fixOpticalConfusions(w.text));
    if (tokens.length > 0) {
      lineTexts.push(tokens.join(' '));
    }
  }

  const text = lineTexts.join('\n');
  const avgConf = chosenWords.reduce((sum, w) => sum + w.confidence, 0) / Math.max(1, chosenWords.length);

  const x0 = Math.min(...chosenWords.map((w) => w.bbox.x0));
  const y0 = Math.min(...chosenWords.map((w) => w.bbox.y0));
  const x1 = Math.max(...chosenWords.map((w) => w.bbox.x1));
  const y1 = Math.max(...chosenWords.map((w) => w.bbox.y1));

  return {
    id: `blk_${index}_${Math.round(x0)}_${Math.round(y0)}`,
    text,
    confidence: Math.round(avgConf),
    bbox: { x0, y0, x1, y1 },
  };
}

export function structureOCRBlocks(words: OCRWord[], minConf: number = 40.0): TextBlock[] {
  const filtered = words.filter((w) => w.confidence >= minConf);
  const nms = nmsWords(filtered, 0.45);
  const lines = groupWordsIntoLines(nms);
  const blocks = clusterLinesIntoBlocks(lines);
  return blocks.filter((b) => b.text.trim().length > 0);
}
