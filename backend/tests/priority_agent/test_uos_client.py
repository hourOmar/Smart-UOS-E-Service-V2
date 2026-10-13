"""
Tests for the low-level UoS HTTP client. Network calls are monkeypatched
so these never touch the live website.
"""

import requests
import pytest

from app.agents.raise_capacity_priority.integrations import uos_client


def test_timeout_raises_fetch_error(monkeypatch):
    def _raise_timeout(*args, **kwargs):
        raise requests.Timeout("simulated timeout")

    monkeypatch.setattr(uos_client.requests, "get", _raise_timeout)

    with pytest.raises(uos_client.UoSPageFetchError):
        uos_client.fetch_cs_degree_page()


def test_connection_error_raises_fetch_error(monkeypatch):
    def _raise_connection_error(*args, **kwargs):
        raise requests.ConnectionError("simulated DNS/connection failure")

    monkeypatch.setattr(uos_client.requests, "get", _raise_connection_error)

    with pytest.raises(uos_client.UoSPageFetchError):
        uos_client.fetch_cs_degree_page()


def test_non_200_status_raises_fetch_error(monkeypatch):
    class _FakeResponse:
        status_code = 404
        text = "Not Found"

    monkeypatch.setattr(uos_client.requests, "get", lambda *a, **k: _FakeResponse())

    with pytest.raises(uos_client.UoSPageFetchError):
        uos_client.fetch_cs_degree_page()


def test_successful_fetch_returns_page_text(monkeypatch):
    class _FakeResponse:
        status_code = 200
        text = "<html>ok</html>"

    monkeypatch.setattr(uos_client.requests, "get", lambda *a, **k: _FakeResponse())

    assert uos_client.fetch_cs_degree_page() == "<html>ok</html>"
