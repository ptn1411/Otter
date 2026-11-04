"""Driver registry. Adding a driver = one class + one register() call.

Imports are defensive: a driver module that fails to import (missing
optional dependency) still registers its class, and the class itself
raises DriverMissingError with the pip package name at connect time.
"""

from __future__ import annotations

from .base import BaseDriver

_REGISTRY: dict[str, type[BaseDriver]] = {}


def register(driver_cls: type[BaseDriver]) -> None:
    _REGISTRY[driver_cls.engine] = driver_cls


def get_driver(engine: str) -> type[BaseDriver]:
    if engine not in _REGISTRY:
        from ..errors import ProfileError

        raise ProfileError(
            f"unknown engine '{engine}'; known: {', '.join(sorted(_REGISTRY))}"
        )
    return _REGISTRY[engine]


def list_drivers() -> list[dict]:
    out = []
    for engine in sorted(_REGISTRY):
        cls = _REGISTRY[engine]
        out.append({
            "engine": engine,
            "default_port": cls.default_port,
            "package": cls.package_hint or "(stdlib, no install needed)",
            "implemented": cls.engine != "sqlserver",
        })
    return out


# Import each driver module; a missing optional dependency must not
# break the registry — the driver class raises at connect time instead.
from .sqlite import SQLiteDriver  # noqa: E402
from .postgres import PostgresDriver  # noqa: E402
from .mysql import MySQLDriver  # noqa: E402
from .mongodb import MongoDriver  # noqa: E402
from .redis import RedisDriver  # noqa: E402
from .sqlserver import SQLServerDriver  # noqa: E402

register(SQLiteDriver)
register(PostgresDriver)
register(MySQLDriver)
register(MongoDriver)
register(RedisDriver)
register(SQLServerDriver)
