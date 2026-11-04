"""Profile store tests: round-trip in a temp home, and proof that no
password can ever be persisted."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dbm import profiles
from dbm.errors import ProfileError


class TestProfiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = os.environ.get("DBM_HOME")
        os.environ["DBM_HOME"] = self.tmp.name

    def tearDown(self):
        if self.old is None:
            os.environ.pop("DBM_HOME", None)
        else:
            os.environ["DBM_HOME"] = self.old
        self.tmp.cleanup()

    def test_add_get_remove_round_trip(self):
        profiles.add_profile("local", {
            "type": "sqlite", "database": "/tmp/x.db",
        })
        got = profiles.get_profile("local")
        self.assertEqual(got["type"], "sqlite")
        self.assertEqual(got["database"], "/tmp/x.db")
        profiles.add_profile("remote", {
            "type": "postgres", "host": "db.example.com", "port": 5432,
            "user": "app", "database": "app", "password_env": "APP_DB_PASS",
            "ssh": {"host": "bastion.example.com", "user": "deploy",
                    "key": "/home/user/.ssh/id_ed25519"},
        })
        self.assertEqual(sorted(profiles.load_profiles()), ["local", "remote"])
        profiles.remove_profile("local")
        with self.assertRaises(ProfileError):
            profiles.get_profile("local")

    def test_password_fields_rejected(self):
        for bad in ("password", "passwd", "secret", "connection_string"):
            with self.assertRaises(ProfileError, msg=bad):
                profiles.add_profile("bad", {"type": "sqlite", bad: "hunter2"})
        with self.assertRaises(ProfileError):
            profiles.add_profile("bad2", {
                "type": "postgres", "ssh": {"host": "h", "password": "x"},
            })

    def test_no_password_in_file(self):
        profiles.add_profile("p", {
            "type": "postgres", "host": "db.example.com",
            "password_env": "MY_DB_PASSWORD",
        })
        content = profiles.profiles_path().read_text(encoding="utf-8")
        data = json.loads(content)
        self.assertNotIn("hunter2", content)
        # The only credential-adjacent value is the env var NAME, not a secret.
        self.assertEqual(data["p"]["password_env"], "MY_DB_PASSWORD")

    def test_unknown_profile_error_names_known(self):
        profiles.add_profile("only", {"type": "sqlite"})
        with self.assertRaises(ProfileError) as ctx:
            profiles.get_profile("nope")
        self.assertIn("only", str(ctx.exception))

    def test_duplicate_rejected(self):
        profiles.add_profile("dup", {"type": "sqlite"})
        with self.assertRaises(ProfileError):
            profiles.add_profile("dup", {"type": "sqlite"})


if __name__ == "__main__":
    unittest.main()
