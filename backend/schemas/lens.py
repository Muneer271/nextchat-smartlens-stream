from typing import List, Optional
from pydantic import BaseModel, Field

class BoundingBox(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float

class TextBlock(BaseModel):
    id: str
    text: str
    confidence: float
    bbox: BoundingBox
    language: Optional[str] = "en"

class TranslateStreamRequest(BaseModel):
    target_language: str = Field(default="es")
    blocks: List[TextBlock]

class VLMFallbackRequest(BaseModel):
    image_base64: str
    prompt: Optional[str] = "Read and transcribe every visible character in this degraded cropped region accurately."
