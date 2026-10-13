"""
Low-level HTTP integration for the official UoS Computer Science degree
page. This module only fetches the raw page — parsing lives in
app/retrieval/uos_html_parser.py and app/retrieval/uos_academic_info.py.

We were given one exact official source and told not to substitute or
search for another:
https://www.sharjah.ac.ae/en/Academics/Degree/Undergraduate/Computer-Science
"""

import threading
import time

import requests

CS_DEGREE_PAGE_URL = (
    "https://www.sharjah.ac.ae/en/Academics/Degree/Undergraduate/Computer-Science"
)

_DEFAULT_TIMEOUT_SECONDS = 20.0
_USER_AGENT = (
    "Mozilla/5.0 (compatible; RequestPrioritizationAgent/1.0; "
    "University of Sharjah senior project research; contact via course staff)"
)


class UoSPageFetchError(Exception):
    """The official UoS CS degree page could not be fetched: network
    failure, timeout, or a non-200 HTTP response."""


def fetch_cs_degree_page(timeout: float = _DEFAULT_TIMEOUT_SECONDS) -> str:
    try:
        response = requests.get(
            CS_DEGREE_PAGE_URL,
            headers={"User-Agent": _USER_AGENT},
            timeout=timeout,
        )
    except requests.Timeout as exc:
        raise UoSPageFetchError(
            f"Timed out after {timeout}s fetching {CS_DEGREE_PAGE_URL}."
        ) from exc
    except requests.RequestException as exc:
        raise UoSPageFetchError(
            f"Failed to reach {CS_DEGREE_PAGE_URL}: {exc}"
        ) from exc

    if response.status_code != 200:
        raise UoSPageFetchError(
            f"Unexpected HTTP status {response.status_code} from "
            f"{CS_DEGREE_PAGE_URL}."
        )

    return response.text


# Added in the backend port: the page is shared by every run, so a successful
# fetch is reused for an hour. Failures are never cached.
_CACHE_SECONDS = 3600.0
_cache: tuple[float, str] | None = None
_cache_lock = threading.Lock()


def cached_cs_degree_page() -> str:
    global _cache
    with _cache_lock:
        if _cache is not None and time.monotonic() - _cache[0] < _CACHE_SECONDS:
            return _cache[1]
        html = fetch_cs_degree_page()
        _cache = (time.monotonic(), html)
        return html


def clear_cache() -> None:
    global _cache
    with _cache_lock:
        _cache = None
