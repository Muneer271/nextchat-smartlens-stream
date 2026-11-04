"""
CLI Evaluation harness for Smart Lens OCR & Cleaning Pipeline.
Compares raw baseline OCR against pre/post-processed results dynamically.
Outputs Character Error Rate (CER), Word Error Rate (WER), Noise Token Rate, and Latency.
"""
import os
import sys
import time
from typing import List, Tuple

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.services.ocr_postprocess import (
    nms_words,
    group_words_into_lines,
    cluster_lines_into_blocks,
    fix_ocr_confusions,
    is_plausible_token
)

def levenshtein_distance(s1, s2):
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        curr = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = prev[j + 1] + 1
            deletions = curr[j] + 1
            substitutions = prev[j] + (c1 != c2)
            curr.append(min(insertions, deletions, substitutions))
        prev = curr
    return prev[-1]

def calculate_cer(reference: str, hypothesis: str) -> float:
    ref = reference.strip()
    hyp = hypothesis.strip()
    if not ref:
        return 0.0 if not hyp else 1.0
    return min(1.0, levenshtein_distance(ref, hyp) / len(ref))

def calculate_wer(reference: str, hypothesis: str) -> float:
    ref_words = reference.strip().split()
    hyp_words = hypothesis.strip().split()
    if not ref_words:
        return 0.0 if not hyp_words else 1.0
    d = levenshtein_distance(ref_words, hyp_words)
    return min(1.0, d / len(ref_words))

def noise_token_rate(text: str) -> float:
    words = text.split()
    if not words:
        return 0.0
    noise = sum(1 for w in words if not is_plausible_token(w))
    return noise / len(words)

BENCHMARK_SET = [
    {
        "id": "sample_1_receipt",
        "ground_truth": "Invoice Number 1042 Subtotal 45.00 Tax 3.60 Total 48.60",
        "raw_ocr_tokens": [
            {"text": "1nv0ice", "confidence": 62.0, "bbox": {"x0": 10, "y0": 10, "x1": 50, "y1": 20}},
            {"text": "Number", "confidence": 88.0, "bbox": {"x0": 55, "y0": 10, "x1": 90, "y1": 20}},
            {"text": "1O42", "confidence": 55.0, "bbox": {"x0": 95, "y0": 10, "x1": 130, "y1": 20}},
            {"text": "^%#*", "confidence": 18.0, "bbox": {"x0": 200, "y0": 12, "x1": 220, "y1": 22}},
            {"text": "Subt0tal", "confidence": 71.0, "bbox": {"x0": 10, "y0": 25, "x1": 60, "y1": 35}},
            {"text": "45.00", "confidence": 94.0, "bbox": {"x0": 65, "y0": 25, "x1": 95, "y1": 35}},
            {"text": "Tax", "confidence": 95.0, "bbox": {"x0": 10, "y0": 40, "x1": 30, "y1": 50}},
            {"text": "3.60", "confidence": 93.0, "bbox": {"x0": 35, "y0": 40, "x1": 60, "y1": 50}},
            {"text": "T0tal", "confidence": 80.0, "bbox": {"x0": 10, "y0": 55, "x1": 40, "y1": 65}},
            {"text": "48.60", "confidence": 96.0, "bbox": {"x0": 45, "y0": 55, "x1": 75, "y1": 65}},
            {"text": "~~~~~", "confidence": 12.0, "bbox": {"x0": 10, "y0": 80, "x1": 50, "y1": 90}}
        ]
    },
    {
        "id": "sample_2_street_sign",
        "ground_truth": "Emergency Exit Keep Door Clear At All Times",
        "raw_ocr_tokens": [
            {"text": "Ernergency", "confidence": 54.0, "bbox": {"x0": 5, "y0": 5, "x1": 65, "y1": 20}},
            {"text": "Ex1t", "confidence": 68.0, "bbox": {"x0": 70, "y0": 5, "x1": 95, "y1": 20}},
            {"text": "Keep", "confidence": 90.0, "bbox": {"x0": 5, "y0": 25, "x1": 40, "y1": 40}},
            {"text": "D00r", "confidence": 75.0, "bbox": {"x0": 45, "y0": 25, "x1": 80, "y1": 40}},
            {"text": "Clear", "confidence": 92.0, "bbox": {"x0": 85, "y0": 25, "x1": 115, "y1": 40}},
            {"text": "At", "confidence": 91.0, "bbox": {"x0": 5, "y0": 45, "x1": 20, "y1": 60}},
            {"text": "All", "confidence": 93.0, "bbox": {"x0": 25, "y0": 45, "x1": 45, "y1": 60}},
            {"text": "T1mes", "confidence": 70.0, "bbox": {"x0": 50, "y0": 45, "x1": 85, "y1": 60}}
        ]
    }
]

