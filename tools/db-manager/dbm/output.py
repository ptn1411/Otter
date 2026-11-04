"""Output formatting: aligned tables by default, JSON for scripts,
CSV for exports. UTF-8 is passed through untouched everywhere."""

from __future__ import annotations

import csv
import io
import json


def _cell(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def format_table(columns: list[str], rows: list[tuple], truncated: bool = False) -> str:
    """A simple aligned table. Column widths come from the widest cell."""
    str_rows = [[_cell(v) for v in row] for row in rows]
    widths = [len(c) for c in columns]
    for row in str_rows:
        for i, cell in enumerate(row):
            if i < len(widths):
                widths[i] = max(widths[i], len(cell))
    # If rows are wider than the header list (e.g. key/value pairs),
    # extend widths for the extra columns.
    for row in str_rows:
        while len(widths) < len(row):
            widths.append(max(len(c) for c in row[len(widths):len(widths) + 1]))

    def render(cells: list[str]) -> str:
        return "  ".join(
            cell.ljust(widths[i]) if i < len(widths) else cell
            for i, cell in enumerate(cells)
        ).rstrip()

    lines = [render(columns), render(["-" * w for w in widths])]
    for row in str_rows:
        lines.append(render(row))
    if not rows:
        lines.append("(no rows)")
    if truncated:
        lines.append("(truncated to the row limit; re-run with a higher --limit)")
    return "\n".join(lines)


def format_json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, default=str)


def format_csv(columns: list[str], rows: list[tuple]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(columns)
    for row in rows:
        writer.writerow([None if v is None else v for v in row])
    return buf.getvalue()
