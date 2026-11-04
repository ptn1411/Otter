"""Redis driver — optional import (redis-py). Key commands, not SQL.

run_query accepts command strings: GET key, KEYS pattern, TYPE key,
INFO, SCAN, HGETALL key, LRANGE key 0 -1, SMEMBERS key, TTL key, ...
list_tables() returns top-level key namespaces (prefix before the first
':'); describe_table(namespace) samples keys and their types there.
NOT live-tested here (no server and no driver on this VM); see README.
"""

from __future__ import annotations

import time

from ..errors import ConnectionFailed, DriverMissingError, QueryFailed
from ..safety import classify_redis
from .base import BaseDriver, QueryResult

try:
    import redis as _redis  # type: ignore
except ImportError:  # pragma: no cover
    _redis = None  # type: ignore


class RedisDriver(BaseDriver):
    engine = "redis"
    default_port = 6379
    package_hint = "redis"

    def connect(self) -> None:
        if _redis is None:
            raise DriverMissingError("redis", self.package_hint)
        cfg = self.config
        try:
            self.conn = _redis.Redis(
                host=cfg.host, port=cfg.port or self.default_port,
                username=cfg.user, password=cfg.password,
                db=int(cfg.database) if cfg.database else 0,
                socket_connect_timeout=cfg.timeout,
                decode_responses=True,
            )
            self.conn.ping()
        except Exception as exc:
            raise ConnectionFailed(f"redis: {exc}") from exc

    def _client(self):
        if self.conn is None:
            raise ConnectionFailed("redis: not connected")
        return self.conn

    def list_databases(self) -> list[str]:
        return [self.config.database or "0"]

    def list_tables(self) -> list[str]:
        client = self._client()
        namespaces: set[str] = set()
        for key in client.scan_iter(match="*", count=1000):
            namespaces.add(key.split(":", 1)[0] if ":" in key else key)
            if len(namespaces) >= 1000:
                break
        return sorted(namespaces)

    def describe_table(self, namespace: str) -> list[tuple]:
        client = self._client()
        pattern = f"{namespace}:*" if ":" not in namespace else namespace
        rows = []
        for key in client.scan_iter(match=pattern, count=100):
            rows.append((key, client.type(key), "YES", ""))
            if len(rows) >= 20:
                break
        return rows

    def run_query(self, statement: str, limit: int) -> QueryResult:
        ok, reason = classify_redis(statement)
        if not ok:
            raise QueryFailed(f"redis command refused: {reason}")
        client = self._client()
        parts = statement.strip().split()
        cmd, args = parts[0].upper(), parts[1:]
        start = time.monotonic()
        try:
            if cmd == "INFO":
                info = client.info()
                rows = [(k, str(v)) for k, v in sorted(info.items())]
                rows, truncated = self._apply_limit(rows, limit)
                return QueryResult(columns=["key", "value"], rows=rows,
                                   truncated=truncated,
                                   elapsed=time.monotonic() - start)
            if cmd == "KEYS":
                pattern = args[0] if args else "*"
                keys = client.keys(pattern)
                rows, truncated = self._apply_limit([(k,) for k in keys], limit)
                return QueryResult(columns=["key"], rows=rows, truncated=truncated,
                                   elapsed=time.monotonic() - start)
            if cmd == "SCAN":
                pattern = args[0] if args else "*"
                keys = list(client.scan_iter(match=pattern, count=1000))
                rows, truncated = self._apply_limit([(k,) for k in keys], limit)
                return QueryResult(columns=["key"], rows=rows, truncated=truncated,
                                   elapsed=time.monotonic() - start)
            if cmd in ("GET", "TYPE", "TTL", "PTTL", "EXISTS", "STRLEN",
                       "LLEN", "SCARD", "HLEN"):
                if not args:
                    raise QueryFailed(f"{cmd} requires a key")
                value = getattr(client, cmd.lower())(args[0])
                return QueryResult(columns=["key", "value"],
                                   rows=[(args[0], value)],
                                   elapsed=time.monotonic() - start)
            if cmd == "HGETALL":
                if not args:
                    raise QueryFailed("HGETALL requires a key")
                data = client.hgetall(args[0])
                return QueryResult(columns=["field", "value"],
                                   rows=list(data.items()),
                                   elapsed=time.monotonic() - start)
            if cmd in ("HMGET", "HGET"):
                if len(args) < 2:
                    raise QueryFailed(f"{cmd} requires a key and field(s)")
                value = getattr(client, cmd.lower())(args[0], *args[1:])
                if isinstance(value, list):
                    rows = list(zip(args[1:], value))
                else:
                    rows = [(args[1], value)]
                return QueryResult(columns=["field", "value"], rows=rows,
                                   elapsed=time.monotonic() - start)
            if cmd == "LRANGE":
                if len(args) < 3:
                    raise QueryFailed("LRANGE requires key start stop")
                values = client.lrange(args[0], int(args[1]), int(args[2]))
                rows, truncated = self._apply_limit(
                    [(i, v) for i, v in enumerate(values)], limit)
                return QueryResult(columns=["index", "value"], rows=rows,
                                   truncated=truncated,
                                   elapsed=time.monotonic() - start)
            if cmd == "SMEMBERS":
                if not args:
                    raise QueryFailed("SMEMBERS requires a key")
                values = sorted(client.smembers(args[0]))
                rows, truncated = self._apply_limit([(v,) for v in values], limit)
                return QueryResult(columns=["member"], rows=rows,
                                   truncated=truncated,
                                   elapsed=time.monotonic() - start)
            raise QueryFailed(f"unsupported Redis read command '{cmd}'")
        except QueryFailed:
            raise
        except Exception as exc:
            raise QueryFailed(f"redis query failed: {exc}") from exc

    def server_info(self) -> dict:
        info = self._client().info()
        return {"engine": "redis",
                "version": info.get("redis_version"),
                "database": self.config.database or "0"}

    def close(self) -> None:
        if self.conn is not None:
            try:
                self.conn.close()
            except Exception:
                pass
        super().close()
