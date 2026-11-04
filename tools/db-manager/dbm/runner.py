"""Connection resolution: profile -> optional SSH tunnel -> driver.

This is the only place that touches passwords, and it never stores or
prints them: the password comes from the profile's named env var, or
from an interactive getpass prompt at connect time.
"""

from __future__ import annotations

import getpass
import sys
from contextlib import ExitStack

from .drivers import get_driver
from .drivers.base import DriverConfig
from .errors import ConnectionFailed
from .profiles import get_profile, resolve_password
from .ssh import SSHTunnel


class Connection:
    """A live driver connection plus its (optional) tunnel."""

    def __init__(self, driver, stack: ExitStack, profile_name: str, profile: dict):
        self.driver = driver
        self._stack = stack
        self.profile_name = profile_name
        self.profile = profile

    def close(self) -> None:
        try:
            self.driver.close()
        finally:
            self._stack.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


def open_connection(profile_name: str, timeout: int) -> Connection:
    profile = get_profile(profile_name)
    engine = profile["type"]
    driver_cls = get_driver(engine)

    host = profile.get("host", "127.0.0.1")
    port = profile.get("port") or driver_cls.default_port

    stack = ExitStack()
    try:
        ssh = profile.get("ssh")
        if ssh:
            tunnel = SSHTunnel(
                ssh_host=ssh["host"],
                ssh_user=ssh["user"],
                ssh_port=int(ssh.get("port", 22)),
                ssh_key=ssh.get("key"),
                db_host=profile.get("host", "127.0.0.1"),
                db_port=int(port) if port else 0,
                connect_timeout=timeout,
            )
            local_port = stack.enter_context(tunnel)
            host, port = "127.0.0.1", local_port

        password = resolve_password(profile)
        if password is None and engine != "sqlite" and profile.get("user"):
            # Only prompt when a user is set (i.e. auth is plausible) and
            # stdin is a terminal; scripts must use --password-env.
            if sys.stdin.isatty():
                password = getpass.getpass(
                    f"Password for {profile.get('user')}@{profile_name} "
                    "(leave empty for none): "
                ) or None
            # Non-tty with no env var: proceed without a password; the
            # driver will report an auth failure if one is required.

        config = DriverConfig(
            host=host,
            port=int(port) if port else None,
            user=profile.get("user"),
            password=password,
            database=profile.get("database"),
            timeout=timeout,
        )
        driver = driver_cls(config)
        try:
            driver.connect()
        except Exception:
            stack.close()
            raise
        return Connection(driver, stack, profile_name, profile)
    except Exception:
        stack.close()
        raise
