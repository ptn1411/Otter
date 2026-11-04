"""Error types for dbm. All user-facing failures are DbmError subclasses
so the CLI can print a clean message instead of a traceback."""


class DbmError(Exception):
    """Base class for all dbm errors."""


class DriverMissingError(DbmError):
    """The engine's optional driver is not installed."""

    def __init__(self, engine: str, package: str, extra: str = ""):
        self.engine = engine
        self.package = package
        msg = (
            f"Driver for '{engine}' is not installed. "
            f"Install it with: pip install {package}"
        )
        if extra:
            msg += f" ({extra})"
        super().__init__(msg)


class ProfileError(DbmError):
    """Unknown, duplicate, or malformed profile."""


class SafetyRefused(DbmError):
    """A statement was refused by the safety classifier."""


class ConnectionFailed(DbmError):
    """Could not connect to the database (or its SSH tunnel)."""


class QueryFailed(DbmError):
    """A query failed after passing the safety gate."""
