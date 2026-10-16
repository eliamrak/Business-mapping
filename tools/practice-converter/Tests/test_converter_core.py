#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "Resources" / "converter_core.py"
IMPORTER_STUB = ROOT / "Tests" / "practice_importer_stub.py"
FIXTURES = ROOT / "Tests" / "fixtures"


def run_core(args: list[str], expect: int | tuple[int, ...] = 0) -> dict:
    env = os.environ.copy()
    env["PYTHONPYCACHEPREFIX"] = str(Path(tempfile.gettempdir()) / "practice_converter_pycache")
    proc = subprocess.run(
        ["python3", str(CORE), *args],
        cwd=str(ROOT.parent),
        text=True,
        capture_output=True,
        env=env,
    )
    expected = (expect,) if isinstance(expect, int) else expect
    if proc.returncode not in expected:
        raise AssertionError(f"exit {proc.returncode}\nstdout={proc.stdout}\nstderr={proc.stderr}")
    return json.loads(proc.stdout)


def write_csv(path: Path, rows: list[list[object]], bom: bool = False) -> None:
    encoding = "utf-8-sig" if bom else "utf-8"
    with path.open("w", newline="", encoding=encoding) as handle:
        writer = csv.writer(handle)
        writer.writerows(rows)


def col_name(index: int) -> str:
    index += 1
    letters = ""
    while index:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def sheet_xml(rows: list[list[object]], formulas: dict[tuple[int, int], str] | None = None) -> str:
    formulas = formulas or {}
    xml_rows = []
    for r_idx, row in enumerate(rows, start=1):
        cells = []
        width = max(len(row), max((c for rr, c in formulas if rr == r_idx), default=0))
        for c_idx in range(1, width + 1):
            ref = f"{col_name(c_idx - 1)}{r_idx}"
            if (r_idx, c_idx) in formulas:
                cells.append(f'<c r="{ref}"><f>{escape(formulas[(r_idx, c_idx)])}</f><v></v></c>')
                continue
            value = row[c_idx - 1] if c_idx <= len(row) else ""
            if value == "":
                continue
            if isinstance(value, (int, float)):
                cells.append(f'<c r="{ref}"><v>{value}</v></c>')
            else:
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>')
        xml_rows.append(f'<row r="{r_idx}">{"".join(cells)}</row>')
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(xml_rows)}</sheetData></worksheet>'
    )


