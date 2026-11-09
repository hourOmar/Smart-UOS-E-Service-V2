"""Records which Gemini model answered each agent's call (stored with the run)."""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

_calls: ContextVar[list[dict] | None] = ContextVar("incomplete_exam_gemini_calls", default=None)


@contextmanager
def recording_calls() -> Iterator[list[dict]]:
    """Collects {"agent", "model"} for every answered Gemini call in the block."""
    calls: list[dict] = []
    token = _calls.set(calls)
    try:
        yield calls
    finally:
        _calls.reset(token)


def record(agent: str, model: str) -> None:
    recorder = _calls.get()
    if recorder is not None:
        recorder.append({"agent": agent, "model": model})
