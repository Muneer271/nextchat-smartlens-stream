import { TextBlock } from '../types';

export function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const row: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], row[j], prev) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

export function stringSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  return 1.0 - levenshtein(a, b) / maxLen;
}

export class TemporalStabilizer {
  private history: TextBlock[][] = [];
  private windowSize: number;
  private similarityThreshold: number;

  constructor(windowSize: number = 3, similarityThreshold: number = 0.82) {
    this.windowSize = windowSize;
    this.similarityThreshold = similarityThreshold;
  }

  public pushFrame(blocks: TextBlock[]): TextBlock[] {
    this.history.push(blocks);
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }
    if (this.history.length < this.windowSize) {
      return [];
    }

    const stabilized: TextBlock[] = [];
    const latestBlocks = this.history[this.history.length - 1];

    for (const target of latestBlocks) {
      let matchesAll = true;
      for (let f = 0; f < this.history.length - 1; f++) {
        const frame = this.history[f];
        const match = frame.find((cand) => stringSimilarity(cand.text, target.text) >= this.similarityThreshold);
        if (!match) {
          matchesAll = false;
          break;
        }
      }
      if (matchesAll) {
        stabilized.push(target);
      }
    }
    return stabilized;
  }

  public clear(): void {
    this.history = [];
  }
}
