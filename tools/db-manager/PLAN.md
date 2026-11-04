# dbm — Plan

A standalone Python database manager for people who work with many databases
and cannot afford accidents. One uniform CLI for SQLite, PostgreSQL,
MySQL/MariaDB, MongoDB, Redis, (and a stub for SQL Server), over direct
connections or key-only SSH tunnels.

Status: **Phase 1 implemented** (standalone CLI, stdlib-only core).
Phase 2 (MCP wrapper for the Otter daemon) is **plan only** — not implemented.

## 1. Goals

- **One tool, many databases.** Same commands (`dbs`, `tables`, `describe`,
  `query`, `export`, `info`) regardless of engine. No re-learning per engine.
- **Safe by default.** Read-only unless the operator explicitly opts into
  writes, twice (`--write` + interactive confirmation). A mistaken paste
  must never drop a table.
- **No credentials on disk.** Profiles never store passwords. Passwords come
  from an environment variable (named by the profile) or an interactive
  `getpass` prompt. Connection strings containing passwords are never
  printed or logged.
- **SSH-first remote access.** Like the project's VPS-SSH tools: remote
  databases are reached through a key-only SSH local forward, killed on exit
  even on errors. No password SSH auth, ever.
- **Stdlib-only core.** The tool must run on any Python 3.12 box with zero
  installs for SQLite. Every other engine is an optional import with a
  clear "install X" error — never an ImportError traceback.
- **Script-friendly.** `--json` output for pipelines, `--limit` / `--timeout`
  defaults on every query, elapsed time always reported.
- **Optimized for working people.** Short commands, readable aligned tables
  by default, UTF-8 everywhere (Vietnamese table/column names work), and
  errors that say what to do next, not just what failed.

## 2. Architecture

```
db-manager/
├── dbm                     # executable entry script (shebang, sys.path shim)
├── dbm/
│   ├── __init__.py         # version
│   ├── __main__.py         # `python3 -m dbm`
│   ├── cli.py              # argparse, subcommands, output dispatch
│   ├── runner.py           # profile -> SSH tunnel -> driver -> execute
│   ├── safety.py           # statement classifier (the safety core)
│   ├── profiles.py         # JSON profile store, no passwords allowed
│   ├── ssh.py              # SSH local-forward context manager
│   ├── output.py           # aligned table / JSON / CSV formatters
│   ├── errors.py           # DbmError, DriverMissingError, SafetyRefused
│   └── drivers/
│       ├── __init__.py     # registry: register() + get_driver()
│       ├── base.py         # BaseDriver uniform interface
│       ├── sqlite.py       # fully implemented (stdlib sqlite3)
│       ├── postgres.py     # optional: psycopg[binary] > psycopg2
│       ├── mysql.py        # optional: pymysql
│       ├── mongodb.py      # optional: pymongo (document commands)
│       ├── redis.py        # optional: redis-py (key commands)
│       └── sqlserver.py    # registry stub only (pyodbc, not verified)
└── tests/                  # stdlib unittest only
```

### Data flow

```
CLI args -> resolve profile (JSON store)
        -> if profile.ssh: SSHTunnel (subprocess ssh -N -L ...)
        -> driver.connect(host=127.0.0.1, port=local_port, ...)
        -> safety.classify(statement)  [safe mode gate]
        -> driver.run_query(...) with limit + timeout
        -> formatter (table / json / csv) + elapsed time
        -> driver.close() + tunnel killed (finally block)
```

### Adding a driver = one class + one `register()` call

Every driver subclasses `BaseDriver` and implements exactly:

| Method | Meaning |
|---|---|
| `connect()` | Open the connection (raises `DriverMissingError` if the optional import is absent) |
| `list_databases()` | Names of databases/keyspaces |
| `list_tables()` | Tables (or collections / key namespaces for non-SQL engines) |
| `describe_table(name)` | Columns/fields with types |
| `run_query(statement, limit)` | Rows + column names, honouring `limit` |
| `server_info()` | Engine name + version string |
| `close()` | Release the connection |

`drivers/__init__.py` imports each driver module defensively: a missing
optional dependency registers the driver as *unavailable* instead of
crashing the import, so `dbm info` can list it with its install hint.

## 3. Driver matrix

