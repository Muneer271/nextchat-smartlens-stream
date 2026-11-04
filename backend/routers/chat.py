import asyncio
import json
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from backend.config import settings
from backend.schemas.chat import ChatStreamRequest, ContextStateResponse
from backend.services.context_manager import SlidingWindowContextManager

router = APIRouter(prefix="/api/chat", tags=["Next Chat AI"])
context_mgr = SlidingWindowContextManager()

@router.post("/stream")
async def chat_stream(request: Request, body: ChatStreamRequest):
    """
    Streams LLM output using Server-Sent Events (SSE).
    Emits `token`, `meta`, `ping`, and `done` events.
    Honors client disconnect cancellations and disables proxy buffering.
    """
    client = None
    if settings.GEMINI_API_KEY:
        try:
            from google import genai
            client = genai.Client(api_key=settings.GEMINI_API_KEY)
        except Exception:
            pass

    try:
        assembled_context, stats = await context_mgr.prepare_context(
            session_id=body.session_id,
            incoming_message=body.message,
            config=body.settings
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Context preparation error: {str(e)}")

    async def event_generator():
        # Yield metadata immediately so UI updates budget indicators
        yield f"event: meta\ndata: {json.dumps(stats)}\n\n"

        prompt_history = []
        for msg in assembled_context:
            role = "user" if msg.role in ("user", "system") else "model"
            prompt_history.append(f"{role.upper()}: {msg.content}")
        full_prompt = "\n\n".join(prompt_history) + "\n\nMODEL: "

        full_response_text = []
        last_ping = asyncio.get_event_loop().time()

        try:
            if client:
                model_to_use = body.settings.model if body.settings and body.settings.model else settings.CHAT_MODEL
                config = {}
                if body.settings and body.settings.enable_search:
                    config["tools"] = [{"googleSearch": {}}]

                stream = client.models.generate_content_stream(
                    model=model_to_use,
                    contents=full_prompt,
                    config=config if config else None
                )
                for chunk in stream:
                    if await request.is_disconnected():
                        break

                    now = asyncio.get_event_loop().time()
                    if now - last_ping >= 15.0:
                        yield "event: ping\ndata: {}\n\n"
                        last_ping = now

                    if chunk.text:
                        full_response_text.append(chunk.text)
                        payload = json.dumps({"token": chunk.text})
                        yield f"event: token\ndata: {payload}\n\n"
                        await asyncio.sleep(0.005)
            else:
                simulated_reply = (
                    f"Echo Response: Received '{body.message}'. "
                    f"Context window active ({stats['active_turns']} turns). "
                    f"Ready for multimodal vision and edge OCR tasks."
                )
                for word in simulated_reply.split(" "):
                    if await request.is_disconnected():
                        break
                    full_response_text.append(word + " ")
                    payload = json.dumps({"token": word + " "})
                    yield f"event: token\ndata: {payload}\n\n"
                    await asyncio.sleep(0.04)

            completed_text = "".join(full_response_text).strip()
            if completed_text:
                await context_mgr.append_model_turn(body.session_id, completed_text)

            yield f"event: done\ndata: {json.dumps({'status': 'completed', 'length': len(completed_text)})}\n\n"

        except asyncio.CancelledError:
            pass
        except Exception as err:
            err_payload = json.dumps({"error": str(err)})
            yield f"event: error\ndata: {err_payload}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.get("/{session_id}/context", response_model=ContextStateResponse)
async def get_session_context(session_id: str):
    """Inspects the active context window state for transparency."""
    from backend.schemas.chat import ChatSettings
    state = await context_mgr.get_context_state(session_id, ChatSettings())
    return state
