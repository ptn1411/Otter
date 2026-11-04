"""dbm CLI: profile management, inspection, queries, exports.

Safety rules enforced here (never bypassed by another layer):
  * Safe mode (default): only read statements, via safety.classify().
  * --write requires an interactive YES confirmation naming the profile
    and the full statement (or --yes, which still requires --write).
  * --dry-run prints what would run and runs nothing.
"""

from __future__ import annotations

import argparse
import json
import sys

from . import __version__
from .drivers import list_drivers
from .errors import DbmError, SafetyRefused
from .output import format_csv, format_json, format_table
from .profiles import (
    add_profile,
    get_profile,
    load_profiles,
    remove_profile,
)
from .runner import open_connection
from .safety import classify, require_read_or_raise


def _emit(payload: dict, as_json: bool, table_text: str | None = None) -> None:
    if as_json:
        print(format_json(payload))
    elif table_text is not None:
        print(table_text)
    else:
        print(format_json(payload))


def _need_profile(args) -> str:
    if not args.profile:
        raise DbmError("no profile selected: pass --profile NAME (see: dbm profile list)")
    return args.profile


def cmd_profile_add(args) -> int:
    profile: dict = {"type": args.type}
    for key in ("host", "port", "user", "database", "password_env"):
        value = getattr(args, key)
        if value is not None:
            profile[key] = value
    if args.ssh_host:
        ssh: dict = {"host": args.ssh_host, "user": args.ssh_user or "root"}
        if args.ssh_port:
            ssh["port"] = args.ssh_port
        if args.ssh_key:
            ssh["key"] = args.ssh_key
        profile["ssh"] = ssh
    add_profile(args.name, profile)
    print(f"profile '{args.name}' added ({args.type})")
    return 0


def cmd_profile_list(args) -> int:
    data = load_profiles()
    if args.json:
        print(format_json({"profiles": data}))
    else:
        if not data:
            print("(no profiles — add one with: dbm profile add ...)")
        else:
            rows = [
                (name, p.get("type", ""), p.get("host", ""),
                 str(p.get("database", "")))
                for name, p in sorted(data.items())
            ]
            print(format_table(["name", "type", "host", "database"], rows))
    return 0


def cmd_profile_show(args) -> int:
    profile = get_profile(args.name)
    _emit({"name": args.name, "profile": profile}, args.json,
          format_table(["field", "value"],
                       [(k, json.dumps(v, ensure_ascii=False))
                        for k, v in sorted(profile.items())]))
    return 0


def cmd_profile_remove(args) -> int:
    if not args.yes:
        answer = input(f"Remove profile '{args.name}'? Type YES to confirm: ").strip()
        if answer != "YES":
            print("cancelled")
            return 1
    remove_profile(args.name)
    print(f"profile '{args.name}' removed")
    return 0


def _with_connection(args, fn):
    name = _need_profile(args)
    with open_connection(name, args.timeout) as conn:
        return fn(conn)


def cmd_test(args) -> int:
    def run(conn):
        info = conn.driver.server_info()
        _emit({"profile": conn.profile_name, "server": info}, args.json,
              format_table(["field", "value"],
                           [(k, str(v)) for k, v in sorted(info.items())]))
        return 0

    return _with_connection(args, run)


def cmd_info(args) -> int:
    drivers = list_drivers()
    if args.profile:
        def run(conn):
            info = conn.driver.server_info()
            _emit({"profile": conn.profile_name, "drivers": drivers,
                   "server": info}, args.json,
                  format_table(["field", "value"],
                               [(k, str(v)) for k, v in sorted(info.items())]))
            return 0

        return _with_connection(args, run)
    _emit({"drivers": drivers}, args.json,
          format_table(["engine", "default_port", "package", "implemented"],
                       [(d["engine"], str(d["default_port"]), d["package"],
                         "yes" if d["implemented"] else "stub only")
                        for d in drivers]))
    return 0


def cmd_dbs(args) -> int:
    def run(conn):
        dbs = conn.driver.list_databases()
        _emit({"profile": conn.profile_name, "databases": dbs}, args.json,
              format_table(["database"], [(d,) for d in dbs]))
        return 0

    return _with_connection(args, run)


def cmd_tables(args) -> int:
    def run(conn):
        tables = conn.driver.list_tables()
        _emit({"profile": conn.profile_name, "tables": tables}, args.json,
              format_table(["table"], [(t,) for t in tables]))
        return 0

    return _with_connection(args, run)


def cmd_describe(args) -> int:
    def run(conn):
        rows = conn.driver.describe_table(args.table)
        _emit({"profile": conn.profile_name, "table": args.table,
               "columns": rows}, args.json,
              format_table(["column", "type", "nullable", "extra"], rows))
        return 0

    return _with_connection(args, run)


def _confirm_write(profile_name: str, statement: str, args) -> bool:
    print(f"WRITE on profile '{profile_name}':")
    print(statement)
    if args.yes:
        return True
    answer = input("Type YES to run this write: ").strip()
    return answer == "YES"