| Engine | Type key | Status | Driver package | Verification |
|---|---|---|---|---|
| SQLite | `sqlite` | **Fully implemented** | stdlib `sqlite3` (no install) | Live-tested here: temp-file DB, tables, describe, query, export, limits |
| PostgreSQL | `postgres` | Implemented, optional import | `psycopg[binary]` preferred, `psycopg2` fallback | NOT live-tested (no server + driver on this VM) |
| MySQL / MariaDB | `mysql` | Implemented, optional import | `pymysql` | NOT live-tested (no server + driver on this VM) |
| MongoDB | `mongodb` | Implemented, optional import | `pymongo` | NOT live-tested (no server + driver on this VM) |
| Redis | `redis` | Implemented, optional import | `redis` | NOT live-tested (no server + driver on this VM) |
| SQL Server | `sqlserver` | **Registry stub only** | `pyodbc` (+ ODBC driver) | NOT implemented beyond the stub, NOT verified |

Notes on non-SQL engines:

- **MongoDB** has no SQL. `run_query` accepts a JSON document command:
  `{"op": "find", "collection": "users", "filter": {...}, "limit": 10}`,
  `{"op": "aggregate", ...}`, `{"op": "count", ...}`. `list_tables` lists
  collections; `describe_table` reports field names/types from a sample
  document. The safety classifier allows `find`/`aggregate`/`count`/
  `distinct` and rejects `insert`/`update`/`delete`/`drop`/`replace`.
- **Redis** has no SQL either. `run_query` accepts key commands:
  `GET key`, `KEYS pattern`, `TYPE key`, `INFO`, `SCAN`, `HGETALL key`,
  `LRANGE key 0 -1`, `SMEMBERS key`, `TTL key`. `list_tables` returns
  top-level key namespaces (prefix before the first `:`); `describe_table`
  samples keys in a namespace. Writes (`SET`, `DEL`, `FLUSH*`, …) are
  rejected in safe mode like SQL writes.
- **SQL Server** is a stub on purpose: `pyodbc` needs a system ODBC driver
  that cannot be verified on this VM, so the driver registers, reports its
  install hint, and refuses to connect rather than pretending to work.

## 4. Safety model

Default mode is **read-only**. This is not a suggestion — it is enforced
in `safety.py` before any driver sees the statement.

### The classifier (not a prefix check)

1. Tokenize the input, tracking single/double-quoted strings, backticks,
   line comments (`-- …`, `# …`) and block comments (`/* … */`).
2. Split into statements on `;` **outside** quotes and comments, so
   `SELECT '; DROP TABLE x'` does not become two statements.
