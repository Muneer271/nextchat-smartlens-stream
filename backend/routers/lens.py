import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from backend.schemas.lens import TranslateStreamRequest, VLMFallbackRequest
from backend.services.translate import TranslateService

router = APIRouter(prefix="/api/lens", tags=["Smart Lens"])
translate_service = TranslateService()

@router.post("/translate/stream")
async def stream_translation(body: TranslateStreamRequest):
    """
    Streams translation deltas for incoming text blocks.
    Emits SSE events per block as soon as ready.
    """
    async def translation_generator():
        try:
            async for update in translate_service.stream_block_translations(
                blocks=body.blocks,
                target_lang=body.target_language
            ):
                yield f"event: translation\ndata: {json.dumps(update)}\n\n"
            yield "event: done\ndata: {\"status\": \"all_translated\"}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        translation_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.post("/vlm-fallback")
async def vlm_fallback_endpoint(body: VLMFallbackRequest):
    """Second-opinion OCR reading powered by Gemini Vision for degraded crops."""
    result = await translate_service.vlm_inspect_crop(body.image_base64, body.prompt)
    return {"transcription": result, "source": "gemini-vision-fallback"}
