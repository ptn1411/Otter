"""Uniform driver interface. Every engine implements these methods so
the CLI, the safety gate, and (later) the MCP wrapper see one shape."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[tuple]
    truncated: bool = False
    elapsed: float = 0.0
    rowcount: int = -1  # rows returned, or affected rows for writes


@dataclass
class DriverConfig:
    host: str = "127.0.0.1"
    port: int | None = None
    user: str | None = None
    password: str | None = None
    database: str | None = None
    timeout: int = 30
    extra: dict = field(default_factory=dict)


class BaseDriver:
    """One uniform interface for every engine."""

    engine = "base"
    default_port: int | None = None
    # pip package(s) to install; empty means stdlib-only.
    package_hint = ""

    def __init__(self, config: DriverConfig):
        self.config = config
        self.conn = None

    def connect(self) -> None:
        raise NotImplementedError

    def list_databases(self) -> list[str]:
        raise NotImplementedError

    def list_tables(self) -> list[str]:
        raise NotImplementedError

    def describe_table(self, table: str) -> list[tuple]:
        """Rows of (column, type, nullable, extra) — shape varies by
        engine for document stores; see each driver."""
        raise NotImplementedError

    def run_query(self, statement: str, limit: int) -> QueryResult:
        raise NotImplementedError

    def server_info(self) -> dict:
        raise NotImplementedError

    def close(self) -> None:
        self.conn = None

    # -- shared helpers -------------------------------------------------
    def _apply_limit(self, rows: list[tuple], limit: int) -> tuple[list[tuple], bool]:
        if limit and limit > 0 and len(rows) > limit:
            return rows[:limit], True
        return rows, False
