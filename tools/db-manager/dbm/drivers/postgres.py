"""PostgreSQL driver — optional import.

Prefers psycopg (v3, ``pip install "psycopg[binary]"``), falls back to
psycopg2 (``pip install psycopg2-binary``). If neither is present the
driver reports exactly that instead of crashing. NOT live-tested here
(no server and no driver on this VM); see README.
"""

from __future__ import annotations

import time

from ..errors import ConnectionFailed, DriverMissingError, QueryFailed
from ..safety import split_sql_statements
from .base import BaseDriver, QueryResult

try:
    import psycopg as _pg  # type: ignore

    _FLAVOUR = "psycopg"
except ImportError:  # pragma: no cover - depends on installed packages
    try:
        import psycopg2 as _pg  # type: ignore

        _FLAVOUR = "psycopg2"
    except ImportError:
        _pg = None  # type: ignore
        _FLAVOUR = ""


class PostgresDriver(BaseDriver):
    engine = "postgres"
    default_port = 5432
    package_hint = '"psycopg[binary]" (preferred) or psycopg2-binary'

    def connect(self) -> None:
        if _pg is None:
            raise DriverMissingError("postgres", self.package_hint)
        cfg = self.config
        kwargs = dict(
            host=cfg.host,
            port=cfg.port or self.default_port,
            user=cfg.user,
            password=cfg.password,
            dbname=cfg.database,
            connect_timeout=cfg.timeout,
        )
        kwargs = {k: v for k, v in kwargs.items() if v is not None}
        try:
            self.conn = _pg.connect(**kwargs)
        except Exception as exc:
            raise ConnectionFailed(f"postgres: {exc}") from exc

    def _cursor(self):
        if self.conn is None:
            raise ConnectionFailed("postgres: not connected")
        return self.conn.cursor()

    def list_databases(self) -> list[str]:
        cur = self._cursor()
        cur.execute("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY 1")
        return [row[0] for row in cur.fetchall()]

    def list_tables(self) -> list[str]:
        cur = self._cursor()
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') "
            "AND table_type = 'BASE TABLE' ORDER BY 1"
        )
        return [row[0] for row in cur.fetchall()]

    def describe_table(self, table: str) -> list[tuple]:
        cur = self._cursor()
        cur.execute(
            "SELECT column_name, data_type, is_nullable, column_default "
            "FROM information_schema.columns WHERE table_name = %s "
            "ORDER BY ordinal_position",
            (table,),
        )
        return [tuple(row) for row in cur.fetchall()]

    def run_query(self, statement: str, limit: int) -> QueryResult:
        cur = self._cursor()
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
            self.conn.commit()
            return QueryResult(columns=columns, rows=rows, truncated=truncated,
                               elapsed=time.monotonic() - start, rowcount=rowcount)
        except Exception as exc:
            try:
                self.conn.rollback()
            except Exception:
                pass
            raise QueryFailed(f"postgres query failed: {exc}") from exc

    def server_info(self) -> dict:
        cur = self._cursor()
        cur.execute("SELECT version()")
        return {"engine": "postgres", "version": cur.fetchone()[0],
                "driver": _FLAVOUR, "database": self.config.database}

    def close(self) -> None:
        if self.conn is not None:
            try:
                self.conn.close()
            except Exception:
                pass
        super().close()
