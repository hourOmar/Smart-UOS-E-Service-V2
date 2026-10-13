"""A read-only stand-in for the slice of the supabase-py client that the ported
retrieval modules use: client.table(t).select(cols).eq(col, v).in_(col, vs).execute().

It runs on a connection from app.core.database.read_only(), so the ported
retrieval code is unchanged while the backend reads as its own database role.
Filters compare as text, like PostgREST's eq./in. filters do on these text
columns (e.g. Course_ID), and values come back JSON-shaped as PostgREST returns
them (dates and times as ISO text, numerics as numbers), so the ported Pydantic
schemas validate them exactly as before.

Only fixed tables and identifiers are accepted; values are always bound.
"""

import datetime
import re
import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy import bindparam, text
from sqlalchemy.engine import Connection

TABLES = frozenset({"Request", "Raise_Capacity", "Student", "Program", "Course", "Section", "Takes"})
_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _identifier(name: str) -> str:
    name = name.strip()
    if not _IDENTIFIER.match(name):
        raise ValueError(f"Not a plain identifier: {name!r}")
    return f'"{name}"'


def _filter_value(value: Any) -> str:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise TypeError(f"Unsupported filter value type: {type(value).__name__}")
    return str(value)


def _json_value(value: Any) -> Any:
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


@dataclass
class Response:
    data: list[dict]


class Query:
    def __init__(self, conn: Connection, table: str):
        if table not in TABLES:
            raise ValueError(f"Table not available to the priority agent: {table!r}")
        self._conn = conn
        self._table = table
        self._columns: list[str] = []
        self._filters: list[tuple[str, str, Any]] = []

    def select(self, columns: str) -> "Query":
        self._columns = [c.strip() for c in columns.split(",") if c.strip()]
        return self

    def eq(self, column: str, value: Any) -> "Query":
        self._filters.append(("eq", column, _filter_value(value)))
        return self

    def in_(self, column: str, values: list) -> "Query":
        self._filters.append(("in", column, [_filter_value(v) for v in values]))
        return self

    def execute(self) -> Response:
        if not self._columns:
            raise ValueError("select() must name the columns")
        where, params, expanding = [], {}, []
        for index, (kind, column, value) in enumerate(self._filters):
            name = f"p{index}"
            if kind == "eq":
                where.append(f"{_identifier(column)}::text = :{name}")
            else:
                where.append(f"{_identifier(column)}::text IN :{name}")
                expanding.append(name)
            params[name] = value
        sql = (f"SELECT {', '.join(_identifier(c) for c in self._columns)} "
               f"FROM public.{_identifier(self._table)}"
               + (f" WHERE {' AND '.join(where)}" if where else ""))
        statement = text(sql)
        if expanding:
            statement = statement.bindparams(*(bindparam(n, expanding=True) for n in expanding))
        if any(kind == "in" and not value for kind, _c, value in self._filters):
            return Response(data=[])  # IN () matches nothing, as with PostgREST
        rows = self._conn.execute(statement, params).mappings().all()
        return Response(data=[{k: _json_value(v) for k, v in row.items()} for row in rows])


class DatabaseClient:
    def __init__(self, conn: Connection):
        self._conn = conn

    def table(self, name: str) -> Query:
        return Query(self._conn, name)
