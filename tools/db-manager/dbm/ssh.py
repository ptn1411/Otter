"""Key-only SSH local-forward tunnel, in the spirit of the project's
VPS-SSH tools: a profile declares ssh {host, user, port, key} and we open
`ssh -N -L <local>:<db_host>:<db_port>` as a subprocess context manager.

Security properties:
  * -o BatchMode=yes: password auth is impossible; key or nothing.
  * The command line never contains a password.
  * The tunnel runs in its own process group and is killed on exit,
    including on exceptions, via os.killpg.
"""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import time
from contextlib import AbstractContextManager

from .errors import ConnectionFailed


def pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def build_ssh_command(
    *,
    ssh_host: str,
    ssh_user: str,
    ssh_port: int = 22,
    ssh_key: str | None = None,
    local_port: int,
    db_host: str,
    db_port: int,
    connect_timeout: int = 30,
) -> list[str]:
    cmd = [
        "ssh", "-N",
        "-L", f"{local_port}:{db_host}:{db_port}",
        "-o", "BatchMode=yes",
        "-o", "ExitOnForwardFailure=yes",
        "-o", "ServerAliveInterval=30",
        "-o", f"ConnectTimeout={connect_timeout}",
    ]
    if ssh_key:
        cmd += ["-i", ssh_key]
    if ssh_port != 22:
        cmd += ["-p", str(ssh_port)]
    cmd.append(f"{ssh_user}@{ssh_host}")
    return cmd


def _port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


class SSHTunnel(AbstractContextManager):
    """Context manager: open the forward, yield the local port, kill it."""

    def __init__(
        self,
        *,
        ssh_host: str,
        ssh_user: str,
        ssh_port: int = 22,
        ssh_key: str | None = None,
        db_host: str,
        db_port: int,
        local_port: int | None = None,
        connect_timeout: int = 30,
    ):
        self.ssh_host = ssh_host
        self.ssh_user = ssh_user
        self.ssh_port = ssh_port
        self.ssh_key = ssh_key
        self.db_host = db_host
        self.db_port = db_port
        self.local_port = local_port or pick_free_port()
        self.connect_timeout = connect_timeout
        self.proc: subprocess.Popen | None = None

    @property
    def command(self) -> list[str]:
        return build_ssh_command(
            ssh_host=self.ssh_host,
            ssh_user=self.ssh_user,
            ssh_port=self.ssh_port,
            ssh_key=self.ssh_key,
            local_port=self.local_port,
            db_host=self.db_host,
            db_port=self.db_port,
            connect_timeout=self.connect_timeout,
        )

    def __enter__(self) -> int:
        try:
            self.proc = subprocess.Popen(
                self.command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except OSError as exc:
            raise ConnectionFailed(f"could not start ssh: {exc}") from exc
        deadline = time.monotonic() + self.connect_timeout
        while time.monotonic() < deadline:
            if self.proc.poll() is not None:
                raise ConnectionFailed(
                    "ssh tunnel exited immediately; check host, user, key and "
                    "that the remote host allows TCP forwarding"
                )
            if _port_open(self.local_port):
                return self.local_port
            time.sleep(0.25)
        self.__exit__(None, None, None)
        raise ConnectionFailed(
            f"ssh tunnel did not come up within {self.connect_timeout}s"
        )

    def __exit__(self, exc_type, exc, tb) -> bool:
        proc = self.proc
        self.proc = None
        if proc is not None and proc.poll() is None:
            if hasattr(os, "killpg"):
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except (ProcessLookupError, PermissionError):
                    pass
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    if hasattr(signal, "SIGKILL"):
                        try:
                            os.killpg(proc.pid, signal.SIGKILL)
                        except (ProcessLookupError, PermissionError):
                            pass
                    proc.wait(timeout=5)
            else:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)
        return False
