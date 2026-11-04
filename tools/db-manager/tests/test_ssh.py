"""SSH tunnel tests: command construction and lifecycle, with a mocked
subprocess — never a real SSH connection."""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if not hasattr(os, "killpg"):
    os.killpg = lambda pid, sig: None

from dbm.errors import ConnectionFailed
from dbm.ssh import SSHTunnel, build_ssh_command


class TestCommandConstruction(unittest.TestCase):
    def test_basic_command(self):
        cmd = build_ssh_command(
            ssh_host="bastion.example.com", ssh_user="deploy",
            local_port=15432, db_host="db.internal", db_port=5432,
        )
        self.assertEqual(cmd[0], "ssh")
        self.assertIn("-N", cmd)
        self.assertIn("15432:db.internal:5432", cmd)
        self.assertIn("deploy@bastion.example.com", cmd)
        self.assertIn("BatchMode=yes", cmd)
        self.assertIn("ExitOnForwardFailure=yes", cmd)

    def test_key_and_port_flags(self):
        cmd = build_ssh_command(
            ssh_host="h", ssh_user="u", ssh_port=2222,
            ssh_key="/home/u/.ssh/id_ed25519",
            local_port=13306, db_host="db", db_port=3306,
        )
        self.assertIn("-i", cmd)
        self.assertIn("/home/u/.ssh/id_ed25519", cmd)
        self.assertIn("2222", cmd)

    def test_no_password_anywhere_in_argv(self):
        cmd = build_ssh_command(
            ssh_host="h", ssh_user="u", local_port=1234,
            db_host="db", db_port=5432,
        )
        joined = " ".join(cmd)
        for banned in ("password", "passwd", "hunter2"):
            self.assertNotIn(banned, joined.lower())


class FakeProc:
    def __init__(self, poll_result=None):
        self.pid = 4242
        self._poll_result = poll_result
        self.waited = False

    def poll(self):
        return self._poll_result

    def wait(self, timeout=None):
        self.waited = True
        return 0


class TestTunnelLifecycle(unittest.TestCase):
    def test_enter_yields_port_and_exit_kills_group(self):
        proc = FakeProc(poll_result=None)
        with mock.patch("dbm.ssh.subprocess.Popen", return_value=proc) as popen, \
             mock.patch("dbm.ssh._port_open", return_value=True), \
             mock.patch("dbm.ssh.os.killpg") as killpg:
            tunnel = SSHTunnel(
                ssh_host="bastion.example.com", ssh_user="deploy",
                ssh_key="/home/u/.ssh/id_ed25519",
                db_host="db.internal", db_port=5432, local_port=15432,
            )
            port = tunnel.__enter__()
            self.assertEqual(port, 15432)
            argv = popen.call_args.args[0]
            self.assertIn("15432:db.internal:5432", argv)
            self.assertNotIn("password", " ".join(argv).lower())
            tunnel.__exit__(None, None, None)
            killpg.assert_called_once()
            args, _ = killpg.call_args
            self.assertEqual(args[0], 4242)  # process group of the ssh proc

    def test_immediate_ssh_exit_is_a_clean_error(self):
        proc = FakeProc(poll_result=255)
        with mock.patch("dbm.ssh.subprocess.Popen", return_value=proc):
            tunnel = SSHTunnel(
                ssh_host="nope.example.com", ssh_user="u",
                db_host="db", db_port=5432, local_port=15433,
                connect_timeout=2,
            )
            with self.assertRaises(ConnectionFailed):
                tunnel.__enter__()

    def test_killed_on_exception_inside_context(self):
        proc = FakeProc(poll_result=None)
        with mock.patch("dbm.ssh.subprocess.Popen", return_value=proc), \
             mock.patch("dbm.ssh._port_open", return_value=True), \
             mock.patch("dbm.ssh.os.killpg") as killpg:
            tunnel = SSHTunnel(
                ssh_host="h", ssh_user="u", db_host="db", db_port=5432,
                local_port=15434,
            )
            try:
                with tunnel:
                    raise RuntimeError("boom")
            except RuntimeError:
                pass
            killpg.assert_called_once()


if __name__ == "__main__":
    unittest.main()
