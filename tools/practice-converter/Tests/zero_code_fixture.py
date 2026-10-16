#!/usr/bin/env python3
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from test_converter_core import write_xlsx


def zero_code_fixture(core: Path) -> dict:
    with tempfile.TemporaryDirectory(prefix="converter-zero-synthetic-") as folder:
        root = Path(folder)
        attendance = root / "attendance.xlsx"
        billing = root / "billing.xlsx"
        a_rows = [["Client", "Client ID", "Clinician", "Date", "Status", "Billing Code"]]
        b_rows = [["Client", "Client ID", "Clinician", "Date", "Total Fee", "Billing Code"]]
        for index, code in enumerate([0, "0", "00000", "", None], start=1):
            common = [f"Synthetic Zero Client {index}", f"synthetic-zero-{index}", "Dr Zero", f"2026-01-{index:02d}"]
            a_rows.append(common + ["Show", code])
            b_rows.append(common + [index * 11, code])
        write_xlsx(attendance, {"Attendance": (a_rows, None)})
        write_xlsx(billing, {"Billing": (b_rows, None)})
        output = root / "package.json"
        subprocess.run([sys.executable, str(core), "export", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(root / "state"), "--approve-new", "--output", str(output)], check=True, capture_output=True, text=True)
        return json.loads(output.read_text())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--core", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(zero_code_fixture(args.core)))
    except subprocess.CalledProcessError as error:
        sys.stderr.write(error.stdout + error.stderr)
        raise SystemExit(error.returncode)
