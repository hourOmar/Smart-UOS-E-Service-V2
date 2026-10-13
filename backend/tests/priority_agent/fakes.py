"""
Minimal in-memory stand-in for the supabase-py client, used by the
retrieval-layer unit tests so they do not depend on a live Supabase
project. It mimics only the slice of the fluent query API this project
uses: client.table(name).select(columns).eq(col, val)....execute().
"""

from dataclasses import dataclass


@dataclass
class FakeResponse:
    data: list[dict]


class FakeQuery:
    def __init__(self, rows: list[dict]):
        self._rows = rows

    def select(self, columns: str) -> "FakeQuery":
        return self

    def eq(self, column: str, value: object) -> "FakeQuery":
        self._rows = [row for row in self._rows if row.get(column) == value]
        return self

    def in_(self, column: str, values: list) -> "FakeQuery":
        value_set = set(values)
        self._rows = [row for row in self._rows if row.get(column) in value_set]
        return self

    def execute(self) -> FakeResponse:
        return FakeResponse(data=list(self._rows))


class FakeSupabaseClient:
    def __init__(self, tables: dict[str, list[dict]]):
        self._tables = tables

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(list(self._tables.get(name, [])))
