"""
Shared low-level helper for issuing simple equality-filtered SELECT
queries against Supabase tables.

Kept in one place so every retrieval module in this package talks to the
Supabase client the same way, and so unit tests can substitute a fake
client without reconstructing the full method-chaining API for every
table.
"""

from typing import Any


def select_rows(
    client: Any,
    table: str,
    columns: str,
    filters: dict[str, Any],
) -> list[dict[str, Any]]:
    query = client.table(table).select(columns)
    for column, value in filters.items():
        query = query.eq(column, value)
    response = query.execute()
    return response.data or []


def select_rows_in(
    client: Any,
    table: str,
    columns: str,
    filters: dict[str, Any],
    in_column: str,
    in_values: list[Any],
) -> list[dict[str, Any]]:
    """Like select_rows, plus one WHERE ... IN (...) filter — used when a
    caller needs rows matching a whole set of values for one column
    (e.g. Takes rows for several prerequisite Course_IDs) without issuing
    one query per value."""
    query = client.table(table).select(columns)
    for column, value in filters.items():
        query = query.eq(column, value)
    query = query.in_(in_column, in_values)
    response = query.execute()
    return response.data or []