def cmd_query(args) -> int:
    name = _need_profile(args)
    profile = get_profile(name)
    engine = profile["type"]
    is_read, _reason = classify(engine, args.statement)
    if not is_read and not args.write:
        require_read_or_raise(engine, args.statement)  # raises SafetyRefused
    if args.dry_run:
        print(f"[dry-run] profile={name} engine={engine} "
              f"mode={'write' if args.write else 'read'}")
        print(args.statement)
        return 0
    if not is_read:
        if not _confirm_write(name, args.statement, args):
            print("cancelled")
            return 1

    def run(conn):
        result = conn.driver.run_query(args.statement, args.limit)
        payload = {
            "profile": conn.profile_name,
            "columns": result.columns,
            "rows": [list(r) for r in result.rows],
            "truncated": result.truncated,
            "elapsed_s": round(result.elapsed, 3),
        }
        _emit(payload, args.json,
              format_table(result.columns, result.rows, result.truncated)
              + f"\n({len(result.rows)} rows, {result.elapsed:.3f}s)")
        return 0

    return _with_connection(args, run)


def cmd_export(args) -> int:
    def run(conn):
        engine = conn.profile["type"]
        if engine in ("mongodb", "redis"):
            raise DbmError(
                f"export of a whole table is not supported for {engine}; "
                "use query with a find/KEYS command and --json instead"
            )
        statement = (
            f"SELECT * FROM "
            f"\"{args.table.replace(chr(34), chr(34) * 2)}\""
        )
        result = conn.driver.run_query(statement, args.limit)
        if args.format == "csv":
            text = format_csv(result.columns, result.rows)
        else:
            text = format_json({
                "profile": conn.profile_name, "table": args.table,
                "columns": result.columns,
                "rows": [list(r) for r in result.rows],
                "truncated": result.truncated,
            })
        if args.output:
            with open(args.output, "w", encoding="utf-8", newline="") as fh:
                fh.write(text)
            print(f"wrote {len(result.rows)} rows to {args.output}")
        else:
            print(text, end="" if text.endswith("\n") else "\n")
        return 0

    return _with_connection(args, run)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dbm", description="Safe, uniform database manager (read-only by default)."
    )
    parser.add_argument("--version", action="version", version=f"dbm {__version__}")
    parser.add_argument("--profile", default=None, help="profile name")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--limit", type=int, default=100,
                        help="max rows returned (0 = no limit, default 100)")
    parser.add_argument("--timeout", type=int, default=30,
                        help="query/connect timeout in seconds (default 30)")
    sub = parser.add_subparsers(dest="command", required=True)

    prof = sub.add_parser("profile", help="manage connection profiles")
    prof_sub = prof.add_subparsers(dest="profile_command", required=True)
    add = prof_sub.add_parser("add", help="add a profile (never stores passwords)")
    add.add_argument("--name", required=True)
    add.add_argument("--type", required=True,
                     choices=["sqlite", "postgres", "mysql", "mongodb", "redis", "sqlserver"])
    add.add_argument("--host")
    add.add_argument("--port", type=int)
    add.add_argument("--user")
    add.add_argument("--database")
    add.add_argument("--password-env", help="env var name holding the password")
    add.add_argument("--ssh-host")
    add.add_argument("--ssh-user")
    add.add_argument("--ssh-port", type=int)
    add.add_argument("--ssh-key")
    add.set_defaults(func=cmd_profile_add)
    plist = prof_sub.add_parser("list", help="list profiles")
    plist.set_defaults(func=cmd_profile_list)
    pshow = prof_sub.add_parser("show", help="show a profile (no passwords stored)")
    pshow.add_argument("name")
    pshow.set_defaults(func=cmd_profile_show)
    prem = prof_sub.add_parser("remove", help="remove a profile")
    prem.add_argument("name")
    prem.add_argument("--yes", action="store_true")
    prem.set_defaults(func=cmd_profile_remove)

    test = sub.add_parser("test", help="connect and show server info")
    test.set_defaults(func=cmd_test)
    info = sub.add_parser("info", help="driver matrix, plus server info with --profile")
    info.set_defaults(func=cmd_info)
    dbs = sub.add_parser("dbs", help="list databases")
    dbs.set_defaults(func=cmd_dbs)
    tables = sub.add_parser("tables", help="list tables")
    tables.set_defaults(func=cmd_tables)
    desc = sub.add_parser("describe", help="describe a table")
    desc.add_argument("table")
    desc.set_defaults(func=cmd_describe)
    query = sub.add_parser("query", help="run a statement (read-only unless --write)")
    query.add_argument("statement")
    query.add_argument("--write", action="store_true",
                       help="allow writes (still requires confirmation)")
    query.add_argument("--dry-run", action="store_true",
                       help="print what would run, run nothing")
    query.add_argument("--yes", action="store_true",
                       help="answer the write confirmation non-interactively")
    query.set_defaults(func=cmd_query)
    export = sub.add_parser("export", help="export a whole table")
    export.add_argument("table")
    export.add_argument("--format", choices=["csv", "json"], default="csv")
    export.add_argument("--output", help="output file (default: stdout)")
    export.set_defaults(func=cmd_export)
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except SafetyRefused as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2
    except DbmError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except BrokenPipeError:
        return 0
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
