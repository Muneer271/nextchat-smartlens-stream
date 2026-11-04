import re
from typing import List, Dict, Any

def compute_iou(boxA: Dict[str, float], boxB: Dict[str, float]) -> float:
    xA = max(boxA["x0"], boxB["x0"])
    yA = max(boxA["y0"], boxB["y0"])
    xB = min(boxA["x1"], boxB["x1"])
    yB = min(boxA["y1"], boxB["y1"])

    interWidth = max(0.0, xB - xA)
    interHeight = max(0.0, yB - yA)
    interArea = interWidth * interHeight

    boxAArea = (boxA["x1"] - boxA["x0"]) * (boxA["y1"] - boxA["y0"])
    boxBArea = (boxB["x1"] - boxB["x0"]) * (boxB["y1"] - boxB["y0"])
    unionArea = boxAArea + boxBArea - interArea

    if unionArea <= 0:
        return 0.0
    return interArea / unionArea

def merge_bounding_boxes(boxes: List[Dict[str, float]]) -> Dict[str, float]:
    return {
        "x0": min(b["x0"] for b in boxes),
        "y0": min(b["y0"] for b in boxes),
        "x1": max(b["x1"] for b in boxes),
        "y1": max(b["y1"] for b in boxes)
    }

def nms_words(words: List[Dict[str, Any]], iou_threshold: float = 0.45) -> List[Dict[str, Any]]:
    """Suppresses duplicate and overlapping bounding boxes."""
    if not words:
        return []
    sorted_words = sorted(words, key=lambda w: w.get("confidence", 0.0), reverse=True)
    kept = []
    while sorted_words:
        best = sorted_words.pop(0)
        kept.append(best)
        sorted_words = [
            w for w in sorted_words
            if compute_iou(best["bbox"], w["bbox"]) < iou_threshold
        ]
    return kept

def fix_ocr_confusions(text: str) -> str:
    """Linguistic rule-based substitution for common OCR optical errors."""
    tokens = text.split(" ")
    cleaned_tokens = []
    for token in tokens:
        # 0 -> O when surrounded by letters (e.g. W0RLD -> WORLD)
        token = re.sub(r'(?<=[A-Za-z])0(?=[A-Za-z])', 'O', token)
        # O -> 0 when surrounded by numbers (e.g. 2O24 -> 2024)
        token = re.sub(r'(?<=\d)O(?=\d)', '0', token)
        # 1 or | -> l/I inside alpha contexts
        token = re.sub(r'(?<=[a-z])[1|](?=[a-z])', 'l', token)
        # Fix 'rn' to 'm' if part of typical ligature errors
        token = re.sub(r'\brn(?=[a-z]{2,})', 'm', token)
        cleaned_tokens.append(token)
    return " ".join(cleaned_tokens)

def is_plausible_token(word: str) -> bool:
    """Discards noise, isolated punctuation, or irregular glyph combos."""
    if len(word) == 0:
        return False
    if len(word) == 1 and not word.isalnum():
        return False
    # Check character class distribution
    alphas = sum(1 for c in word if c.isalpha())
    symbols = sum(1 for c in word if not c.isalnum() and not c.isspace())
    if len(word) >= 3 and (symbols / len(word)) > 0.45:
        return False
    # Reject 4+ consecutive identical characters (e.g., 'xxxxx')
    if re.search(r'(.)\1{3,}', word):
        return False
    return True

def group_words_into_lines(words: List[Dict[str, Any]], vertical_overlap_thresh: float = 0.5) -> List[List[Dict[str, Any]]]:
    """Groups words into horizontal lines based on y-coordinate overlap."""
    if not words:
        return []
    sorted_by_y = sorted(words, key=lambda w: w["bbox"]["y0"])
    lines: List[List[Dict[str, Any]]] = []

    for word in sorted_by_y:
        box = word["bbox"]
        h = max(1.0, box["y1"] - box["y0"])
        matched_line = None
        for line in lines:
            line_y0 = min(w["bbox"]["y0"] for w in line)
            line_y1 = max(w["bbox"]["y1"] for w in line)
            overlap = min(box["y1"], line_y1) - max(box["y0"], line_y0)
            if overlap / h >= vertical_overlap_thresh:
                matched_line = line
                break
        if matched_line is not None:
            matched_line.append(word)
        else:
            lines.append([word])

    # Sort each line left-to-right
    for line in lines:
        line.sort(key=lambda w: w["bbox"]["x0"])

    # Sort lines top-to-bottom
    lines.sort(key=lambda ln: min(w["bbox"]["y0"] for w in ln))
    return lines

def cluster_lines_into_blocks(lines: List[List[Dict[str, Any]]], line_spacing_multiplier: float = 1.6) -> List[Dict[str, Any]]:
    """Groups lines into structured multi-line text blocks with bounding boxes."""
    if not lines:
        return []

    blocks: List[Dict[str, Any]] = []
    current_block_lines: List[List[Dict[str, Any]]] = [lines[0]]

    for i in range(1, len(lines)):
        prev_line = lines[i - 1]
        curr_line = lines[i]

        prev_y1 = max(w["bbox"]["y1"] for w in prev_line)
        curr_y0 = min(w["bbox"]["y0"] for w in curr_line)
        prev_h = max(w["bbox"]["y1"] - w["bbox"]["y0"] for w in prev_line)

        if (curr_y0 - prev_y1) > (prev_h * line_spacing_multiplier):
            blocks.append(_compile_block(current_block_lines, len(blocks)))
            current_block_lines = [curr_line]
        else:
            current_block_lines.append(curr_line)

    if current_block_lines:
        blocks.append(_compile_block(current_block_lines, len(blocks)))

    return blocks

def _compile_block(block_lines: List[List[Dict[str, Any]]], index: int) -> Dict[str, Any]:
    all_words = [w for line in block_lines for w in line]
    valid_words = [w for w in all_words if is_plausible_token(w.get("text", ""))]
    if not valid_words:
        valid_words = all_words

    line_strings = []
    for line in block_lines:
        tokens = [fix_ocr_confusions(w.get("text", "")) for w in line if is_plausible_token(w.get("text", ""))]
        if tokens:
            line_strings.append(" ".join(tokens))

    joined_text = "\n".join(line_strings)
    avg_conf = sum(w.get("confidence", 0.0) for w in valid_words) / max(1, len(valid_words))
    overall_bbox = merge_bounding_boxes([w["bbox"] for w in valid_words])

    return {
        "id": f"block_{index}_{int(overall_bbox['x0'])}_{int(overall_bbox['y0'])}",
        "text": joined_text,
        "confidence": round(avg_conf, 2),
        "bbox": overall_bbox,
        "line_count": len(block_lines)
    }

def process_raw_ocr_words(raw_words: List[Dict[str, Any]], conf_threshold: float = 40.0) -> List[Dict[str, Any]]:
    """Complete post-processing pipeline for raw OCR tokens."""
    filtered = [w for w in raw_words if w.get("confidence", 0.0) >= conf_threshold]
    suppressed = nms_words(filtered, iou_threshold=0.45)
    lines = group_words_into_lines(suppressed)
    blocks = cluster_lines_into_blocks(lines)
    return [b for b in blocks if len(b["text"].strip()) > 0]
