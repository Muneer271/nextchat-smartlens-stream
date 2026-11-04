import math
from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Tuple
from backend.config import settings
from backend.schemas.chat import ChatMessage, ChatSettings

def estimate_tokens(text: str) -> int:
    """Heuristic token estimation: roughly 4 chars per token for Latin script."""
    if not text:
        return 0
    return max(1, math.ceil(len(text) / 4.0))

class AbstractSessionStore(ABC):
    @abstractmethod
    async def get_history(self, session_id: str) -> List[ChatMessage]:
        pass

    @abstractmethod
    async def save_history(self, session_id: str, history: List[ChatMessage]) -> None:
        pass

    @abstractmethod
    async def get_summary(self, session_id: str) -> Optional[str]:
        pass

    @abstractmethod
    async def save_summary(self, session_id: str, summary: Optional[str]) -> None:
        pass

class InMemorySessionStore(AbstractSessionStore):
    def __init__(self):
        self._histories: Dict[str, List[ChatMessage]] = {}
        self._summaries: Dict[str, Optional[str]] = {}

    async def get_history(self, session_id: str) -> List[ChatMessage]:
        return list(self._histories.get(session_id, []))

    async def save_history(self, session_id: str, history: List[ChatMessage]) -> None:
        self._histories[session_id] = list(history)

    async def get_summary(self, session_id: str) -> Optional[str]:
        return self._summaries.get(session_id, None)

    async def save_summary(self, session_id: str, summary: Optional[str]) -> None:
        self._summaries[session_id] = summary

class SlidingWindowContextManager:
    def __init__(self, store: Optional[AbstractSessionStore] = None):
        self.store = store or InMemorySessionStore()

    async def _summarize_turns(self, previous_summary: Optional[str], evicted_turns: List[ChatMessage]) -> str:
        """Compresses evicted turns into a rolling context summary."""
        turns_text = "\n".join([f"{m.role.capitalize()}: {m.content}" for m in evicted_turns])
        prompt = (
            "You are a context condensation engine. Produce a concise factual summary of the following "
            "conversation turns to be retained as historical memory. Keep the summary under 120 words.\n\n"
        )
        if previous_summary:
            prompt += f"Existing Summary:\n{previous_summary}\n\n"
        prompt += f"New Expired Turns:\n{turns_text}\n\nUpdated Concise Summary:"

        if settings.GEMINI_API_KEY:
            try:
                from google import genai
                client = genai.Client(api_key=settings.GEMINI_API_KEY)
                response = client.models.generate_content(
                    model=settings.CHAT_MODEL,
                    contents=prompt
                )
                if response and response.text:
                    return response.text.strip()
            except Exception:
                pass
        
        # Fallback offline compaction
        fallback = (previous_summary + " | " if previous_summary else "")
        fallback += " ".join([m.content[:50] + "..." for m in evicted_turns])
        return fallback[:settings.DEFAULT_SUMMARY_CAP_TOKENS * 4]

    async def prepare_context(
        self,
        session_id: str,
        incoming_message: str,
        config: ChatSettings
    ) -> Tuple[List[ChatMessage], Dict[str, int]]:
        """
        Prepares context for the model enforcing:
        Max Budget - Pinned System Tokens - Reserved Response Tokens.
        Keeps minimum N recent turns verbatim.
        Evicts excess turns and compiles them into a rolling summary.
        """
        history = await self.store.get_history(session_id)
        current_summary = await self.store.get_summary(session_id)

        pinned_prompt = config.system_prompt
        sys_tokens = estimate_tokens(pinned_prompt)
        in_tokens = estimate_tokens(incoming_message)
        
        net_budget = config.max_context_tokens - sys_tokens - config.reserved_response_tokens
        if net_budget < 500:
            net_budget = 500

        new_turn = ChatMessage(role="user", content=incoming_message, tokens=in_tokens)
        history.append(new_turn)

        min_turns = config.min_recent_turns
        if len(history) > min_turns:
            turns_to_eval = history[:-min_turns]
            guaranteed_recent = history[-min_turns:]
        else:
            turns_to_eval = []
            guaranteed_recent = list(history)

        active_older: List[ChatMessage] = []
        evicted: List[ChatMessage] = []

        summary_tokens = estimate_tokens(current_summary) if current_summary else 0
        current_used = summary_tokens + sum(estimate_tokens(m.content) for m in guaranteed_recent)

        # Walk backward through older turns to preserve as many as budget allows
        for msg in reversed(turns_to_eval):
            m_tokens = estimate_tokens(msg.content)
            if current_used + m_tokens <= net_budget:
                active_older.insert(0, msg)
                current_used += m_tokens
            else:
                evicted.insert(0, msg)

        if evicted:
            current_summary = await self._summarize_turns(current_summary, evicted)
            await self.store.save_summary(session_id, current_summary)

        active_turns = active_older + guaranteed_recent
        await self.store.save_history(session_id, active_turns)

        # Assemble prompt payload
        assembled: List[ChatMessage] = [
            ChatMessage(role="system", content=pinned_prompt, tokens=sys_tokens)
        ]
        if current_summary:
            sum_tokens = estimate_tokens(current_summary)
            summary_content = f"[Context Memory Summary of earlier conversation]: {current_summary}"
            assembled.append(ChatMessage(role="system", content=summary_content, tokens=sum_tokens))
        assembled.extend(active_turns)

        stats = {
            "total_tokens_used": sum(estimate_tokens(m.content) for m in assembled),
            "max_budget": config.max_context_tokens,
            "available_budget": net_budget,
            "active_turns": len(active_turns),
            "evicted_turns": len(evicted),
            "summary_length": len(current_summary) if current_summary else 0
        }
        return assembled, stats

    async def append_model_turn(self, session_id: str, content: str) -> None:
        history = await self.store.get_history(session_id)
        tokens = estimate_tokens(content)
        history.append(ChatMessage(role="model", content=content, tokens=tokens))
        await self.store.save_history(session_id, history)

    async def get_context_state(self, session_id: str, config: ChatSettings) -> Dict:
        history = await self.store.get_history(session_id)
        summary = await self.store.get_summary(session_id)
        sys_tokens = estimate_tokens(config.system_prompt)
        used_tokens = sys_tokens + (estimate_tokens(summary) if summary else 0)
        used_tokens += sum(estimate_tokens(m.content) for m in history)

        return {
            "session_id": session_id,
            "pinned_system_prompt": config.system_prompt,
            "rolling_summary": summary,
            "active_turns_count": len(history),
            "total_tokens_used": used_tokens,
            "max_budget": config.max_context_tokens,
            "available_budget": max(0, config.max_context_tokens - sys_tokens - config.reserved_response_tokens),
            "messages": history
        }
