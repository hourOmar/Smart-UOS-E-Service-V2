"""app.core.storage: authenticated downloads as the signed-in user; requests
is faked, nothing reaches the network."""

import inspect
import logging

import pytest
import requests

from app.config import get_settings
from app.core import storage

TOKEN = "staff-access-token-SYNTHETIC-0123456789"
PATH = "STUD_INCRQ_INC2_900001/medical report.pdf"


class FakeResponse:
    def __init__(self, status=200, chunks=(b"%PDF-1.7 data",), headers=None, json_data=None, fail_mid=False):
        self.status_code = status
        self.chunks = list(chunks)
        self.headers = headers or {}
        self._json = json_data
        self.fail_mid = fail_mid
        self.closed = False

    def json(self):
        if self._json is None:
            raise ValueError("no json")
        return self._json

    def iter_content(self, chunk_size):
        for chunk in self.chunks:
            yield chunk
        if self.fail_mid:
            raise requests.ConnectionError("reset")

    def close(self):
        self.closed = True


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-public-key")
    get_settings.cache_clear()
    seen = {}

    def install(response=None, exc=None):
        def fake_get(url, **kwargs):
            seen.update(url=url, **kwargs)
            if exc is not None:
                raise exc
            seen["response"] = response
            return response
        monkeypatch.setattr(storage.requests, "get", fake_get)
        return seen
    return install


def download(max_bytes=1024):
    return storage.download_object("incomplete-exam-proofs", PATH, TOKEN, max_bytes=max_bytes)


def test_downloads_with_the_staff_session(configured):
    seen = configured(FakeResponse(chunks=(b"%PDF-", b"1.7")))
    assert download() == b"%PDF-1.7"
    assert seen["url"] == ("https://project.supabase.co/storage/v1/object/authenticated/"
                           "incomplete-exam-proofs/STUD_INCRQ_INC2_900001/medical%20report.pdf")
    assert seen["headers"] == {"apikey": "anon-public-key", "Authorization": f"Bearer {TOKEN}"}
    assert seen["stream"] is True and seen["allow_redirects"] is False and seen["timeout"] == (20.0, 20.0)
    assert seen["response"].closed


@pytest.mark.parametrize("response, error", [
    (FakeResponse(404), storage.StorageObjectNotFoundError),
    (FakeResponse(400, json_data={"statusCode": "404", "error": "not_found", "message": "Object not found"}),
     storage.StorageObjectNotFoundError),
    (FakeResponse(400, json_data={"statusCode": "400", "error": "invalid"}), storage.StorageUnavailableError),
    (FakeResponse(401), storage.StorageAccessDeniedError),
    (FakeResponse(403), storage.StorageAccessDeniedError),
    (FakeResponse(500), storage.StorageUnavailableError),
    (FakeResponse(302), storage.StorageUnavailableError),
])
def test_status_mapping(configured, response, error):
    configured(response)
    with pytest.raises(error) as raised:
        download()
    assert TOKEN not in str(raised.value) and PATH not in str(raised.value) and response.closed


def test_network_errors_never_carry_the_token(configured, caplog):
    configured(exc=requests.ConnectionError(f"failed for Bearer {TOKEN}"))
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(storage.StorageUnavailableError) as raised:
            download()
    assert TOKEN not in str(raised.value) and raised.value.__cause__ is None and TOKEN not in caplog.text


def test_interrupted_download(configured):
    configured(FakeResponse(fail_mid=True))
    with pytest.raises(storage.StorageUnavailableError):
        download()


def test_declared_size_over_the_limit(configured):
    response = FakeResponse(headers={"Content-Length": "2048"})
    configured(response)
    with pytest.raises(storage.StorageObjectTooLargeError):
        download(max_bytes=1024)
    assert response.closed


def test_streamed_size_over_the_limit(configured):
    configured(FakeResponse(chunks=(b"x" * 600, b"x" * 600)))
    with pytest.raises(storage.StorageObjectTooLargeError):
        download(max_bytes=1024)


def test_not_configured_or_no_token_makes_no_request(configured, monkeypatch):
    seen = configured(FakeResponse())
    with pytest.raises(storage.StorageAccessDeniedError):
        storage.download_object("incomplete-exam-proofs", PATH, "  ", max_bytes=10)
    monkeypatch.setenv("SUPABASE_ANON_KEY", "")
    get_settings.cache_clear()
    with pytest.raises(storage.StorageNotConfiguredError):
        download()
    assert "url" not in seen


def test_only_get_is_used():
    source = inspect.getsource(storage)
    assert "requests.get(" in source
    for verb in ("requests.post", "requests.put", "requests.delete", "requests.patch"):
        assert verb not in source
