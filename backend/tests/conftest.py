"""Offline unit tests: no network, no database, no Gemini. Settings come from the
environment set here, never from backend/.env."""

import pytest

from app.config import get_settings

TEST_ENV = {
    "DATABASE_URL": "",
    "SUPABASE_URL": "",
    "SUPABASE_ANON_KEY": "",
    "GEMINI_API_KEY": "",
    "GEMINI_MODEL": "test-model",
    "FRONTEND_ORIGINS": "http://localhost:5173",
}


@pytest.fixture(autouse=True)
def isolated_settings(monkeypatch):
    for name, value in TEST_ENV.items():
        monkeypatch.setenv(name, value)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
