"""SQL Server driver — REGISTRY STUB ONLY.

pyodbc needs a system ODBC driver that cannot be verified on this VM,
so this driver registers (so `dbm info` lists it with its install hint)
and refuses to connect rather than pretending to work. Implementing it
for real means: pip install pyodbc, install Microsoft's ODBC Driver 18
for SQL Server, then fill in connect()/run_query() following the
PostgresDriver pattern (parameter style %s -> ? for pyodbc).
"""

from __future__ import annotations

from ..errors import DriverMissingError
from .base import BaseDriver


class SQLServerDriver(BaseDriver):
    engine = "sqlserver"
    default_port = 1433
    package_hint = "pyodbc + Microsoft ODBC Driver 18 for SQL Server"

    def connect(self) -> None:
        raise DriverMissingError(
            "sqlserver", self.package_hint,
            extra="stub only in this release — see dbm/drivers/sqlserver.py",
        )

    def list_databases(self) -> list[str]:
        raise DriverMissingError("sqlserver", self.package_hint)

    def list_tables(self) -> list[str]:
        raise DriverMissingError("sqlserver", self.package_hint)

    def describe_table(self, table: str) -> list[tuple]:
        raise DriverMissingError("sqlserver", self.package_hint)

    def run_query(self, statement: str, limit: int):
        raise DriverMissingError("sqlserver", self.package_hint)

    def server_info(self) -> dict:
        raise DriverMissingError("sqlserver", self.package_hint)
