"""SQLite driver — fully implemented, stdlib only. The only engine that
is live-tested on this VM. Supports file databases and :memory:."""

from __future__ import annotations

import sqlite3
import time

from ..errors import ConnectionFailed, QueryFailed
from ..safety import split_sql_statements
from .base import BaseDriver, DriverConfig, QueryResult


class SQLiteDriver(BaseDriver):
    engine = "sqlite"
    package_hint = ""  # stdlib sqlite3

    def connect(self) -> None:
        path = self.config.database or ":memory:"
        try:
            self.conn = sqlite3.connect(
                path, timeout=self.config.timeout, isolation_level=None
            )
        except sqlite3.Error as exc:
            raise ConnectionFailed(f"sqlite: cannot open {path}: {exc}") from exc
        self._deadline = None

    def _enforce_timeout(self, seconds: int) -> None:
        start = time.monotonic()

        def handler():
            return 1 if time.monotonic() - start > seconds else 0

        assert self.conn is not None
        self.conn.set_progress_handler(handler, 1000)

    def list_databases(self) -> list[str]:
        return [self.config.database or ":memory:"]

    def list_tables(self) -> list[str]:
        cur = self._cursor()
        cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        return [row[0] for row in cur.fetchall()]

    def describe_table(self, table: str) -> list[tuple]:
        cur = self._cursor()
        # Identifier quoting: double quotes, doubled inside.
        safe = '"' + table.replace('"', '""') + '"'
        cur.execute(f"PRAGMA table_info({safe})")
        return [
            (row[1], row[2], "NO" if (row[3] or row[5]) else "YES",
             "PK" if row[5] else "")
            for row in cur.fetchall()
        ]

    def run_query(self, statement: str, limit: int) -> QueryResult:
        cur = self._cursor()
        self._enforce_timeout(self.config.timeout)
        start = time.monotonic()
        try:
            rows: list[tuple] = []
            columns: list[str] = []
            truncated = False
            rowcount = -1
            for stmt in split_sql_statements(statement):
                cur.execute(stmt)
                if cur.description is not None:
                    columns = [d[0] for d in cur.description]
                    if limit and limit > 0:
                        rows = cur.fetchmany(limit + 1)
                        if len(rows) > limit:
                            rows, truncated = rows[:limit], True
                    else:
                        rows = cur.fetchall()
                else:
                    rowcount = cur.rowcount
            return QueryResult(
                columns=columns, rows=rows, truncated=truncated,
                elapsed=time.monotonic() - start, rowcount=rowcount,
            )
        except sqlite3.Error as exc:
            raise QueryFailed(f"sqlite query failed: {exc}") from exc
        finally:
            assert self.conn is not None
            self.conn.set_progress_handler(None, 0)

    def server_info(self) -> dict:
        cur = self._cursor()
        cur.execute("SELECT sqlite_version()")
        version = cur.fetchone()[0]
        return {
            "engine": "sqlite",
            "version": version,
            "database": self.config.database or ":memory:",
        }

    def close(self) -> None:
        if self.conn is not None:
            self.conn.close()
        super().close()

    def _cursor(self):
        if self.conn is None:
            raise ConnectionFailed("sqlite: not connected")
        return self.conn.cursor()
