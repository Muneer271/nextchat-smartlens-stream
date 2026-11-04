import unittest
from backend.services.ocr_postprocess import (
    compute_iou,
    nms_words,
    fix_ocr_confusions,
    is_plausible_token,
    process_raw_ocr_words,
)

class TestOCRPostprocess(unittest.TestCase):
    def test_iou_computation(self):
        boxA = {"x0": 0.0, "y0": 0.0, "x1": 10.0, "y1": 10.0}
        boxB = {"x0": 5.0, "y0": 0.0, "x1": 15.0, "y1": 10.0}
        iou = compute_iou(boxA, boxB)
        self.assertTrue(0.33 <= iou <= 0.34)

    def test_fix_ocr_confusions(self):
        raw = "W0RLD 2O24 a1pha"
        fixed = fix_ocr_confusions(raw)
        self.assertIn("WORLD", fixed)
        self.assertIn("2024", fixed)

    def test_is_plausible_token(self):
        self.assertTrue(is_plausible_token("Receipt"))
        self.assertFalse(is_plausible_token("$$$#@"))
        self.assertFalse(is_plausible_token("aaaaa"))
        self.assertTrue(is_plausible_token("a"))

    def test_process_raw_ocr_words(self):
        raw_words = [
            {"text": "Total:", "confidence": 92.0, "bbox": {"x0": 10, "y0": 10, "x1": 50, "y1": 25}},
            {"text": "$42.50", "confidence": 88.0, "bbox": {"x0": 55, "y0": 10, "x1": 95, "y1": 25}},
            {"text": "Garbage!@#$", "confidence": 20.0, "bbox": {"x0": 100, "y0": 500, "x1": 150, "y1": 520}},
        ]
        blocks = process_raw_ocr_words(raw_words, conf_threshold=40.0)
        self.assertEqual(len(blocks), 1)
        self.assertIn("Total:", blocks[0]["text"])
        self.assertIn("$42.50", blocks[0]["text"])

if __name__ == "__main__":
    unittest.main()
