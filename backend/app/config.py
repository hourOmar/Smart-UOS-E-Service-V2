"""Backend settings, read from environment variables (loaded from backend/.env when
present). Credentials stay in the backend; nothing here is ever sent to the browser."""

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent

# backend/.env, regardless of the current working directory. Real environment
# variables take precedence over the file.
load_dotenv(BACKEND_DIR / ".env", override=False)


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return value.strip()


@dataclass(frozen=True)
class Settings:
    database_url: str | None
    supabase_url: str | None
    supabase_anon_key: str | None
    gemini_api_key: str | None
    gemini_model: str
    frontend_origins: tuple[str, ...]
    # Optional, ordered; tried only after a temporary Gemini error (429/503) and
    # only by callers that ask for fallbacks (the priority agent).
    gemini_fallback_models: tuple[str, ...] = ()
    auth_timeout_seconds: float = 10.0


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    origins = _env("FRONTEND_ORIGINS", "http://localhost:5173") or ""
    return Settings(
        database_url=_env("DATABASE_URL"),
        supabase_url=(_env("SUPABASE_URL") or "").rstrip("/") or None,
        supabase_anon_key=_env("SUPABASE_ANON_KEY"),
        gemini_api_key=_env("GEMINI_API_KEY"),
        gemini_model=_env("GEMINI_MODEL", "gemini-3.6-flash") or "gemini-3.6-flash",
        frontend_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
        gemini_fallback_models=tuple(
            m.strip() for m in (_env("GEMINI_FALLBACK_MODELS") or "").split(",") if m.strip()
        ),
    )
