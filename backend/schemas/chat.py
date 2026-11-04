from typing import List, Optional, Literal

try:
    from pydantic import BaseModel, Field
except ImportError:
    # Graceful fallback when running in vanilla Python environments without pydantic
    class BaseModel:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)
        def dict(self):
            return self.__dict__

    def Field(default=None, **kwargs):
        return default

class ChatMessage(BaseModel):
    def __init__(
        self,
        role: str,
        content: str,
        tokens: Optional[int] = None,
        search_grounding: Optional[bool] = False,
        **kwargs
    ):
        super().__init__(**kwargs)
        self.role = role
        self.content = content
        self.tokens = tokens
        self.search_grounding = search_grounding

class ChatSettings(BaseModel):
    def __init__(
        self,
        max_context_tokens: int = 4096,
        reserved_response_tokens: int = 1024,
        min_recent_turns: int = 3,
        system_prompt: str = "You are Next Chat AI, an ultra-fast, intelligent, precision-focused assistant.",
        enable_search: bool = False,
        model: str = "gemini-3.8-flash",
        **kwargs
    ):
        super().__init__(**kwargs)
        self.max_context_tokens = max_context_tokens
        self.reserved_response_tokens = reserved_response_tokens
        self.min_recent_turns = min_recent_turns
        self.system_prompt = system_prompt
        self.enable_search = enable_search
        self.model = model

class ChatStreamRequest(BaseModel):
    def __init__(self, session_id: str, message: str, settings: Optional[ChatSettings] = None, **kwargs):
        super().__init__(**kwargs)
        self.session_id = session_id
        self.message = message
        self.settings = settings or ChatSettings()

class ContextStateResponse(BaseModel):
    def __init__(
        self,
        session_id: str,
        pinned_system_prompt: str,
        rolling_summary: Optional[str],
        active_turns_count: int,
        total_tokens_used: int,
        max_budget: int,
        available_budget: int,
        messages: List[ChatMessage],
        **kwargs
    ):
        super().__init__(**kwargs)
        self.session_id = session_id
        self.pinned_system_prompt = pinned_system_prompt
        self.rolling_summary = rolling_summary
        self.active_turns_count = active_turns_count
        self.total_tokens_used = total_tokens_used
        self.max_budget = max_budget
        self.available_budget = available_budget
        self.messages = messages
