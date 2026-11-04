"""MongoDB driver — optional import (pymongo). Document-style commands,
not SQL.

run_query accepts a JSON document:
  {"op": "find", "collection": "users", "filter": {"active": true}, "limit": 10}
  {"op": "aggregate", "collection": "orders", "pipeline": [...]}
  {"op": "count", "collection": "users", "filter": {...}}
list_tables() lists collections; describe_table() reports field names
and observed types from a sample document. NOT live-tested here
(no server and no driver on this VM); see README.
"""

from __future__ import annotations

import json
import time

from ..errors import ConnectionFailed, DriverMissingError, QueryFailed
from ..safety import classify_mongo
from .base import BaseDriver, QueryResult

try:
    import pymongo  # type: ignore
except ImportError:  # pragma: no cover
    pymongo = None  # type: ignore


class MongoDriver(BaseDriver):
    engine = "mongodb"
    default_port = 27017
    package_hint = "pymongo"

    def connect(self) -> None:
        if pymongo is None:
            raise DriverMissingError("mongodb", self.package_hint)
        cfg = self.config
        try:
            self.conn = pymongo.MongoClient(
                host=cfg.host, port=cfg.port or self.default_port,
                username=cfg.user, password=cfg.password,
                serverSelectionTimeoutMS=cfg.timeout * 1000,
            )
            # Fail fast instead of hanging on first use.
            self.conn.admin.command("ping")
        except Exception as exc:
            raise ConnectionFailed(f"mongodb: {exc}") from exc

    def _db(self):
        if self.conn is None:
            raise ConnectionFailed("mongodb: not connected")
        if self.config.database:
            return self.conn[self.config.database]
        return self.conn.get_database()

    def list_databases(self) -> list[str]:
        if self.conn is None:
            raise ConnectionFailed("mongodb: not connected")
        return self.conn.list_database_names()

    def list_tables(self) -> list[str]:
        return self._db().list_collection_names()

    def describe_table(self, table: str) -> list[tuple]:
        doc = self._db()[table].find_one()
        if doc is None:
            return []
        return [
            (key, type(value).__name__, "YES", "")
            for key, value in doc.items()
        ]

    def run_query(self, statement: str, limit: int) -> QueryResult:
        ok, reason = classify_mongo(statement)
        if not ok:
            raise QueryFailed(f"mongodb command refused: {reason}")
        cmd = json.loads(statement)
        op = str(cmd.get("op", "")).lower()
        coll = self._db()[cmd["collection"]] if cmd.get("collection") else None
        start = time.monotonic()
        try:
            if op == "find":
                if coll is None:
                    raise QueryFailed("find requires a 'collection'")
                eff_limit = limit if (limit and limit > 0) else cmd.get("limit", 0)
                cursor = coll.find(cmd.get("filter", {}))
                if eff_limit:
                    cursor = cursor.limit(eff_limit + 1)
                docs = list(cursor)
                truncated = bool(eff_limit and len(docs) > eff_limit)
                docs = docs[:eff_limit] if eff_limit and truncated else docs
                keys = sorted({k for d in docs for k in d.keys()})
                rows = [tuple(d.get(k) for k in keys) for d in docs]
                return QueryResult(columns=keys, rows=rows, truncated=truncated,
                                   elapsed=time.monotonic() - start)
            if op == "aggregate":
                if coll is None:
                    raise QueryFailed("aggregate requires a 'collection'")
                docs = list(coll.aggregate(cmd.get("pipeline", [])))
                keys = sorted({k for d in docs for k in d.keys()})
                rows = [tuple(d.get(k) for k in keys) for d in docs]
                rows, truncated = self._apply_limit(rows, limit)
                return QueryResult(columns=keys, rows=rows, truncated=truncated,
                                   elapsed=time.monotonic() - start)
            if op == "count":
                if coll is None:
                    raise QueryFailed("count requires a 'collection'")
                n = coll.count_documents(cmd.get("filter", {}))
                return QueryResult(columns=["count"], rows=[(n,)],
                                   elapsed=time.monotonic() - start)
            if op == "distinct":
                if coll is None:
                    raise QueryFailed("distinct requires a 'collection'")
                values = coll.distinct(cmd["field"], cmd.get("filter", {}))
                rows, truncated = self._apply_limit([(v,) for v in values], limit)
                return QueryResult(columns=[cmd["field"]], rows=rows,
                                   truncated=truncated,
                                   elapsed=time.monotonic() - start)
            raise QueryFailed(f"unsupported MongoDB op '{op}'")
        except QueryFailed:
            raise
        except Exception as exc:
            raise QueryFailed(f"mongodb query failed: {exc}") from exc

    def server_info(self) -> dict:
        if self.conn is None:
            raise ConnectionFailed("mongodb: not connected")
        info = self.conn.server_info()
        return {"engine": "mongodb", "version": info.get("version"),
                "database": self.config.database}

    def close(self) -> None:
        if self.conn is not None:
            try:
                self.conn.close()
            except Exception:
                pass
        super().close()
