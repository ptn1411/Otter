# dbm — safe, uniform database manager (Phase 1: standalone CLI)

One CLI for SQLite, PostgreSQL, MySQL/MariaDB, MongoDB, Redis, and a
SQL Server stub — over direct connections or key-only SSH tunnels.
Read-only by default, because a mistaken paste should never drop a table.

> **Phase 1 only.** Phase 2 (MCP wrapper for the Otter daemon) is planned
> in [PLAN.md](PLAN.md) and is **not** implemented here.

## Requirements

- Python 3.12+ (tested on 3.12.3). No third-party packages for the core.
- Optional drivers only for non-SQLite engines (see table below).
- `ssh` on PATH if you use SSH-tunnelled profiles.

## Quickstart

```bash
cd ~/workspace/code/db-manager
chmod +x bin/dbm

# 1. A local SQLite profile (no server, no install, no password)
./bin/dbm profile add --name local --type sqlite --database ~/data/app.db

# 2. Look around — all read-only, no confirmation needed
./bin/dbm --profile local tables
./bin/dbm --profile local describe users
./bin/dbm --profile local query "SELECT * FROM users WHERE active = 1" --limit 20

# 3. Export a table
./bin/dbm --profile local export users --format csv --output users.csv
./bin/dbm --profile local export users --format json | head -20

# 4. Machine-readable output for scripts
./bin/dbm --profile local --json query "SELECT COUNT(*) FROM users"
```

`python3 -m dbm` from the project directory works the same as `./bin/dbm`.

## Profile examples (placeholders only — no real credentials here)

```bash
# PostgreSQL, password from an environment variable (never stored)
./bin/dbm profile add --name prod-pg --type postgres \
    --host db.internal --port 5432 --user app --database app \
    --password-env PROD_PG_PASSWORD
PROD_PG_PASSWORD='…' ./bin/dbm --profile prod-pg test

# MySQL / MariaDB
./bin/dbm profile add --name shop --type mysql \
    --host mysql.internal --user shop --database shop \
    --password-env SHOP_MYSQL_PASSWORD

# MongoDB (database = the database to use)
./bin/dbm profile add --name logs --type mongodb \
    --host mongo.internal --user reader --database logs \
    --password-env LOGS_MONGO_PASSWORD
./bin/dbm --profile logs query '{"op": "find", "collection": "events", "filter": {"level": "error"}, "limit": 10}'

# Redis (database = index number, e.g. 0)
./bin/dbm profile add --name cache --type redis --host redis.internal
./bin/dbm --profile cache query "KEYS session:*"

# SQL Server (stub — see driver table)
./bin/dbm profile add --name mssql --type sqlserver \
    --host sql.internal --user sa --database master
```

Profiles live in `~/.config/dbm/profiles.json` (or `$DBM_HOME/profiles.json`).
A profile **cannot** store a password: `profile add` rejects `password`,
`secret`, `connection_string`, and friends. At connect time the password
comes from the env var named by `--password-env`, or from an interactive
`getpass` prompt (terminal only; scripts must use the env var).

```bash
./bin/dbm profile list
./bin/dbm profile show prod-pg
./bin/dbm profile remove old-name   # asks for YES unless --yes
```

## SSH tunnel example

Like the project's VPS-SSH tools: key only, no password auth, tunnel
killed on exit even on errors.

```bash
./bin/dbm profile add --name prod-pg --type postgres \
    --host db.internal --user app --database app \
    --password-env PROD_PG_PASSWORD \
    --ssh-host bastion.example.com --ssh-user deploy \
    --ssh-key ~/.ssh/id_ed25519
# dbm opens: ssh -N -L <free-port>:db.internal:5432 -i ~/.ssh/id_ed25519 deploy@bastion.example.com
# (with -o BatchMode=yes, so password auth is impossible),
# connects through 127.0.0.1:<free-port>, and kills the tunnel on exit.
./bin/dbm --profile prod-pg tables
```

## Safety rules (the whole point)

- **Default mode is read-only.** Only `SELECT`/`WITH`/`SHOW`/`DESCRIBE`/
  `EXPLAIN` (and the Mongo/Redis read equivalents) run. The classifier
  strips comments and splits statements outside quotes, so
  `/* x */ DELETE …`, `-- hi\nDROP …`, and multi-statement payloads
  containing a write are all refused as a whole.
- **Writes need two explicit acts:** `--write` **and** an interactive
  confirmation that prints the profile name and the full statement and
  requires typing `YES` (`--yes` answers non-interactively for scripts
  but still requires `--write`).
- **`--dry-run`** prints exactly what would run and runs nothing.
- A refused write is never silently downgraded — it exits with code 2
  and a clear refusal message.
- **Defaults:** `--limit 100` rows, `--timeout 30`s, elapsed time always
  reported. `--limit 0` means no limit (explicit).
- `export` follows the same rules as `query`.

```bash
./bin/dbm --profile local query "DELETE FROM users"            # refused, exit 2
./bin/dbm --profile local query "DELETE FROM users" --write --dry-run   # preview only
./bin/dbm --profile local query "DELETE FROM users" --write    # prints statement, asks for YES
```

## Driver install table

| Engine | Status | Install |
|---|---|---|
| SQLite | Fully implemented, stdlib | nothing |
| PostgreSQL | Implemented, optional import | `pip install "psycopg[binary]"` (or `psycopg2-binary`) |
| MySQL / MariaDB | Implemented, optional import | `pip install pymysql` |
| MongoDB | Implemented, optional import | `pip install pymongo` |
| Redis | Implemented, optional import | `pip install redis` |
| SQL Server | Registry stub only | `pip install pyodbc` + Microsoft ODBC Driver 18 (then implement per the stub note) |

A missing driver never crashes the tool: it reports the exact pip
package to install (try `./bin/dbm info` to see the matrix).

MongoDB and Redis have no SQL: use JSON document commands
(`{"op": "find", ...}`) and key commands (`GET key`, `KEYS pattern`)
respectively — see [PLAN.md](PLAN.md) for the full command lists.

## Commands

```
dbm profile add|list|show|remove
dbm test | info | dbs | tables | describe TABLE
dbm query "STATEMENT" [--write] [--dry-run] [--yes]
dbm export TABLE --format csv|json [--output FILE]
```

Global flags: `--profile NAME`, `--json`, `--limit N`, `--timeout SECS`.
Full design, safety model, and the Phase 2 MCP plan: [PLAN.md](PLAN.md).

## Tests (stdlib unittest only)

```bash
python3 -m unittest discover -s tests -v
```

## What is NOT live-tested

- **PostgreSQL, MySQL, MongoDB, Redis:** implemented behind optional
  imports, but no server and no driver for them exist on this VM, so
  they are **not** verified end-to-end. They need a real server + the
  driver install above before first use.
- **SQL Server:** stub only — it registers and refuses to connect.
- **SSH tunnels:** command construction and lifecycle are tested with a
  mocked subprocess (never a real SSH connection). A real tunnel needs
  a reachable host and a key in the target's `authorized_keys`.
- Only **SQLite is fully verified here** (temp-file DB: tables, describe,
  query, limits, export, UTF-8 names, CLI smoke test, safe-mode refusal).