3. For each statement, the first real keyword decides:
   - Allowed reads (SQL): `SELECT`, `WITH` (CTE ending in a read),
     `SHOW`, `DESCRIBE`, `DESC`, `EXPLAIN`.
   - Allowed reads (Mongo): `find`, `aggregate`, `count`, `distinct`.
   - Allowed reads (Redis): `GET`, `KEYS`, `SCAN`, `TYPE`, `INFO`,
     `HGETALL`, `LRANGE`, `SMEMBERS`, `TTL`, `EXISTS`.
   - Everything else (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`,
     `ALTER`, `TRUNCATE`, `GRANT`, `REVOKE`, `REPLACE`, `MERGE`, `CALL`,
     Mongo `insert`/`update`/`delete`/`drop`, Redis `SET`/`DEL`/`FLUSH*`,
     …) is a **write**.
4. Safe mode allows a request only if **every** statement in it is a read.
   A multi-statement string containing any write is refused as a whole.
   Comment tricks (`/* x */ DELETE …`, `-- hi\nDROP …`) are refused
   because comments are stripped before classification.

### Writes require two explicit acts

1. `--write` on the command line, **and**
2. an interactive confirmation that prints the profile name and the full
   statement and requires typing `YES` (or `--yes` for scripts, which still
   requires `--write` and still prints the statement).

`--dry-run` prints exactly what would run (profile, statement, mode)
without opening a write path at all. A refused write is never silently
downgraded to a read or skipped — it exits with a clear refusal message.

### Defaults that prevent accidents at scale

- `--limit 100` rows on every query and export (`0` = no limit, explicit).
- `--timeout 30`s per query (SQLite enforced with a progress handler;
  other drivers pass it to the connect/query call where supported).
- Elapsed time is reported for every query.
- `export` refuses to run a write statement, same as `query`.

## 5. SSH tunnel design

Same spirit as the project's VPS-SSH tools (`vps_ssh_execute`): key-based
SSH only, no passwords stored or passed.

- A profile may declare:
  `ssh: {host, user, port (default 22), key (path to private key)}`.
- The tool builds:
  `ssh -N -L <local_port>:<db_host>:<db_port> -i <key> -p <port>
  -o BatchMode=yes -o ExitOnForwardFailure=yes
  -o ConnectTimeout=<timeout> -o ServerAliveInterval=30 <user>@<host>`
  (`BatchMode=yes` is what makes password auth impossible: no prompt,
  key or nothing.)
- `<local_port>` is a free port picked by binding port 0, unless the
  profile pins one.
- The tunnel is a context manager (`SSHTunnel` in `ssh.py`): it starts
  the subprocess in its own process group, polls until the local port
  accepts a connection (or times out), yields the port, and on exit —
  normal, error, or exception — kills the whole process group.
- The driver then connects to `127.0.0.1:<local_port>`; the database
  itself is never exposed beyond localhost on either end.
- No SSH password is ever accepted: profiles have no password field for
  SSH, and the command line never contains one.

## 6. CLI command list

Global flags: `--profile NAME`, `--json`, `--limit N`, `--timeout SECS`.

```
dbm profile add --name NAME --type sqlite|postgres|mysql|mongodb|redis|sqlserver
    [--host H] [--port P] [--user U] [--database D]
    [--password-env VAR] [--ssh-host H --ssh-user U --ssh-port P --ssh-key PATH]
dbm profile list [--json]
dbm profile show NAME [--json]
dbm profile remove NAME [--yes]
dbm test [--profile NAME]                 # connect + server_info, no query
dbm info [--profile NAME]                 # driver matrix + server info
dbm dbs [--profile NAME]
dbm tables [--profile NAME]
dbm describe TABLE [--profile NAME]
dbm query "STATEMENT" [--profile NAME] [--write] [--dry-run] [--yes]
dbm export TABLE --format csv|json [--profile NAME] [--output FILE]
```

Examples:

```
dbm profile add --name local --type sqlite --database ~/data/app.db
dbm --profile local tables
dbm --profile local query "SELECT * FROM users WHERE active = 1" --limit 20
dbm --profile local export users --format csv --output users.csv
dbm profile add --name prod-pg --type postgres --host db.internal --user app \
    --database app --password-env PROD_PG_PASSWORD \
    --ssh-host bastion.example.com --ssh-user deploy --ssh-key ~/.ssh/id_ed25519
DBM_PASSWORD_ENV=PROD_PG_PASSWORD dbm --profile prod-pg query "SELECT 1"
```

## 7. Phases

### Phase 1 — Standalone CLI (done)

- Package `dbm/` + `dbm` entry script, stdlib-only core.
- SQLite fully implemented and tested; Postgres/MySQL/Mongo/Redis
  implemented behind optional imports; SQL Server stub.
- Profiles, SSH tunnel, safety classifier, formatters, export.
- `unittest` suite: safety, SQLite driver, profiles, SSH (mocked, never
  a real connection). All green on this VM.

### Phase 2 — MCP wrapper for the Otter daemon (plan only, NOT implemented)

Goal: expose the same uniform interface to the Otter daemon as MCP tools
(`db_profile_list`, `db_query`, `db_describe`, `db_export`, …) so the
daemon/extension can query databases through the same safety model.

Planned design (do not implement yet):

- A thin `dbm_mcp.py` adapter that imports `dbm.runner` and `dbm.safety`
  unchanged — no fork of the safety logic. The MCP layer must never add
  its own query path that bypasses the classifier.
- Tool registration follows the daemon's existing pattern
  (`src/daemon/tools/*.ts` + `mcp.ts` registration), with the Python side
  invoked as a subprocess (`dbm --json …`) so the daemon never links
  Python code directly. Each MCP tool maps 1:1 to a CLI subcommand.
- Safety in MCP mode is stricter, not looser: MCP calls are always
  safe-mode (no `--write` through MCP in v1); writes stay a CLI-only,
  human-confirmed act. The MCP adapter must reject any `--write`-like
  parameter rather than forwarding it.
- Profiles for MCP: read-only use of the same `~/.config/dbm/` store;
  passwords still via env var names only, resolved in the daemon's
  environment, never passed through MCP tool arguments.
- Open questions for Phase 2: where the subprocess runs (daemon host vs
  a sidecar), how SSH keys are presented to the subprocess, and whether
  the extension gets a read-only DB browser tab. These are decided at
  Phase 2 kickoff, not now.
