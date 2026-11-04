import os

try:
    from pydantic_settings import BaseSettings
    class Settings(BaseSettings):
        GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
        HOST: str = "0.0.0.0"
        PORT: int = 8000
        CORS_ORIGINS: list[str] = [
            "http://localhost:5173",
            "http://localhost:3000",
            "*"
        ]
        DEFAULT_MAX_CONTEXT_TOKENS: int = 4096
        DEFAULT_RESERVED_RESPONSE_TOKENS: int = 1024
        DEFAULT_SUMMARY_CAP_TOKENS: int = 512
        DEFAULT_MIN_RECENT_TURNS: int = 3
        CHAT_MODEL: str = "gemini-3.8-flash"
        TRANSLATE_MODEL: str = "gemini-3.8-flash"
        VISION_MODEL: str = "gemini-3.8-flash"
        FAST_MODEL: str = "gemini-3.1-flash-lite"
        class Config:
            env_file = ".env"
            extra = "allow"
    settings = Settings()
except ImportError:
    class Settings:
        GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
        HOST = "0.0.0.0"
        PORT = 8000
        CORS_ORIGINS = ["http://localhost:5173", "http://localhost:3000", "*"]
        DEFAULT_MAX_CONTEXT_TOKENS = 4096
        DEFAULT_RESERVED_RESPONSE_TOKENS = 1024
        DEFAULT_SUMMARY_CAP_TOKENS = 512
        DEFAULT_MIN_RECENT_TURNS = 3
        CHAT_MODEL = "gemini-3.8-flash"
        TRANSLATE_MODEL = "gemini-3.8-flash"
        VISION_MODEL = "gemini-3.8-flash"
        FAST_MODEL = "gemini-3.1-flash-lite"
    settings = Settings()