def write_xlsx(path: Path, sheets: dict[str, tuple[list[list[object]], dict[tuple[int, int], str] | None]]) -> None:
    content_types = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    ]
    rels = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ]
    workbook_sheets = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>',
    ]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        zf.writestr("xl/styles.xml", '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>')
        for idx, (name, (rows, formulas)) in enumerate(sheets.items(), start=1):
            zf.writestr(f"xl/worksheets/sheet{idx}.xml", sheet_xml(rows, formulas))
            content_types.append(f'<Override PartName="/xl/worksheets/sheet{idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
            rels.append(f'<Relationship Id="rId{idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{idx}.xml"/>')
            workbook_sheets.append(f'<sheet name="{escape(name)}" sheetId="{idx}" r:id="rId{idx}"/>')
        content_types.append("</Types>")
        rels.append("</Relationships>")
        workbook_sheets.append("</sheets></workbook>")
        zf.writestr("[Content_Types].xml", "".join(content_types))
        zf.writestr("xl/_rels/workbook.xml.rels", "".join(rels))
        zf.writestr("xl/workbook.xml", "".join(workbook_sheets))


class ConverterCoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="practice-converter-test-"))
        self.state = self.tmp / "state"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp)

    def valid_csv_inputs(self) -> tuple[Path, Path]:
        attendance = self.tmp / "attendance.csv"
        billing = self.tmp / "billing.csv"
        write_csv(attendance, [
            ["Client", "Clinician", "Date of service", "Location", "Status"],
            ["Alpha\nClient", "Clinician A", "2026-01-07", "Room 1", "SHOW"],
            ["Beta Client", "Clinician B", "01/08/2026", "Room 2", "no show"],
        ], bom=True)
        write_csv(billing, [
            ["Date of Service", "Client", "Clinician", "Total Fee", "Billing Code"],
            ["2026-01-07", "Alpha Client", "Clinician A", "125.50", "00000"],
            ["2026-01-08", "Beta Client", "Clinician B", "0", "90837"],
        ])
        return attendance, billing

    def test_csv_export_is_name_free_and_persistent(self) -> None:
        attendance, billing = self.valid_csv_inputs()
        first = run_core(["analyze", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state)], expect=(0, 2))
        self.assertNotIn("collections", first)
        self.assertEqual(len(first["reviewItems"]), 2)
        backup_dir = self.state / "Backups"
        backup_count = len(list(backup_dir.glob("*.json"))) if backup_dir.exists() else 0
        again_before_export = run_core(["analyze", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state)], expect=(0, 2))
        self.assertEqual(len(again_before_export["reviewItems"]), 2)
        self.assertEqual(len(list(backup_dir.glob("*.json"))) if backup_dir.exists() else 0, backup_count)
        package = self.tmp / "package.json"
        exported = run_core(["export", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state), "--output", str(package), "--approve-new"])
        self.assertTrue(exported["ok"])
        self.assertNotIn("collections", exported)
        data = json.loads(package.read_text())
        blob = json.dumps(data)
        self.assertNotIn("Alpha", blob)
        self.assertNotIn("Beta", blob)
        self.assertIn("Clinician A", blob)
        self.assertIn("Room 1", blob)
        self.assertNotIn(str(attendance), blob)
        self.assertEqual(data["format"], "emc-practice-local-import-package")
        self.assertEqual(data["version"], 1)
        self.assertTrue(data["packageId"].startswith("pkg_"))
        self.assertEqual(data["collections"]["attendance"]["rows"][0]["clinician"], "Clinician A")
        self.assertEqual(data["collections"]["attendance"]["rows"][0]["location"], "Room 1")
        self.assertNotIn("clinicianId", json.dumps(data))
        self.assertNotIn("roomId", json.dumps(data))
        self.assertEqual(data["collections"]["billing"]["rows"][0]["billingCode"], "00000")
        self.assertEqual(data["collections"]["billing"]["rows"][1]["totalFeeCharged"], 0)
        importer_state = self.tmp / "importer-state.json"
        first_import = subprocess.run(["python3", str(IMPORTER_STUB), str(importer_state), str(package)], text=True, capture_output=True, check=True)
        first_import_result = json.loads(first_import.stdout)
        self.assertFalse(first_import_result["duplicate"])
        second_import = subprocess.run(["python3", str(IMPORTER_STUB), str(importer_state), str(package)], text=True, capture_output=True, check=True)
        second_import_result = json.loads(second_import.stdout)
        self.assertTrue(second_import_result["duplicate"])
        self.assertFalse(second_import_result["overlapReview"])
        again = run_core(["analyze", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state)])
        self.assertEqual(again["reviewItems"], [])

    def test_large_review_output_is_capped_without_dropping_counts(self) -> None:
        attendance = self.tmp / "attendance-many.csv"
        billing = self.tmp / "billing-many.csv"
        attendance_rows = [["Client", "Clinician", "Date of service", "Location", "Status"]]
        billing_rows = [["Date of Service", "Client", "Clinician", "Total Fee", "Billing Code"]]
        for idx in range(205):
            name = f"Synthetic Client {idx:03d}"
            date = f"2026-01-{(idx % 28) + 1:02d}"
            attendance_rows.append([name, "Clinician A", date, "Room", "show"])
            billing_rows.append([date, name, "Clinician A", "100", "00000"])
        write_csv(attendance, attendance_rows)
        write_csv(billing, billing_rows)
        result = run_core(["analyze", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state)], expect=(0, 2))
        self.assertEqual(result["reviewItemCount"], 205)
        self.assertEqual(len(result["reviewItems"]), 200)
        self.assertTrue(result["detailsTruncated"])
        self.assertNotIn("collections", result)

    def test_shared_golden_fixture(self) -> None:
        state = self.tmp / "golden-state"
        state.mkdir()
        shutil.copy2(FIXTURES / "golden_mapping.json", state / "mapping.json")
        package = self.tmp / "golden-package.json"
        result = run_core([
            "export",
            "--attendance", str(FIXTURES / "golden_attendance.csv"),
            "--billing", str(FIXTURES / "golden_billing.csv"),
            "--state-dir", str(state),
            "--output", str(package),
            "--approve-new",
        ])
        self.assertTrue(result["ok"])
        actual = json.loads(package.read_text())
        expected = json.loads((FIXTURES / "golden_package.json").read_text())
        actual["exportedAt"] = expected["exportedAt"]
        self.assertEqual(actual, expected)

    def test_negative_fee_and_unknown_status_block_export(self) -> None:
        attendance = self.tmp / "attendance.csv"
        billing = self.tmp / "billing.csv"
        write_csv(attendance, [
            ["Client", "Clinician", "Date of service", "Location", "Status"],
            ["Alpha", "Clinician A", "2026-01-07", "Room", "arrived"],
            ["Beta", "Clinician B", "2026-01-08", "Room", "cancelled pending review"],
        ])
        write_csv(billing, [
            ["Date of Service", "Client", "Clinician", "Total Fee", "Billing Code"],
            ["2026-01-07", "Alpha", "Clinician A", "-5", "90837"],
            ["2026-01-08", "Beta", "Clinician B", "0", "90837"],
        ])
        result = run_core(["analyze", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state)], expect=2)
        messages = " ".join(err["message"] for err in result["errors"])
        self.assertIn("negative fee", messages)
        self.assertIn("unknown status 'arrived'", messages)
        self.assertIn("unknown status 'cancelled pending review'", messages)
        self.assertIn("Show, Cancelled, No show, Clinician cancelled", messages)

    def test_real_export_variant_headers_statuses_and_datetime_dates(self) -> None:
        attendance = self.tmp / "attendance-variant.csv"
        billing = self.tmp / "billing-variant.csv"
        write_csv(attendance, [
            ["Client Name", "Staff Member", "Service Date/Time", "Office", "Attendance Status"],
            ["Alpha Client", "Clinician A", "2026-01-07 9:00 AM", "Room", "Kept"],
            ["Beta Client", "Provider B", "01/08/2026 10:15 AM", "Room", "Late Cancel"],
            ["Gamma Client", "Therapist C", "2026-01-09T11:30:00", "Room", "Provider Cancelled"],
            ["Delta Client", "Clinician D", "01-10-2026 12:45 PM", "Room", "No-Show"],
        ])
        write_csv(billing, [
            ["Appointment Date", "Client Full Name", "Rendering Provider", "Total Fee", "Billing Code"],
            ["2026-01-07 09:00:00", "Alpha Client", "Clinician A", "125", "00000"],
            ["01/08/2026 10:15 AM", "Beta Client", "Provider B", "0", "90837"],
            ["01-10-2026 12:45 PM", "Delta Client", "Clinician D", "90", "90834"],
        ])
        inspected = run_core(["inspect", "--report-type", "billing", "--input", str(billing)])
        self.assertTrue(inspected["ok"])
        self.assertEqual(inspected["missingRequired"], [])
        result = run_core(["analyze", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state)], expect=(0, 2))
        self.assertEqual(result["errorCount"], 0)
        self.assertEqual(result["reviewSummary"]["newClientIds"], 4)
        self.assertEqual(result["reviewSummary"]["sameNameSourceIdWarnings"], 0)
        self.assertEqual(result["reviewSummary"]["reconciliationAmbiguousGroups"], 0)
        self.assertEqual(result["reviewSummary"]["expectedAttendanceWithoutBillingRows"], 1)
        self.assertEqual(result["reconciliation"]["skippedAppointmentRows"], 0)
        self.assertEqual(result["reconciliation"]["matched"], 3)
        diagnosed = run_core(["diagnose", "--attendance", str(attendance), "--billing", str(billing)])
        self.assertEqual(diagnosed["errorCount"], 0)
        self.assertEqual(diagnosed["reviewSummary"]["newClientIds"], 4)
        self.assertEqual(diagnosed["reviewSummary"]["sameNameSourceIdWarnings"], 0)
        self.assertEqual(diagnosed["reviewSummary"]["reconciliationAmbiguousGroups"], 0)
        self.assertEqual(diagnosed["reviewSummary"]["expectedAttendanceWithoutBillingRows"], 1)
        self.assertEqual(diagnosed["attendance"]["statusSummary"]["categories"]["show"], 1)
        self.assertEqual(diagnosed["attendance"]["statusSummary"]["categories"]["cancelled"], 1)
        self.assertEqual(diagnosed["attendance"]["statusSummary"]["categories"]["clinician cancelled"], 1)
        self.assertEqual(diagnosed["attendance"]["statusSummary"]["categories"]["no show"], 1)
        self.assertEqual(diagnosed["attendance"]["statusSummary"]["unknownCount"], 0)
        self.assertEqual(diagnosed["billing"]["dateParsing"]["valid"], 3)
        self.assertEqual(diagnosed["billing"]["reconciliationUsability"]["usable"], 3)
        package = self.tmp / "variant-package.json"
        exported = run_core(["export", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state), "--output", str(package), "--approve-new"])
        self.assertTrue(exported["ok"])
        data = json.loads(package.read_text())
        statuses = [row["status"] for row in data["collections"]["attendance"]["rows"]]
        self.assertEqual(statuses, ["show", "cancelled", "clinician cancelled", "no show"])

    def test_late_cancelled_preserves_billed_fee_without_attendance_show(self) -> None:
        attendance = self.tmp / "attendance-late-cancelled.csv"
        billing = self.tmp / "billing-late-cancelled.csv"
        write_csv(attendance, [
            ["Source Client ID", "Client", "Clinician", "Date of service", "Status"],
            ["LC-1", "Synthetic Late Client 1", "Clinician A", "2026-01-07", "Late Cancelled"],
            ["LC-2", "Synthetic Late Client 2", "Clinician A", "2026-01-08", "Late Canceled"],
        ])
        write_csv(billing, [
            ["Source Client ID", "Date of Service", "Client", "Clinician", "Total Fee", "Billing Code"],
            ["LC-1", "2026-01-07", "Synthetic Late Client 1", "Clinician A", "150", "90837"],
            ["LC-2", "2026-01-08", "Synthetic Late Client 2", "Clinician A", "175", "90837"],
        ])
        result = run_core(["analyze", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state)], expect=(0, 2))
        self.assertEqual(result["errorCount"], 0)
        self.assertEqual(result["reviewSummary"]["newClientIds"], 2)
        self.assertEqual(result["reviewSummary"]["sameNameSourceIdWarnings"], 0)
        self.assertEqual(result["reviewSummary"]["reconciliationAmbiguousGroups"], 0)
        self.assertEqual(result["reconciliation"]["matched"], 2)
        diagnosed = run_core(["diagnose", "--attendance", str(attendance), "--billing", str(billing)])
        self.assertEqual(diagnosed["attendance"]["statusSummary"]["categories"]["cancelled"], 2)
        self.assertEqual(diagnosed["attendance"]["statusSummary"]["cancellationSubtypes"]["late_cancelled"], 2)
        self.assertEqual(diagnosed["attendance"]["statusSummary"]["categories"]["show"], 0)
        package = self.tmp / "late-cancelled-package.json"
        exported = run_core(["export", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state), "--output", str(package), "--approve-new"])
        self.assertTrue(exported["ok"])
        data = json.loads(package.read_text())
        attendance_rows = data["collections"]["attendance"]["rows"]
        billing_rows = data["collections"]["billing"]["rows"]
        self.assertEqual([row["status"] for row in attendance_rows], ["cancelled", "cancelled"])
        self.assertEqual([row["totalFeeCharged"] for row in billing_rows], [150, 175])
        self.assertEqual([row for row in attendance_rows if row["status"] == "show"], [])
        self.assertEqual([row.get("cancellationSubtype") for row in attendance_rows], ["late_cancelled", "late_cancelled"])

    def test_cancelled_attendance_without_billing_is_expected_without_inventing_charge(self) -> None:
        attendance = self.tmp / "attendance-cancellations.csv"
        billing = self.tmp / "billing-cancellations.csv"
        write_csv(attendance, [
            ["Source Client ID", "Client", "Clinician", "Date of service", "Status"],
            ["CAN-1", "Synthetic Cancelled Client", "Clinician A", "2026-01-07", "Cancelled"],
            ["CAN-2", "Synthetic Provider Cancelled Client", "Clinician A", "2026-01-08", "Provider Cancelled"],
            ["CAN-3", "Synthetic Late Cancelled Client", "Clinician A", "2026-01-09", "Late Cancelled"],
            ["CAN-4", "Synthetic Show Missing Billing", "Clinician A", "2026-01-10", "Show"],
        ])
        write_csv(billing, [
            ["Source Client ID", "Date of Service", "Client", "Clinician", "Total Fee", "Billing Code"],
            ["CAN-3", "2026-01-09", "Synthetic Late Cancelled Client", "Clinician A", "150", "90837"],
        ])
        result = run_core(["analyze", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state)], expect=(0, 2))
        reconciliation = result["reconciliation"]
        self.assertEqual(reconciliation["matched"], 1)
        self.assertEqual(reconciliation["expectedAttendanceWithoutBillingRows"], 2)
        self.assertEqual(reconciliation["expectedCancelledAttendanceRows"], 1)
        self.assertEqual(reconciliation["expectedClinicianCancelledAttendanceRows"], 1)
        self.assertEqual(reconciliation["unmatchedAttendance"], 1)
        self.assertEqual(result["reviewSummary"]["expectedAttendanceWithoutBillingRows"], 2)
        self.assertEqual(result["reviewSummary"]["unmatchedAttendanceRows"], 1)
        diagnosed = run_core(["diagnose", "--attendance", str(attendance), "--billing", str(billing)])
        subtypes = diagnosed["attendance"]["statusSummary"]["cancellationSubtypes"]
        self.assertEqual(subtypes["cancelled"], 1)
        self.assertEqual(subtypes["clinician_cancelled"], 1)
        self.assertEqual(subtypes["late_cancelled"], 1)

        package = self.tmp / "cancellations-package.json"
        exported = run_core(["export", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state), "--output", str(package), "--approve-new"])
        self.assertTrue(exported["ok"])
        data = json.loads(package.read_text())
        self.assertEqual(data["collections"]["attendance"]["rowCount"], 4)
        self.assertEqual(data["collections"]["billing"]["rowCount"], 1)
        self.assertEqual(data["collections"]["billing"]["rows"][0]["totalFeeCharged"], 150)
        self.assertEqual([row["status"] for row in data["collections"]["attendance"]["rows"]], ["cancelled", "clinician cancelled", "cancelled", "show"])
        self.assertEqual([row.get("cancellationSubtype") for row in data["collections"]["attendance"]["rows"]], [None, None, "late_cancelled", None])
        self.assertFalse(any(row["clientId"] == data["collections"]["attendance"]["rows"][0]["clientId"] for row in data["collections"]["billing"]["rows"]))

    def test_phone_consultation_metadata_is_additive_and_mixed_days_are_preserved(self) -> None:
        attendance = self.tmp / "attendance-phone-consultation.csv"
        billing = self.tmp / "billing-phone-consultation.csv"
        write_csv(attendance, [
            ["Source Client ID", "Client", "Clinician", "Date of service", "Appointment Time", "Appointment Title", "Billing Code", "Status"],
            ["PHONE-1", "Synthetic Phone Client", "Clinician A", "2026-01-07", "9:00 AM", "Phone call with Synthetic Phone Client", "Phone", "Show"],
            ["TITLE-1", "Synthetic Title Client", "Clinician A", "2026-01-07", "9:30 AM", "Phone", "", "Show"],
            ["MIX-1", "Synthetic Mixed Client", "Clinician A", "2026-01-08", "9:00 AM", "Phone", "Phone", "Show"],
            ["MIX-1", "Synthetic Mixed Client", "Clinician A", "2026-01-08", "10:00 AM", "Therapy", "90837", "Show"],
        ])
        write_csv(billing, [
            ["Source Client ID", "Date of Service", "Client", "Clinician", "Appointment Time", "Appointment Title", "Total Fee", "Billing Code"],
            ["PHONE-1", "2026-01-07", "Synthetic Phone Client", "Clinician A", "9:00 AM", "Phone call with Synthetic Phone Client", "0", "Phone"],
            ["TITLE-1", "2026-01-07", "Synthetic Title Client", "Clinician A", "9:30 AM", "Phone", "0", ""],
            ["MIX-1", "2026-01-08", "Synthetic Mixed Client", "Clinician A", "9:00 AM", "Phone", "0", "Phone"],
            ["MIX-1", "2026-01-08", "Synthetic Mixed Client", "Clinician A", "10:00 AM", "Therapy", "200", "90837"],
        ])

        result = run_core(["analyze", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state)], expect=(0, 2))
        self.assertEqual(result["errorCount"], 0)
        self.assertEqual(result["reconciliation"]["matched"], 4)
        package = self.tmp / "phone-consultation-package.json"
        exported = run_core(["export", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state), "--output", str(package), "--approve-new"])
        self.assertTrue(exported["ok"])
        data = json.loads(package.read_text())
        attendance_rows = data["collections"]["attendance"]["rows"]
        billing_rows = data["collections"]["billing"]["rows"]
        self.assertEqual(data["collections"]["attendance"]["rowCount"], 4)
        self.assertEqual(data["collections"]["billing"]["rowCount"], 4)
        self.assertEqual(attendance_rows[0]["visitKind"], "consultation")
        self.assertEqual(attendance_rows[0]["billingCode"], "Phone")
        self.assertEqual(billing_rows[0]["visitKind"], "consultation")
        self.assertEqual(billing_rows[0]["billingCode"], "Phone")
        self.assertEqual(attendance_rows[1]["visitKind"], "consultation")
        self.assertEqual(billing_rows[1]["visitKind"], "consultation")
        self.assertNotIn("billingCode", attendance_rows[1])
        self.assertEqual(attendance_rows[3]["billingCode"], "90837")
        self.assertNotEqual(billing_rows[3].get("visitKind"), "consultation")
        package_blob = json.dumps(data)
        self.assertNotIn("appointmentTitle", package_blob)
        self.assertNotIn("appointmentTime", package_blob)
        self.assertNotIn("Phone call with", package_blob)

    def test_unknown_or_incomplete_cancelled_rows_are_not_expected_no_billing(self) -> None:
        attendance = self.tmp / "attendance-bad-cancellations.csv"
        billing = self.tmp / "billing-bad-cancellations.csv"
        write_csv(attendance, [
            ["Source Client ID", "Client", "Clinician", "Date of service", "Status"],
            ["BAD-1", "Synthetic Valid Client", "Clinician A", "2026-01-07", "Show"],
            ["BAD-2", "Synthetic Unknown Status", "Clinician A", "2026-01-08", "Cancelled pending review"],
            ["BAD-3", "Synthetic Missing Date", "Clinician A", "", "Cancelled"],
        ])
        write_csv(billing, [
            ["Source Client ID", "Date of Service", "Client", "Clinician", "Total Fee", "Billing Code"],
            ["BAD-1", "2026-01-07", "Synthetic Valid Client", "Clinician A", "100", "90837"],
        ])
        result = run_core(["analyze", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state)], expect=2)
        messages = " ".join(err["message"] for err in result["errors"])
        self.assertIn("unknown status 'Cancelled pending review'", messages)
        self.assertIn("missing date", messages)
        self.assertEqual(result["reviewSummary"]["expectedAttendanceWithoutBillingRows"], 0)
        self.assertEqual(result["reviewSummary"]["unmatchedAttendanceRows"], 1)
        self.assertEqual(result["reconciliation"]["skippedAttendanceRows"], 1)

    def test_same_name_source_ids_are_flagged_and_kept_distinct(self) -> None:
        attendance = self.tmp / "attendance-same-name-source-ids.csv"
        billing = self.tmp / "billing-same-name-source-ids.csv"
        write_csv(attendance, [
            ["Source Client ID", "Client", "Clinician", "Date of service", "Status"],
            ["CID-A", "Synthetic Shared Name", "Clinician A", "2026-01-07", "show"],
            ["CID-B", "Synthetic Shared Name", "Clinician A", "2026-01-08", "show"],
        ])
        write_csv(billing, [
            ["Source Client ID", "Date of Service", "Client", "Clinician", "Total Fee", "Billing Code"],
            ["CID-A", "2026-01-07", "Synthetic Shared Name", "Clinician A", "125", "00000"],
            ["CID-B", "2026-01-08", "Synthetic Shared Name", "Clinician A", "150", "90837"],
        ])
        result = run_core(["analyze", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state)], expect=(0, 2))
        self.assertEqual(result["errorCount"], 0)
        self.assertEqual(result["reviewSummary"]["newClientIds"], 2)
        self.assertEqual(result["reviewSummary"]["sameNameSourceIdWarnings"], 1)
        self.assertEqual(result["reviewSummary"]["reconciliationAmbiguousGroups"], 0)
        self.assertEqual(result["reconciliation"]["matched"], 2)
        self.assertIn("same_name_source_ids", json.dumps(result["reviewItems"]))

        package = self.tmp / "same-name-source-ids-package.json"
        exported = run_core(["export", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state), "--output", str(package), "--approve-new"])
        self.assertTrue(exported["ok"])
        data = json.loads(package.read_text())
        attendance_ids = [row["clientId"] for row in data["collections"]["attendance"]["rows"]]
        billing_ids = [row["clientId"] for row in data["collections"]["billing"]["rows"]]
        self.assertEqual(attendance_ids, billing_ids)
        self.assertEqual(len(set(attendance_ids)), 2)

    def test_column_inspect_and_optional_location(self) -> None:
        attendance = self.tmp / "attendance-no-location.csv"
        billing = self.tmp / "billing-no-code.csv"
        write_csv(attendance, [
            ["Client", "Clinician", "Date of service", "Status"],
            ["Alpha Client", "Clinician A", "2026-01-07", "show"],
        ])
        write_csv(billing, [
            ["Date of Service", "Client", "Clinician", "Total Fee"],
            ["2026-01-07", "Alpha Client", "Clinician A", "125"],
        ])
        inspected = run_core(["inspect", "--report-type", "attendance", "--input", str(attendance)])
        by_field = {item["field"]: item for item in inspected["columns"]}
        self.assertTrue(inspected["ok"])
        self.assertTrue(by_field["client"]["present"])
        self.assertFalse(by_field["location"]["required"])
        self.assertFalse(by_field["location"]["present"])
        self.assertIn("same-name clients", by_field["source_client_id"]["note"])
        package = self.tmp / "optional-location-package.json"
        exported = run_core(["export", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state), "--output", str(package), "--approve-new"])
        self.assertTrue(exported["ok"])
        data = json.loads(package.read_text())
        self.assertIsNone(data["collections"]["attendance"]["rows"][0]["location"])
        self.assertIsNone(data["collections"]["billing"]["rows"][0]["billingCode"])

    def test_preamble_rows_are_ok_but_headerless_imports_are_rejected(self) -> None:
        attendance = self.tmp / "attendance-preamble.csv"
        billing = self.tmp / "billing-preamble.csv"
        write_csv(attendance, [
            ["Attendance export"],
            ["Date range", "2026-01-01 to 2026-01-31"],
            [],
            ["Client", "Clinician", "Date of service", "Status"],
            ["Alpha Client", "Clinician A", "2026-01-07", "show"],
        ])
        write_csv(billing, [
            ["Appointment export"],
            [],
            ["Date of Service", "Client", "Clinician", "Total Fee"],
            ["2026-01-07", "Alpha Client", "Clinician A", "125"],
        ])
        result = run_core(["analyze", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state)], expect=(0, 2))
        self.assertEqual(result["attendance"]["inputRows"], 1)
        self.assertEqual(result["billing"]["inputRows"], 1)

        headerless = self.tmp / "attendance-headerless.csv"
        write_csv(headerless, [["Alpha Client", "Clinician A", "2026-01-07", "show"]])
        inspected = run_core(["inspect", "--report-type", "attendance", "--input", str(headerless)], expect=2)
        self.assertFalse(inspected["ok"])
        self.assertEqual(inspected["missingRequired"], ["Client", "Clinician", "Date of service", "Status"])
        bad = run_core(["analyze", "--attendance", str(headerless), "--billing", str(billing), "--state-dir", str(self.state)], expect=2)
        self.assertIn("No header row detected", bad["errors"][0]["message"])

    def test_reconciliation_preview_preserves_unmatched_unequal_coverage(self) -> None:
        attendance = self.tmp / "attendance-reconcile.csv"
        billing = self.tmp / "billing-reconcile.csv"
        write_csv(attendance, [
            ["Source Client ID", "Client", "Clinician", "Date of service", "Status"],
            ["CID-1", "Alpha Client", "Clinician A", "2026-01-07", "show"],
            ["CID-2", "Beta Client", "Clinician B", "2026-01-08", "show"],
        ])
        write_csv(billing, [
            ["Source Client ID", "Date of Service", "Client", "Clinician", "Total Fee", "Billing Code"],
            ["CID-1", "2026-01-07", "Alpha Client", "Clinician A", "125", "90837"],
            ["CID-3", "2026-01-09", "Gamma Client", "Clinician C", "80", "90834"],
        ])
        result = run_core(["analyze", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state)], expect=(0, 2))
        reconciliation = result["reconciliation"]
        self.assertEqual(reconciliation["matched"], 1)
        self.assertEqual(reconciliation["unmatchedAttendance"], 1)
        self.assertEqual(reconciliation["unmatchedAppointments"], 1)
        self.assertEqual(reconciliation["expectedAttendanceWithoutBillingRows"], 0)
        self.assertEqual(reconciliation["ambiguousGroups"], 0)
        self.assertIn("schema update", reconciliation["schemaNote"])
        package = self.tmp / "unequal-coverage-package.json"
        exported = run_core(["export", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state), "--output", str(package), "--approve-new"])
        self.assertTrue(exported["ok"])
        data = json.loads(package.read_text())
        self.assertEqual(data["collections"]["attendance"]["rowCount"], 2)
        self.assertEqual(data["collections"]["billing"]["rowCount"], 2)
        self.assertEqual(data["collections"]["attendance"]["coverageEnd"], "2026-01-08")
        self.assertEqual(data["collections"]["billing"]["coverageEnd"], "2026-01-09")
        self.assertNotIn("reconciliation", data)

    def test_reconciliation_flags_multiple_same_day_rows_without_collapsing(self) -> None:
        attendance = self.tmp / "attendance-duplicates.csv"
        billing = self.tmp / "billing-duplicates.csv"
        write_csv(attendance, [
            ["Source Client ID", "Client", "Clinician", "Date of service", "Status"],
            ["CID-1", "Alpha Client", "Clinician A", "2026-01-07", "show"],
            ["CID-1", "Alpha Client", "Clinician A", "2026-01-07", "show"],
        ])
        write_csv(billing, [
            ["Source Client ID", "Date of Service", "Client", "Clinician", "Total Fee"],
            ["CID-1", "2026-01-07", "Alpha Client", "Clinician A", "125"],
        ])
        result = run_core(["analyze", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state)], expect=(0, 2))
        reconciliation = result["reconciliation"]
        self.assertEqual(reconciliation["matched"], 0)
        self.assertEqual(reconciliation["ambiguousGroups"], 1)
        self.assertEqual(reconciliation["ambiguousAttendanceRows"], 2)
        self.assertEqual(reconciliation["ambiguousAppointmentRows"], 1)
        self.assertEqual(result["reviewSummary"]["newClientIds"], 1)
        self.assertEqual(result["reviewSummary"]["reconciliationReviewItems"], 1)
        self.assertEqual(result["reviewSummary"]["reconciliationAmbiguousGroups"], 1)
        self.assertIn("reconciliation_ambiguous", json.dumps(result["reviewItems"]))
        package = self.tmp / "duplicates-preserved-package.json"
        exported = run_core(["export", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state), "--output", str(package), "--approve-new"])
        self.assertTrue(exported["ok"])
        data = json.loads(package.read_text())
        self.assertEqual(data["collections"]["attendance"]["rowCount"], 2)
        self.assertEqual(data["collections"]["billing"]["rowCount"], 1)

    def test_reconciliation_uses_source_appointment_time_when_supplied(self) -> None:
        attendance = self.tmp / "attendance-times.csv"
        billing = self.tmp / "billing-times.csv"
        write_csv(attendance, [
            ["Source Client ID", "Client", "Clinician", "Date of service", "Appointment Time", "Status"],
            ["CID-1", "Alpha Client", "Clinician A", "2026-01-07", "9:00 AM", "show"],
            ["CID-1", "Alpha Client", "Clinician A", "2026-01-07", "10:00 AM", "show"],
        ])
        write_csv(billing, [
            ["Source Client ID", "Date of Service", "Client", "Clinician", "Start Time", "Total Fee"],
            ["CID-1", "2026-01-07", "Alpha Client", "Clinician A", "10:00 AM", "125"],
            ["CID-1", "2026-01-07", "Alpha Client", "Clinician A", "9:00 AM", "125"],
        ])
        result = run_core(["analyze", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state)], expect=(0, 2))
        reconciliation = result["reconciliation"]
        self.assertEqual(reconciliation["matched"], 2)
        self.assertEqual(reconciliation["ambiguousGroups"], 0)
        self.assertEqual(reconciliation["unmatchedAttendance"], 0)
        self.assertEqual(reconciliation["unmatchedAppointments"], 0)

    def test_missing_and_wrong_report_headers_are_clear(self) -> None:
        missing_status = self.tmp / "attendance-missing-status.csv"
        write_csv(missing_status, [
            ["Client", "Clinician", "Date of service", "Location"],
            ["Alpha", "Clinician A", "2026-01-07", "Room"],
        ])
        inspected = run_core(["inspect", "--report-type", "attendance", "--input", str(missing_status)], expect=2)
        self.assertFalse(inspected["ok"])
        self.assertEqual(inspected["missingRequired"], ["Status"])

        billing_as_attendance = self.tmp / "billing-as-attendance.csv"
        write_csv(billing_as_attendance, [
            ["Date of Service", "Client", "Clinician", "Total Fee", "Billing Code"],
            ["2026-01-07", "Alpha", "Clinician A", "125", "90837"],
        ])
        inspected = run_core(["inspect", "--report-type", "attendance", "--input", str(billing_as_attendance)], expect=2)
        self.assertIn("Status", inspected["missingRequired"])
        attendance_as_billing = self.tmp / "attendance-as-billing.csv"
        write_csv(attendance_as_billing, [
            ["Client", "Clinician", "Date of service", "Location", "Status"],
            ["Alpha", "Clinician A", "2026-01-07", "Room", "show"],
        ])
        inspected = run_core(["inspect", "--report-type", "billing", "--input", str(attendance_as_billing)], expect=2)
        self.assertIn("Total Fee", inspected["missingRequired"])

    def test_csv_and_xlsx_swapped_headers_are_matched_by_name(self) -> None:
        attendance = self.tmp / "attendance-swapped.csv"
        billing = self.tmp / "billing-swapped.csv"
        write_csv(attendance, [
            ["Status", "Date of service", "Clinician", "Client", "Location"],
            ["show", "2026-01-07", "Clinician A", "Alpha Client", "Room 1"],
        ])
        write_csv(billing, [
            ["Billing Code", "Total Fee", "Clinician", "Client", "Date of Service"],
            ["00000", "125", "Clinician A", "Alpha Client", "2026-01-07"],
        ])
        inspected = run_core(["inspect", "--report-type", "attendance", "--input", str(attendance)])
        self.assertTrue(inspected["ok"])
        self.assertEqual(inspected["missingRequired"], [])
        package = self.tmp / "swapped-package.json"
        exported = run_core(["export", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state), "--output", str(package), "--approve-new"])
        self.assertTrue(exported["ok"])
        data = json.loads(package.read_text())
        self.assertEqual(data["collections"]["attendance"]["rows"][0]["status"], "show")
        self.assertEqual(data["collections"]["billing"]["rows"][0]["billingCode"], "00000")

        xlsx = self.tmp / "attendance-swapped.xlsx"
        write_xlsx(xlsx, {
            "Attendance": ([
                ["Status", "Date of service", "Clinician", "Client", "Location"],
                ["show", 46029, "Clinician A", "Alpha Client", "Room 1"],
            ], None),
        })
        inspected = run_core(["inspect", "--report-type", "attendance", "--input", str(xlsx)])
        self.assertTrue(inspected["ok"])
        self.assertEqual(inspected["missingRequired"], [])

    def test_xlsx_serial_dates_multi_sheet_and_formula_rejection(self) -> None:
        attendance = self.tmp / "attendance.xlsx"
        billing = self.tmp / "billing.xlsx"
        write_xlsx(attendance, {
            "Notes": ([["not", "a", "report"]], None),
            "Attendance": ([
                ["Client", "Clinician", "Date of service", "Location", "Status"],
                ["Gamma Client", "Clinician C", 46029, "Room 3", "clinician cancelled"],
            ], None),
        })
        write_xlsx(billing, {
            "Billing": ([
                ["Date of Service", "Client", "Clinician", "Total Fee", "Billing Code"],
                [46029, "Gamma Client", "Clinician C", 100, "90834"],
            ], None),
        })
        package = self.tmp / "xlsx-package.json"
        result = run_core(["export", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state), "--output", str(package), "--approve-new"])
        self.assertTrue(result["ok"])
        data = json.loads(package.read_text())
        self.assertEqual(data["collections"]["attendance"]["rows"][0]["serviceDate"], "2026-01-07")
        self.assertEqual(data["collections"]["attendance"]["rows"][0]["status"], "clinician cancelled")
        formula_billing = self.tmp / "formula-billing.xlsx"
        write_xlsx(formula_billing, {
            "Billing": ([
                ["Date of Service", "Client", "Clinician", "Total Fee", "Billing Code"],
                [46029, "Gamma Client", "Clinician C", "", "90834"],
            ], {(2, 4): "SUM(50,50)"})
        })
        bad = run_core(["analyze", "--attendance", str(attendance), "--billing", str(formula_billing), "--state-dir", str(self.state)], expect=2)
        self.assertIn("formula", json.dumps(bad["errors"]))

    def test_xlsx_inspect_missing_required_columns(self) -> None:
        attendance = self.tmp / "attendance-missing-status.xlsx"
        billing = self.tmp / "billing-swapped.xlsx"
        write_xlsx(attendance, {
            "Attendance": ([
                ["Client", "Clinician", "Date of service", "Location"],
                ["Gamma Client", "Clinician C", 46029, "Room 3"],
            ], None),
        })
        write_xlsx(billing, {
            "Billing": ([
                ["Client", "Clinician", "Date of service", "Location", "Status"],
                ["Gamma Client", "Clinician C", 46029, "Room 3", "show"],
            ], None),
        })
        inspected = run_core(["inspect", "--report-type", "attendance", "--input", str(attendance)], expect=2)
        self.assertEqual(inspected["missingRequired"], ["Status"])
        inspected = run_core(["inspect", "--report-type", "billing", "--input", str(billing)], expect=2)
        self.assertEqual(inspected["missingRequired"], ["Total Fee"])

    def test_unsupported_and_corrupt_files(self) -> None:
        attendance, billing = self.valid_csv_inputs()
        legacy = self.tmp / "old.xls"
        legacy.write_bytes(b"not really xls")
        result = run_core(["analyze", "--attendance", str(attendance), "--billing", str(legacy), "--state-dir", str(self.state)], expect=2)
        self.assertIn("Legacy .xls", result["errors"][0]["message"])
        corrupt = self.tmp / "bad.xlsx"
        corrupt.write_bytes(b"bad zip")
        result = run_core(["analyze", "--attendance", str(attendance), "--billing", str(corrupt), "--state-dir", str(self.state)], expect=2)
        self.assertIn("corrupt", result["errors"][0]["message"])

    def test_mapping_backup_import_and_stable_package_id(self) -> None:
        attendance, billing = self.valid_csv_inputs()
        package = self.tmp / "package.json"
        run_core(["export", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(self.state), "--output", str(package), "--approve-new"])
        backup = self.tmp / "mapping-backup.json"
        run_core(["export-mapping", "--state-dir", str(self.state), "--output", str(backup)])
        new_state = self.tmp / "restored"
        imported = run_core(["import-mapping", "--state-dir", str(new_state), "--input", str(backup)])
        self.assertTrue(imported["ok"])
        package2 = self.tmp / "package2.json"
        run_core(["export", "--attendance", str(attendance), "--billing", str(billing), "--state-dir", str(new_state), "--output", str(package2), "--approve-new"])
        data = json.loads(package2.read_text())
        first_data = json.loads(package.read_text())
        self.assertEqual(data["packageId"], first_data["packageId"])
        duplicate_billing = self.tmp / "duplicate-billing.csv"
        write_csv(duplicate_billing, [
            ["Date of Service", "Client", "Clinician", "Total Fee", "Billing Code"],
            ["2026-01-07", "Alpha Client", "Clinician A", "125.50", "00000"],
            ["2026-01-07", "Alpha Client", "Clinician A", "125.50", "00000"],
        ])
        dup_package = self.tmp / "dup-package.json"
        run_core(["export", "--attendance", str(attendance), "--billing", str(duplicate_billing), "--state-dir", str(new_state), "--output", str(dup_package), "--approve-new"])
        dup = json.loads(dup_package.read_text())
        self.assertNotEqual(dup["packageId"], first_data["packageId"])
        self.assertEqual(dup["collections"]["billing"]["rowCount"], 2)


if __name__ == "__main__":
    unittest.main()