def run_evaluation():
    print("=" * 70)
    print("SMART LENS EVALUATION HARNESS: BASELINE OCR vs FULL PIPELINE")
    print("=" * 70)

    raw_cers, pipe_cers = [], []
    raw_wers, pipe_wers = [], []
    raw_noise, pipe_noise = [], []
    pipe_latencies = []

    for item in BENCHMARK_SET:
        gt = item["ground_truth"]
        raw_tokens = item["raw_ocr_tokens"]

        raw_text = " ".join([t["text"] for t in raw_tokens])
        r_cer = calculate_cer(gt, raw_text)
        r_wer = calculate_wer(gt, raw_text)
        r_ntr = noise_token_rate(raw_text)

        raw_cers.append(r_cer)
        raw_wers.append(r_wer)
        raw_noise.append(r_ntr)

        t0 = time.perf_counter()
        filtered = [w for w in raw_tokens if w["confidence"] >= 40.0]
        nms = nms_words(filtered)
        lines = group_words_into_lines(nms)
        blocks = cluster_lines_into_blocks(lines)
        pipeline_text = " ".join([b["text"].replace("\n", " ") for b in blocks])
        latency_ms = (time.perf_counter() - t0) * 1000.0

        p_cer = calculate_cer(gt, pipeline_text)
        p_wer = calculate_wer(gt, pipeline_text)
        p_ntr = noise_token_rate(pipeline_text)

        pipe_cers.append(p_cer)
        pipe_wers.append(p_wer)
        pipe_noise.append(p_ntr)
        pipe_latencies.append(latency_ms)

        print(f"Sample: {item['id']}")
        print(f"  Ground Truth:    {gt}")
        print(f"  Raw Baseline:    {raw_text}")
        print(f"  Pipeline Output: {pipeline_text}")
        print(f"  CER: Baseline={r_cer:.3f} | Pipeline={p_cer:.3f}")
        print(f"  WER: Baseline={r_wer:.3f} | Pipeline={p_wer:.3f}")
        print(f"  Noise Rate: Baseline={r_ntr:.3f} | Pipeline={p_ntr:.3f}")
        print(f"  Latency: {latency_ms:.2f} ms\n")

    avg_raw_cer = sum(raw_cers) / len(raw_cers)
    avg_pipe_cer = sum(pipe_cers) / len(pipe_cers)
    avg_raw_wer = sum(raw_wers) / len(raw_wers)
    avg_pipe_wer = sum(pipe_wers) / len(pipe_wers)
    avg_raw_noise = sum(raw_noise) / len(raw_noise)
    avg_pipe_noise = sum(pipe_noise) / len(pipe_noise)
    avg_latency = sum(pipe_latencies) / len(pipe_latencies)

    cer_reduction = ((avg_raw_cer - avg_pipe_cer) / max(0.001, avg_raw_cer)) * 100.0
    wer_reduction = ((avg_raw_wer - avg_pipe_wer) / max(0.001, avg_raw_wer)) * 100.0
    noise_reduction = ((avg_raw_noise - avg_pipe_noise) / max(0.001, avg_raw_noise)) * 100.0

    print("-" * 70)
    print("AGGREGATE MEASURED METRICS")
    print("-" * 70)
    print(f"Baseline Mean CER:       {avg_raw_cer * 100.0:.2f}%")
    print(f"Pipeline Mean CER:       {avg_pipe_cer * 100.0:.2f}% (Reduction: {cer_reduction:.1f}%)")
    print(f"Baseline Mean WER:       {avg_raw_wer * 100.0:.2f}%")
    print(f"Pipeline Mean WER:       {avg_pipe_wer * 100.0:.2f}% (Reduction: {wer_reduction:.1f}%)")
    print(f"Noise Token Reduction:   {noise_reduction:.1f}%")
    print(f"Mean Pipeline Overhead:  {avg_latency:.2f} ms")
    print("=" * 70)

if __name__ == "__main__":
    run_evaluation()
