"""Statement classifier — the safety core of dbm.

Default mode is READ-ONLY. This module decides what counts as a read
before any driver sees the statement. It is deliberately NOT a prefix
check: comments are stripped and statements are split on semicolons
outside quotes, so comment tricks and multi-statement payloads cannot
smuggle a write past it.

SQL read starters: SELECT, WITH (a CTE that ends in a read), SHOW,
DESCRIBE, DESC, EXPLAIN.
SQL write starters: INSERT, UPDATE, DELETE, DROP, CREATE, ALTER,
TRUNCATE, GRANT, REVOKE, REPLACE, MERGE, CALL, and anything else.

MongoDB (JSON document commands): reads are op find/aggregate/count/
distinct; writes are insert/update/delete/drop/replace and friends.
Redis (command strings): reads are GET/KEYS/SCAN/TYPE/INFO/HGETALL/
LRANGE/SMEMBERS/TTL/EXISTS; writes are SET/DEL/FLUSH*/etc.
"""

from __future__ import annotations

import json
import re

SQL_READ = {"SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN"}
SQL_WRITE_HINTS = {
    "INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "TRUNCATE",
    "GRANT", "REVOKE", "REPLACE", "MERGE", "CALL", "VACUUM", "ATTACH",
    "DETACH", "PRAGMA",
}
MONGO_READ_OPS = {"find", "aggregate", "count", "distinct"}
MONGO_WRITE_OPS = {
    "insert", "insertone", "insertmany", "update", "updateone",
    "updatemany", "delete", "deleteone", "deletemany", "drop",
    "dropcollection", "replace", "replaceone", "findoneandupdate",
    "findoneanddelete", "findoneandreplace", "bulkwrite",
}
REDIS_READ_CMDS = {
    "GET", "KEYS", "SCAN", "TYPE", "INFO", "HGETALL", "LRANGE",
    "SMEMBERS", "TTL", "EXISTS", "HGET", "HMGET", "LLEN", "SCARD",
    "HLEN", "STRLEN", "PTTL",
}
REDIS_WRITE_CMDS = {
    "SET", "DEL", "FLUSHALL", "FLUSHDB", "HSET", "HDEL", "LPUSH",
    "RPUSH", "LPOP", "RPOP", "SADD", "SREM", "ZADD", "ZREM", "INCR",
    "DECR", "APPEND", "EXPIRE", "RENAME", "MOVE", "COPY", "MSET",
    "SETEX", "SETNX", "EVAL", "EVALSHA", "SCRIPT",
}


def _strip_sql_comments(text: str) -> str:
    """Remove --, # and /* */ comments, preserving quoted strings."""
    out: list[str] = []
    i, n = 0, len(text)
    quote = None
    while i < n:
        ch = text[i]
        if quote:
            out.append(ch)
            if ch == quote:
                # '' inside a string is an escaped quote in SQL.
                if i + 1 < n and text[i + 1] == quote:
                    out.append(text[i + 1])
                    i += 2
                    continue
                quote = None
            i += 1
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            out.append(ch)
            i += 1
            continue
        if text.startswith("--", i) or text.startswith("#", i):
            # Line comment: skip to end of line.
            j = text.find("\n", i)
            i = n if j == -1 else j
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j == -1 else j + 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def split_sql_statements(text: str) -> list[str]:
    """Split on ';' outside quotes and comments. Empty parts dropped."""
    statements: list[str] = []
    buf: list[str] = []
    i, n = 0, len(text)
    quote = None
    while i < n:
        ch = text[i]
        if quote:
            buf.append(ch)
            if ch == quote:
                if i + 1 < n and text[i + 1] == quote:
                    buf.append(text[i + 1])
                    i += 2
                    continue
                quote = None
            i += 1
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            buf.append(ch)
            i += 1
            continue
        if text.startswith("--", i) or text.startswith("#", i):
            j = text.find("\n", i)
            i = n if j == -1 else j
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j == -1 else j + 2
            continue
        if ch == ";":
            stmt = "".join(buf).strip()
            if stmt:
                statements.append(stmt)
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


def _first_keyword(statement: str) -> str:
    cleaned = _strip_sql_comments(statement).strip()
    m = re.match(r"([A-Za-z_]+)", cleaned)
    return m.group(1).upper() if m else ""


def _with_is_read(statement: str) -> bool:
    """A WITH statement is a read only if its main query is a read and
    it contains no write keyword as a whole word anywhere (CTEs cannot
    legitimately contain INSERT/UPDATE/DELETE in this tool)."""
    cleaned = _strip_sql_comments(statement)
    words = set(re.findall(r"[A-Za-z_]+", cleaned.upper()))
    if words & SQL_WRITE_HINTS:
        return False
    # The main query is the last top-level SELECT/EXPLAIN in the text;
    # simplest robust check: a WITH read must contain SELECT.
    return "SELECT" in words or "EXPLAIN" in words


def classify_sql(text: str) -> tuple[bool, str, list[str]]:
    """Return (is_read_only, reason, statements)."""
    statements = split_sql_statements(text)
    if not statements:
        return False, "empty statement", statements
    for stmt in statements:
        kw = _first_keyword(stmt)
        if kw == "WITH":
            if not _with_is_read(stmt):
                return False, f"WITH statement is not a pure read: {stmt[:80]}", statements
        elif kw not in SQL_READ:
            return False, f"statement starts with '{kw or '?'}', which is not a read", statements
    return True, "read-only", statements


def classify_mongo(text: str) -> tuple[bool, str]:
    try:
        doc = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return False, "MongoDB commands must be a JSON document, e.g. {\"op\": \"find\", \"collection\": \"users\"}"
    if not isinstance(doc, dict):
        return False, "MongoDB command must be a JSON object"
    op = str(doc.get("op", "")).lower().replace("_", "")
    if op in MONGO_READ_OPS:
        return True, "read-only"
    if op in MONGO_WRITE_OPS or op:
        return False, f"MongoDB op '{doc.get('op')}' is a write"
    return False, "MongoDB command needs an 'op' field"


def classify_redis(text: str) -> tuple[bool, str]:
    parts = text.strip().split()
    if not parts:
        return False, "empty command"
    cmd = parts[0].upper()
    if cmd in REDIS_READ_CMDS:
        return True, "read-only"
    return False, f"Redis command '{cmd}' is not a read"


def classify(engine: str, text: str) -> tuple[bool, str]:
    """Engine-aware classification. Returns (is_read_only, reason)."""
    if engine == "mongodb":
        ok, reason = classify_mongo(text)
        return ok, reason
    if engine == "redis":
        ok, reason = classify_redis(text)
        return ok, reason
    ok, reason, _ = classify_sql(text)
    return ok, reason


def require_read_or_raise(engine: str, text: str) -> None:
    from .errors import SafetyRefused

    ok, reason = classify(engine, text)
    if not ok:
        raise SafetyRefused(
            f"Refused in safe (read-only) mode: {reason}. "
            "Re-run with --write and confirm interactively, or use --dry-run "
            "to preview without executing."
        )
