"""Safety classifier tests: reads pass, writes and tricks are refused."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dbm.safety import classify, classify_mongo, classify_redis, split_sql_statements


class TestSqlReads(unittest.TestCase):
    def test_select(self):
        ok, _ = classify("sqlite", "SELECT * FROM users")
        self.assertTrue(ok)

    def test_leading_whitespace_and_comments(self):
        ok, _ = classify("sqlite", "  \n -- a comment\n SELECT 1")
        self.assertTrue(ok)
        ok, _ = classify("sqlite", "/* header */ SELECT 1")
        self.assertTrue(ok)

    def test_show_describe_explain(self):
        for stmt in ("SHOW TABLES", "DESCRIBE users", "DESC users", "EXPLAIN SELECT 1"):
            ok, _ = classify("sqlite", stmt)
            self.assertTrue(ok, stmt)

    def test_with_read_cte(self):
        ok, _ = classify("sqlite", "WITH t AS (SELECT 1) SELECT * FROM t")
        self.assertTrue(ok)

    def test_semicolon_inside_string_is_not_a_statement(self):
        stmts = split_sql_statements("SELECT '; DROP TABLE x'")
        self.assertEqual(len(stmts), 1)
        ok, _ = classify("sqlite", "SELECT '; DROP TABLE x'")
        self.assertTrue(ok)


class TestSqlWrites(unittest.TestCase):
    def test_write_starters_refused(self):
        for stmt in (
            "INSERT INTO users VALUES (1)",
            "UPDATE users SET x = 1",
            "DELETE FROM users",
            "DROP TABLE users",
            "CREATE TABLE x (a INT)",
            "ALTER TABLE users ADD COLUMN y INT",
            "TRUNCATE TABLE users",
            "GRANT SELECT ON users TO bob",
        ):
            ok, reason = classify("sqlite", stmt)
            self.assertFalse(ok, stmt)
            self.assertIn("not a read", reason)

    def test_multi_statement_with_write_refused(self):
        ok, _ = classify("sqlite", "SELECT 1; DELETE FROM users")
        self.assertFalse(ok)

    def test_multi_read_statements_allowed(self):
        ok, _ = classify("sqlite", "SELECT 1; SELECT 2")
        self.assertTrue(ok)

    def test_comment_tricks_refused(self):
        for stmt in (
            "/* nothing */ DELETE FROM users",
            "-- just a comment\nDROP TABLE users",
            "/* x */ /* y */ UPDATE users SET a = 1",
        ):
            ok, _ = classify("sqlite", stmt)
            self.assertFalse(ok, stmt)

    def test_with_containing_write_refused(self):
        ok, _ = classify(
            "sqlite", "WITH t AS (SELECT 1) DELETE FROM users")
        self.assertFalse(ok)

    def test_empty_refused(self):
        ok, _ = classify("sqlite", "   ;  ")
        self.assertFalse(ok)


class TestMongoRedisClassifier(unittest.TestCase):
    def test_mongo_reads(self):
        for doc in (
            '{"op": "find", "collection": "users"}',
            '{"op": "aggregate", "collection": "o", "pipeline": []}',
            '{"op": "count", "collection": "users"}',
        ):
            ok, _ = classify_mongo(doc)
            self.assertTrue(ok, doc)

    def test_mongo_writes_refused(self):
        for doc in (
            '{"op": "insert", "collection": "users"}',
            '{"op": "delete", "collection": "users"}',
            '{"op": "drop", "collection": "users"}',
            "not json at all",
            '{"collection": "users"}',
        ):
            ok, _ = classify_mongo(doc)
            self.assertFalse(ok, doc)

    def test_redis_reads(self):
        for cmd in ("GET mykey", "KEYS user:*", "TYPE mykey", "INFO", "HGETALL h"):
            ok, _ = classify_redis(cmd)
            self.assertTrue(ok, cmd)

    def test_redis_writes_refused(self):
        for cmd in ("SET k v", "DEL k", "FLUSHALL", "FLUSHDB", "EVAL x 0"):
            ok, _ = classify_redis(cmd)
            self.assertFalse(ok, cmd)


if __name__ == "__main__":
    unittest.main()
