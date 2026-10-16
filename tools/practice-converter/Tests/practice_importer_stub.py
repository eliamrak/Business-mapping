#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path


def date_ranges_overlap(a: dict, b: dict) -> bool:
    if not a.get("coverageStart") or not b.get("coverageStart"):
        return False
    return a["coverageStart"] <= b["coverageEnd"] and b["coverageStart"] <= a["coverageEnd"]


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: practice_importer_stub.py STATE PACKAGE", file=sys.stderr)
        return 2
    state_path = Path(argv[1])
    package_path = Path(argv[2])
    package = json.loads(package_path.read_text())
    if package.get("format") != "emc-practice-local-import-package" or package.get("version") != 1:
        print(json.dumps({"ok": False, "error": "unsupported package version"}))
        return 2
    state = {"packageIds": [], "coverages": []}
    if state_path.exists():
        state = json.loads(state_path.read_text())
    collections = package["collections"]
    package_id = package["packageId"]
    duplicate = package_id in set(state["packageIds"])
    overlap = any(
        date_ranges_overlap(collections["attendance"], cov.get("attendance", {}))
        or date_ranges_overlap(collections["billing"], cov.get("billing", {}))
        for cov in state["coverages"]
    )
    if not duplicate:
        state["packageIds"].append(package_id)
        state["coverages"].append(collections)
    state_path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")
    imported = 0 if duplicate else collections["attendance"]["rowCount"] + collections["billing"]["rowCount"]
    print(json.dumps({"ok": True, "imported": imported, "duplicate": duplicate, "overlapReview": overlap and not duplicate}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
