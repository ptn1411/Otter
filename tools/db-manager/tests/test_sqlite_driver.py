"""SQLite driver end-to-end tests against a temp file DB, plus a CLI
smoke test through bin/dbm with a temp DBM_HOME. UTF-8 names included."""

import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dbm.drivers.base import DriverConfig
from dbm.drivers.sqlite import SQLiteDriver
from dbm.output import format_csv

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def make_driver(path: str) -> SQLiteDriver:
    driver = SQLiteDriver(DriverConfig(database=path, timeout=30))
    driver.connect()
    return driver


class TestSQLiteDriver(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp.name, "test.db")
        self.driver = make_driver(self.db_path)
        cur = self.driver.conn.cursor()
        cur.execute(
            'CREATE TABLE "người_dùng" (id INTEGER PRIMARY KEY, "tên" TEXT, active INTEGER)'
        )
        for i in range(5):
            cur.execute(
                'INSERT INTO "người_dùng" ("tên", active) VALUES (?, ?)',
                (f"user-{i}", 1 if i % 2 == 0 else 0),
            )
        cur.execute("CREATE TABLE orders (id INTEGER PRIMARY KEY, total REAL)")

    def tearDown(self):
        self.driver.close()
        self.tmp.cleanup()

    def test_list_tables(self):
        tables = self.driver.list_tables()
        self.assertIn("người_dùng", tables)
        self.assertIn("orders", tables)

    def test_describe_table_utf8(self):
        cols = self.driver.describe_table("người_dùng")
        names = [c[0] for c in cols]
        self.assertEqual(names, ["id", "tên", "active"])

    def test_query_returns_rows(self):
        result = self.driver.run_query(
            'SELECT "tên" FROM "người_dùng" WHERE active = 1 ORDER BY id', 100)
        self.assertEqual(result.columns, ["tên"])
        self.assertEqual([r[0] for r in result.rows], ["user-0", "user-2", "user-4"])
        self.assertFalse(result.truncated)

    def test_limit_enforced_and_flagged(self):
        result = self.driver.run_query('SELECT * FROM "người_dùng"', 2)
        self.assertEqual(len(result.rows), 2)
        self.assertTrue(result.truncated)

    def test_limit_zero_means_unlimited(self):
        result = self.driver.run_query('SELECT * FROM "người_dùng"', 0)
        self.assertEqual(len(result.rows), 5)
        self.assertFalse(result.truncated)

    def test_export_csv_round_trip(self):
        result = self.driver.run_query('SELECT id, "tên" FROM "người_dùng" ORDER BY id', 0)
        text = format_csv(result.columns, result.rows)
        self.assertIn("tên", text)
        self.assertIn("user-3", text)

    def test_server_info(self):
        info = self.driver.server_info()
        self.assertEqual(info["engine"], "sqlite")
        self.assertTrue(info["version"])

    def test_list_databases(self):
        self.assertEqual(self.driver.list_databases(), [self.db_path])


class TestCliSmoke(unittest.TestCase):
    def test_profile_add_tables_query_json(self):
        with tempfile.TemporaryDirectory() as home:
            env = dict(os.environ, DBM_HOME=home)
            db_path = os.path.join(home, "cli.db")
            driver = make_driver(db_path)
            cur = driver.conn.cursor()
            cur.execute("CREATE TABLE t (a TEXT)")
            cur.execute("INSERT INTO t VALUES ('héllo')")
            driver.close()

            def run(*argv):
                return subprocess.run(
                    [sys.executable, os.path.join(PROJECT_DIR, "bin", "dbm"), *argv],
                    capture_output=True, text=True, env=env, cwd=PROJECT_DIR,
                )

            res = run("profile", "add", "--name", "local", "--type", "sqlite",
                      "--database", db_path)
            self.assertEqual(res.returncode, 0, res.stderr)
            res = run("--profile", "local", "--json", "tables")
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertIn("t", json.loads(res.stdout)["tables"])
            res = run("--profile", "local", "--json", "query", "SELECT a FROM t")
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertEqual(json.loads(res.stdout)["rows"], [["héllo"]])
            # Safe mode refuses a write through the CLI.
            res = run("--profile", "local", "query", "DELETE FROM t")
            self.assertNotEqual(res.returncode, 0)
            self.assertIn("refused", res.stderr)


if __name__ == "__main__":
    unittest.main()
