"""CI gate: fail if any banned package (stealth, evasion, AGPL PDF, hosted scraping) is in uv.lock.

Run from tools/prop-firm-collector: `uv run python scripts/check_lockfile.py`.
"""

from __future__ import annotations

import sys
from pathlib import Path

from fundedflow_collector.safety import BANNED_PACKAGES, banned_in_lockfile


def main() -> int:
    lock = Path(__file__).resolve().parents[1] / "uv.lock"
    found = banned_in_lockfile(lock)
    if found:
        for name in found:
            print(f"BANNED: {name} ({BANNED_PACKAGES[name]})")
        return 1
    print(f"uv.lock: none of the {len(BANNED_PACKAGES)} banned packages are present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
