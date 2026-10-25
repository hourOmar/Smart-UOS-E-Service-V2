"""Smart UoS E-Service backend.

Run (from backend/):  .venv/Scripts/python -m uvicorn app.main:app --port 8000
"""

import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.program_change_review import router as program_change_review_router
from app.api.raise_capacity_priority import router as raise_capacity_priority_router
from app.api.raise_capacity_review import router as raise_capacity_review_router
from app.config import get_settings
from app.core.database import DatabaseUnavailableError

# The backend's own messages (app.*) go to the terminal next to uvicorn's,
# timestamped. They never contain credentials, prompts or student data.
_app_log = logging.getLogger("app")
if not _app_log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    _app_log.addHandler(_handler)
    _app_log.setLevel(logging.INFO)

# Printed once per start, so the terminal shows which code is serving requests.
_app_log.info("Backend loaded (pid %s, sanitized Gemini error details enabled)", os.getpid())

app = FastAPI(title="Smart UoS E-Service backend", docs_url=None, redoc_url=None, openapi_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(get_settings().frontend_origins),
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(DatabaseUnavailableError)
def database_unavailable(_request: Request, _exc: DatabaseUnavailableError) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": "The database is unavailable. Try again shortly."})


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


app.include_router(raise_capacity_review_router)
app.include_router(raise_capacity_priority_router)
app.include_router(program_change_review_router)
