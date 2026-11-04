import hashlib
from typing import AsyncGenerator, Dict, List, Optional
from backend.config import settings
from backend.schemas.lens import TextBlock

class TranslationCache:
    def __init__(self):
        self._cache: Dict[str, str] = {}

    def _key(self, text: str, target_lang: str) -> str:
        raw = f"{text.strip().lower()}::{target_lang.strip().lower()}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def get(self, text: str, target_lang: str) -> Optional[str]:
        return self._cache.get(self._key(text, target_lang))

    def set(self, text: str, target_lang: str, translation: str) -> None:
        self._cache[self._key(text, target_lang)] = translation

translation_cache = TranslationCache()

class TranslateService:
    def __init__(self):
        self._client = None
        if settings.GEMINI_API_KEY:
            try:
                from google import genai
                self._client = genai.Client(api_key=settings.GEMINI_API_KEY)
            except Exception:
                pass

    async def stream_block_translations(
        self,
        blocks: List[TextBlock],
        target_lang: str
    ) -> AsyncGenerator[Dict, None]:
        """Translates blocks sequentially with caching for real-time edge responses."""
        for block in blocks:
            cached = translation_cache.get(block.text, target_lang)
            if cached:
                yield {
                    "id": block.id,
                    "delta": cached,
                    "final": cached,
                    "cached": True,
                    "done": True
                }
                continue

            if not self._client:
                fallback = f"[{target_lang.upper()}] {block.text}"
                translation_cache.set(block.text, target_lang, fallback)
                yield {
                    "id": block.id,
                    "delta": fallback,
                    "final": fallback,
                    "cached": False,
                    "done": True
                }
                continue

            prompt = (
                f"You are an edge-optimized translation engine. Translate the following text cleanly into "
                f"target language '{target_lang}'. Return ONLY the raw translation without commentary or markup.\n\n"
                f"Text:\n{block.text}"
            )

            accumulated = []
            try:
                response_stream = self._client.models.generate_content_stream(
                    model=settings.TRANSLATE_MODEL,
                    contents=prompt
                )
                for chunk in response_stream:
                    if chunk.text:
                        accumulated.append(chunk.text)
                        yield {
                            "id": block.id,
                            "delta": chunk.text,
                            "final": None,
                            "cached": False,
                            "done": False
                        }
                full_trans = "".join(accumulated).strip()
                translation_cache.set(block.text, target_lang, full_trans)
                yield {
                    "id": block.id,
                    "delta": "",
                    "final": full_trans,
                    "cached": False,
                    "done": True
                }
            except Exception as e:
                err_text = f"Translation error: {str(e)}"
                yield {
                    "id": block.id,
                    "delta": err_text,
                    "final": err_text,
                    "cached": False,
                    "done": True,
                    "error": True
                }

    async def vlm_inspect_crop(self, image_base64: str, prompt: str) -> str:
        """Vision-Language Model fallback for low-confidence crops."""
        if not self._client:
            return "VLM Fallback: [Gemini Vision simulated] Recognized text."

        clean_b64 = image_base64
        if "base64," in image_base64:
            clean_b64 = image_base64.split("base64,")[1]

        import base64
        image_bytes = base64.b64decode(clean_b64)

        try:
            from google.genai import types
            response = self._client.models.generate_content(
                model=settings.VISION_MODEL,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    prompt
                ]
            )
            return response.text.strip() if response and response.text else "No text discerned."
        except Exception as e:
            return f"VLM Analysis Failed: {str(e)}"
