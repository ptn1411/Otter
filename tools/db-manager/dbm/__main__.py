"""Allow `python3 -m dbm`."""

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
