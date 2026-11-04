"""Connection profiles stored as JSON.

Location: $DBM_HOME/profiles.json, else ~/.config/dbm/profiles.json.
A profile stores host/port/user/database/type/ssh — NEVER a password.
Password handling at connect time only:
  * profile["password_env"] names an environment variable holding it, or
  * the CLI prompts with getpass (never echoed, never stored).

Any profile dict containing a password-like key is rejected on load and
on add, so a password can never slip into the file by accident.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from .errors import ProfileError

PASSWORD_KEYS = {
    "password", "passwd", "pwd", "secret", "token", "passphrase",
    "connection_string", "dsn",
}
VALID_TYPES = {"sqlite", "postgres", "mysql", "mongodb", "redis", "sqlserver"}


def profiles_path() -> Path:
    home = os.environ.get("DBM_HOME")
    if home:
        return Path(home) / "profiles.json"
    return Path.home() / ".config" / "dbm" / "profiles.json"


def _reject_passwords(data: dict) -> None:
    for key in data:
        if key.lower() in PASSWORD_KEYS:
            raise ProfileError(
                f"refusing to store credential field '{key}' in a profile; "
                "use --password-env to name an environment variable instead"
            )
    ssh = data.get("ssh")
    if isinstance(ssh, dict):
        for key in ssh:
            if key.lower() in PASSWORD_KEYS:
                raise ProfileError(
                    f"refusing to store credential field 'ssh.{key}' in a profile"
                )


def load_profiles() -> dict:
    path = profiles_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise ProfileError(f"cannot read profiles file {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ProfileError(f"profiles file {path} must contain a JSON object")
    for name, profile in data.items():
        if not isinstance(profile, dict):
            raise ProfileError(f"profile '{name}' is not an object")
        _reject_passwords(profile)
    return data


def _save_profiles(data: dict) -> None:
    path = profiles_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    os.replace(tmp, path)


def add_profile(name: str, profile: dict) -> None:
    if not name or not name.replace("-", "").replace("_", "").isalnum():
        raise ProfileError("profile name must be alphanumeric, '-' or '_'")
    if profile.get("type") not in VALID_TYPES:
        raise ProfileError(
            f"unknown database type '{profile.get('type')}'; "
            f"valid types: {', '.join(sorted(VALID_TYPES))}"
        )
    _reject_passwords(profile)
    data = load_profiles()
    if name in data:
        raise ProfileError(f"profile '{name}' already exists (remove it first)")
    data[name] = profile
    _save_profiles(data)


def remove_profile(name: str) -> None:
    data = load_profiles()
    if name not in data:
        raise ProfileError(f"unknown profile '{name}'")
    del data[name]
    _save_profiles(data)


def get_profile(name: str) -> dict:
    data = load_profiles()
    if name not in data:
        known = ", ".join(sorted(data)) or "(none)"
        raise ProfileError(f"unknown profile '{name}'; known profiles: {known}")
    return data[name]


def resolve_password(profile: dict) -> str | None:
    """Password from the named env var, else None (caller may prompt)."""
    env_name = profile.get("password_env")
    if env_name:
        return os.environ.get(env_name)
    return None
