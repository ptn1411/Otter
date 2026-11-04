"""MySQL / MariaDB driver — optional import (pymysql).

NOT live-tested here (no server and no driver on this VM); see README.
"""

from __future__ import annotations

import time

from ..errors import ConnectionFailed, DriverMissingError, QueryFailed
from ..safety import split_sql_statements
from .base import BaseDriver, QueryResult

try:
    import pymysql  # type: ignore
except ImportError:  # pragma: no cover
    pymysql = None  # type: ignore


class MySQLDriver(BaseDriver):
    engine = "mysql"
    default_port = 3306
    package_hint = "pymysql"

    def connect(self) -> None:
        if pymysql is None:
            raise DriverMissingError("mysql", self.package_hint)
        cfg = self.config
        try:
            self.conn = pymysql.connect(
                host=cfg.host,
                port=cfg.port or self.default_port,
                user=cfg.user,
                password=cfg.password,
                database=cfg.database,
                connect_timeout=cfg.timeout,
                charset="utf8mb4",
                cursorclass=pymysql.cursors.Cursor,
            )
        except Exception as exc:
            raise ConnectionFailed(f"mysql: {exc}") from exc

    def _cursor(self):
        if self.conn is None:
            raise ConnectionFailed("mysql: not connected")
        return self.conn.cursor()

    def list_databases(self) -> list[str]:
        cur = self._cursor()
        cur.execute("SHOW DATABASES")
        return [row[0] for row in cur.fetchall()]

    def list_tables(self) -> list[str]:
        cur = self._cursor()
        if self.config.database:
            cur.execute("SHOW TABLES")
        else:
            cur.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema NOT IN "
                "('information_schema','mysql','performance_schema','sys') "
                "ORDER BY 1"
            )
        return [row[0] for row in cur.fetchall()]

    def describe_table(self, table: str) -> list[tuple]:
        cur = self._cursor()
        safe = "`" + table.replace("`", "``") + "`"
        cur.execute(f"DESCRIBE {safe}")
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
            raise QueryFailed(f"mysql query failed: {exc}") from exc

    def server_info(self) -> dict:
        cur = self._cursor()
        cur.execute("SELECT VERSION()")
        return {"engine": "mysql", "version": cur.fetchone()[0],
                "database": self.config.database}

    def close(self) -> None:
        if self.conn is not None:
            try:
                self.conn.close()
            except Exception:
                pass
        super().close()
