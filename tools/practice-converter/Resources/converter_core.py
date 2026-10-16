#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
}

PACKAGE_FORMAT = "emc-practice-local-import-package"
PACKAGE_VERSION = 1
MAPPING_VERSION = 1
OUTPUT_DETAIL_LIMIT = 200

DEFAULT_CODE_DURATIONS = {
    "1": 75,
    "4": 30,
    "30001": 60,
    "30002": 90,
    "30003": 25,
    "90837": 60,
    "Phone": 15,
    "90791": 75,
    "90833": 30,
    "90834": 45,
    "90835": 75,
    "90837 + 99345": 90,
    "90838": 80,
    "90848": 75,
    "90847": 60,
    "90846": 25,
    "00000": 15,
}

STATUS_MAP = {
    "show": "show",
    "attended": "show",
    "checked in": "show",
    "checked out": "show",
    "complete": "show",
    "completed": "show",
    "kept": "show",
    "occurred": "show",
    "present": "show",
    "seen": "show",
    "cancelled": "cancelled",
    "canceled": "cancelled",
    "cancelled by client": "cancelled",
    "canceled by client": "cancelled",
    "client cancelled": "cancelled",
    "client canceled": "cancelled",
    "late cancel": "cancelled",
    "late canceled": "cancelled",
    "late cancelled": "cancelled",
    "late canceled by client": "cancelled",
    "late cancelled by client": "cancelled",
    "late cancellation": "cancelled",
    "no show": "no show",
    "noshow": "no show",
    "clinician cancelled": "clinician cancelled",
    "clinician canceled": "clinician cancelled",
    "provider cancelled": "clinician cancelled",
    "provider canceled": "clinician cancelled",
    "staff cancelled": "clinician cancelled",
    "staff canceled": "clinician cancelled",
    "therapist cancelled": "clinician cancelled",
    "therapist canceled": "clinician cancelled",
    "cancelled by clinician": "clinician cancelled",
    "canceled by clinician": "clinician cancelled",
    "cancelled by provider": "clinician cancelled",
    "canceled by provider": "clinician cancelled",
}

CANONICAL_STATUS_LABELS = ("Show", "Cancelled", "No show", "Clinician cancelled")
LATE_CANCEL_STATUSES = {
    "late cancel",
    "late canceled",
    "late cancelled",
    "late canceled by client",
    "late cancelled by client",
    "late cancellation",
}

HEADER_SYNONYMS = {
    "client": {"client", "client full name", "client name", "patient", "patient full name", "patient name", "member", "member name", "name"},
    "source_client_id": {
        "client id",
        "client_id",
        "source client id",
        "source id",
        "patient id",
        "member id",
        "unique client id",
        "external client id",
    },
    "clinician": {
        "appointment provider",
        "clinician",
        "clinician name",
        "clinician s",
        "provider",
        "provider name",
        "rendering provider",
        "service provider",
        "staff",
        "staff member",
        "staff member name",
        "staff name",
        "therapist",
        "therapist name",
    },
    "date": {"appt date", "appointment date", "appointment start date", "date", "date of service", "date time", "dos", "service date", "service date time", "start date"},
    "appointment_id": {
        "appointment id",
        "appointment_id",
        "source appointment id",
        "source appointment_id",
        "visit id",
        "visit_id",
        "encounter id",
        "encounter_id",
    },
    "appointment_time": {
        "appointment time",
        "appointment_time",
        "time",
        "start time",
        "start_time",
        "service time",
        "service_time",
    },
    "appointment_title": {
        "appointment title",
        "appointment type",
        "appointment_title",
        "event title",
        "service title",
        "service type",
        "title",
        "visit title",
        "visit type",
    },
    "fee": {"total fee", "fee", "amount", "charge", "billed amount", "total"},
    "billing_code": {"billing code", "billing_code", "code", "cpt", "cpt code"},
    "location": {"location", "room", "office", "office room"},
    "status": {"status", "attendance status", "appointment status"},
}

REQUIRED = {
    "billing": ["date", "client", "clinician", "fee"],
    "attendance": ["client", "clinician", "date", "status"],
}

POSITIONAL = {
    "billing": ["date", "client", "clinician", "fee", "billing_code"],
    "attendance": ["client", "clinician", "date", "location", "status"],
}

OPTIONAL_COLUMNS = {
    "billing": ["billing_code", "source_client_id", "appointment_id", "appointment_time", "appointment_title"],
    "attendance": ["location", "source_client_id", "appointment_id", "appointment_time", "appointment_title", "billing_code"],
}

FIELD_LABELS = {
    "appointment_id": "Source Appointment ID",
    "appointment_title": "Appointment Title",
    "appointment_time": "Appointment Time",
    "billing_code": "Billing Code",
    "client": "Client",
    "clinician": "Clinician",
    "date": "Date of service",
    "fee": "Total Fee",
    "location": "Location",
    "source_client_id": "Source Client ID",
    "status": "Status",
}

OPTIONAL_NOTES = {
    "billing_code": "preserves 00000 text codes",
    "location": "blank imports as unassigned",
    "source_client_id": "keeps same-name clients separate",
    "appointment_id": "same-day reconciliation",
    "appointment_time": "same-day reconciliation",
    "appointment_title": "consultation metadata when explicitly present",
}


class ConverterError(Exception):
    pass


@dataclass
class CellValue:
    value: Any
    formula: bool = False
    style: str | None = None
    ref: str | None = None


@dataclass
class ParsedReport:
    report_type: str
    path: str
    file_kind: str
    sheet: str | None
    available_sheets: list[str]
    records: list[dict[str, Any]]
    warnings: list[str]


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def app_state_dir() -> Path:
    return Path.home() / "Library" / "Application Support" / "Practice Converter"


def ensure_private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass


def private_write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_private_dir(path.parent)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.chmod(tmp_name, 0o600)
        os.replace(tmp_name, path)
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass


def default_mapping() -> dict[str, Any]:
    return {
        "version": MAPPING_VERSION,
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "clients": {},
        "pendingClients": {},
        "clinicians": {},
        "ambiguousNames": [],
    }


def mapping_path(state_dir: Path) -> Path:
    return state_dir / "mapping.json"


def load_mapping(state_dir: Path) -> dict[str, Any]:
    ensure_private_dir(state_dir)
    path = mapping_path(state_dir)
    if not path.exists():
        mapping = default_mapping()
        private_write_json(path, mapping)
        return mapping
    try:
        with path.open("r", encoding="utf-8") as handle:
            mapping = json.load(handle)
    except Exception as exc:
        raise ConverterError(f"Mapping file cannot be read. Use Import Mapping Backup to recover. ({exc})")
    if mapping.get("version") != MAPPING_VERSION:
        raise ConverterError("Mapping file version is unsupported. Export a backup before changing app versions.")
    for key in ["clients", "pendingClients", "clinicians"]:
        mapping.setdefault(key, {})
    mapping.setdefault("ambiguousNames", [])
    return mapping


def backup_mapping(state_dir: Path, reason: str) -> Path | None:
    src = mapping_path(state_dir)
    if not src.exists():
        return None
    backup_dir = state_dir / "Backups"
    ensure_private_dir(backup_dir)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = backup_dir / f"mapping-{stamp}-{reason}.json"
    shutil.copy2(src, dest)
    try:
        os.chmod(dest, 0o600)
    except OSError:
        pass
    return dest


def save_mapping(state_dir: Path, mapping: dict[str, Any], reason: str = "update") -> None:
    backup_mapping(state_dir, reason)
    mapping["updatedAt"] = utc_now()
    private_write_json(mapping_path(state_dir), mapping)


def mapping_fingerprint(mapping: dict[str, Any]) -> str:
    payload = dict(mapping)
    payload.pop("updatedAt", None)
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def save_mapping_if_changed(state_dir: Path, mapping: dict[str, Any], before: str, reason: str = "update") -> None:
    if mapping_fingerprint(mapping) != before:
        save_mapping(state_dir, mapping, reason)


def normalize_header(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_identity(value: Any) -> str:
    text = str(value or "").replace("\u00a0", " ")
    text = "".join(ch for ch in text if ch >= " " or ch in "\t\n")
    text = re.sub(r"\s+", " ", text).strip().upper()
    return text


def clean_display(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def canonical_status(value: Any) -> str | None:
    text = normalize_header(value)
    if not text:
        return None
    return STATUS_MAP.get(text)


def cancellation_subtype(value: Any) -> str | None:
    text = normalize_header(value)
    if not text:
        return None
    if text in LATE_CANCEL_STATUSES:
        return "late_cancelled"
    status = STATUS_MAP.get(text)
    if status == "clinician cancelled":
        return "clinician_cancelled"
    if status == "cancelled":
        return "cancelled"
    return None


def safe_status_text(value: Any, limit: int = 80) -> str:
    text = clean_display(value)
    if len(text) > limit:
        return text[: limit - 1] + "..."
    return text


def unknown_status_message(value: Any) -> str:
    accepted = ", ".join(CANONICAL_STATUS_LABELS)
    source = safe_status_text(value)
    if source:
        return f"unknown status '{source}'; use one of: {accepted}"
    return f"missing status; use one of: {accepted}"


def header_field(header: Any) -> str | None:
    normalized = normalize_header(header)
    for field, names in HEADER_SYNONYMS.items():
        if normalized in names:
            return field
    return None


def row_nonempty(row: list[Any]) -> bool:
    return any(str(cell.value if isinstance(cell, CellValue) else cell or "").strip() for cell in row)


def field_label(field: str) -> str:
    return FIELD_LABELS.get(field, field.replace("_", " ").title())


def column_status(columns: dict[str, int], report_type: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for field in REQUIRED[report_type]:
        items.append({
            "field": field,
            "label": field_label(field),
            "required": True,
            "present": field in columns,
            "aliases": sorted(HEADER_SYNONYMS.get(field, [])),
        })
    for field in OPTIONAL_COLUMNS[report_type]:
        items.append({
            "field": field,
            "label": field_label(field),
            "required": False,
            "present": field in columns,
            "aliases": sorted(HEADER_SYNONYMS.get(field, [])),
            "note": OPTIONAL_NOTES.get(field, "optional"),
        })
    return items


def detect_columns(rows: list[list[CellValue]], report_type: str, strict: bool = True) -> tuple[int | None, dict[str, int], list[str]]:
    best_idx = None
    best_map: dict[str, int] = {}
    best_score = 0
    warnings: list[str] = []
    for idx, row in enumerate(rows[:25]):
        current: dict[str, int] = {}
        for col_idx, cell in enumerate(row):
            field = header_field(cell.value)
            if field and field not in current:
                current[field] = col_idx
        score = sum(1 for field in REQUIRED[report_type] if field in current)
        if score > best_score:
            best_score = score
            best_idx = idx
            best_map = current
    if best_idx is not None and best_score >= min(3, len(REQUIRED[report_type])):
        missing = [field for field in REQUIRED[report_type] if field not in best_map]
        if missing and strict:
            labels = ", ".join(field_label(field) for field in missing)
            raise ConverterError(f"{report_type.title()} file is missing required columns: {labels}.")
        return best_idx, best_map, warnings

    labels = ", ".join(field_label(field) for field in REQUIRED[report_type])
    warnings.append(f"No header row detected in {report_type}; required columns are: {labels}.")
    if strict:
        raise ConverterError(f"No header row detected in {report_type}; required columns are: {labels}.")
    return None, {}, warnings


def header_score(rows: list[list[CellValue]], report_type: str) -> int:
    score = 0
    for row in rows[:25]:
        fields = {field for cell in row if (field := header_field(cell.value))}
        score = max(score, sum(1 for field in REQUIRED[report_type] if field in fields))
    return score


def get_cell(row: list[CellValue], idx: int) -> CellValue:
    if idx < len(row):
        return row[idx]
    return CellValue("")


def parse_csv(path: Path) -> list[list[CellValue]]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            return [[CellValue(cell) for cell in row] for row in csv.reader(handle)]
    except UnicodeDecodeError:
        with path.open("r", encoding="latin-1", newline="") as handle:
            return [[CellValue(cell) for cell in row] for row in csv.reader(handle)]


def excel_col_to_index(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref).group(0)
    value = 0
    for ch in letters:
        value = value * 26 + ord(ch) - 64
    return value - 1


def parse_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        data = zf.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(data)
    strings: list[str] = []
    for si in root.findall("main:si", NS):
        strings.append("".join(t.text or "" for t in si.findall(".//main:t", NS)))
    return strings


def parse_styles(zf: zipfile.ZipFile) -> dict[int, str]:
    builtin = {
        14: "m/d/yy",
        15: "d-mmm-yy",
        16: "d-mmm",
        17: "mmm-yy",
        22: "m/d/yy h:mm",
        49: "@",
    }
    try:
        root = ET.fromstring(zf.read("xl/styles.xml"))
    except KeyError:
        return {}
    custom: dict[int, str] = {}
    for fmt in root.findall("main:numFmts/main:numFmt", NS):
        custom[int(fmt.attrib["numFmtId"])] = fmt.attrib.get("formatCode", "")
    styles: dict[int, str] = {}
    xfs = root.find("main:cellXfs", NS)
    if xfs is not None:
        for idx, xf in enumerate(xfs.findall("main:xf", NS)):
            num_id = int(xf.attrib.get("numFmtId", "0"))
            styles[idx] = custom.get(num_id, builtin.get(num_id, ""))
    return styles


def workbook_sheets(zf: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall("pkgrel:Relationship", NS)
    }
    sheets: list[tuple[str, str]] = []
    for sheet in workbook.findall("main:sheets/main:sheet", NS):
        name = sheet.attrib["name"]
        rel_id = sheet.attrib[f"{{{NS['rel']}}}id"]
        target = rel_map[rel_id]
        if not target.startswith("xl/"):
            target = f"xl/{target}"
        sheets.append((name, target))
    return sheets


def parse_sheet(zf: zipfile.ZipFile, target: str, shared: list[str], styles: dict[int, str]) -> list[list[CellValue]]:
    root = ET.fromstring(zf.read(target))
    rows: list[list[CellValue]] = []
    for row in root.findall("main:sheetData/main:row", NS):
        values: list[CellValue] = []
        for cell in row.findall("main:c", NS):
            ref = cell.attrib.get("r", "")
            col_idx = excel_col_to_index(ref)
            while len(values) <= col_idx:
                values.append(CellValue(""))
            formula = cell.find("main:f", NS) is not None
            style_id = cell.attrib.get("s")
            style = styles.get(int(style_id), "") if style_id and style_id.isdigit() else ""
            raw_type = cell.attrib.get("t")
            value: Any = ""
            if raw_type == "s":
                v = cell.findtext("main:v", default="", namespaces=NS)
                value = shared[int(v)] if v else ""
            elif raw_type == "inlineStr":
                value = "".join(t.text or "" for t in cell.findall(".//main:t", NS))
            elif raw_type == "str":
                value = cell.findtext("main:v", default="", namespaces=NS)
            elif raw_type == "b":
                value = cell.findtext("main:v", default="", namespaces=NS) == "1"
            else:
                v = cell.findtext("main:v", default="", namespaces=NS)
                if v == "":
                    value = ""
                else:
                    try:
                        num = float(v)
                        value = int(num) if num.is_integer() else num
                    except ValueError:
                        value = v
            values[col_idx] = CellValue(value=value, formula=formula, style=style, ref=ref)
        rows.append(values)
    return rows


def parse_xlsx(path: Path, report_type: str, selected_sheet: str | None) -> tuple[list[list[CellValue]], str, list[str], list[str]]:
    if path.suffix.lower() == ".xlsm":
        raise ConverterError("Macro-enabled .xlsm files are not accepted. Export a plain .xlsx, .csv, or values-only file.")
    try:
        with zipfile.ZipFile(path) as zf:
            shared = parse_shared_strings(zf)
            styles = parse_styles(zf)
            sheets = workbook_sheets(zf)
            available = [name for name, _ in sheets]
            candidates: list[tuple[int, str, str, list[list[CellValue]], list[str]]] = []
            for name, target in sheets:
                if selected_sheet and name != selected_sheet:
                    continue
                rows = parse_sheet(zf, target, shared, styles)
                if not any(row_nonempty(row) for row in rows):
                    continue
                sheet_score = header_score(rows, report_type)
                if not selected_sheet and sheet_score < min(3, len(REQUIRED[report_type])):
                    continue
                try:
                    header_idx, mapping, warnings = detect_columns(rows, report_type)
                    score = sheet_score if header_idx is not None else 0
                    candidates.append((score, name, target, rows, warnings))
                except ConverterError:
                    if selected_sheet:
                        raise
                    continue
            if selected_sheet and not candidates:
                raise ConverterError(f"Sheet '{selected_sheet}' was not found or has no usable {report_type} table.")
            if not candidates:
                raise ConverterError(f"No usable {report_type} sheet was found in the workbook.")
            candidates.sort(key=lambda item: item[0], reverse=True)
            if len(candidates) > 1 and candidates[0][0] == candidates[1][0] and candidates[0][0] >= len(REQUIRED[report_type]):
                names = ", ".join(item[1] for item in candidates if item[0] == candidates[0][0])
                raise ConverterError(f"Multiple sheets look like {report_type} reports ({names}). Choose one sheet explicitly.")
            _, name, _, rows, warnings = candidates[0]
            return rows, name, available, warnings
    except zipfile.BadZipFile as exc:
        raise ConverterError("Workbook is corrupt or is not a valid .xlsx file.") from exc


def inspect_xlsx(path: Path, report_type: str, selected_sheet: str | None) -> tuple[list[list[CellValue]], str | None, list[str], list[str]]:
    if path.suffix.lower() == ".xlsm":
        raise ConverterError("Macro-enabled .xlsm files are not accepted. Export a plain .xlsx, .csv, or values-only file.")
    try:
        with zipfile.ZipFile(path) as zf:
            shared = parse_shared_strings(zf)
            styles = parse_styles(zf)
            sheets = workbook_sheets(zf)
            available = [name for name, _ in sheets]
            candidates: list[tuple[int, int, str, list[list[CellValue]]]] = []
            for order, (name, target) in enumerate(sheets):
                if selected_sheet and name != selected_sheet:
                    continue
                rows = parse_sheet(zf, target, shared, styles)
                if not any(row_nonempty(row) for row in rows):
                    continue
                candidates.append((header_score(rows, report_type), -order, name, rows))
            if selected_sheet and not candidates:
                raise ConverterError(f"Sheet '{selected_sheet}' was not found or has no readable {report_type} table.")
            if not candidates:
                raise ConverterError(f"No readable {report_type} sheet was found in the workbook.")
            candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
            _, _, name, rows = candidates[0]
            return rows, name, available, []
    except zipfile.BadZipFile as exc:
        raise ConverterError("Workbook is corrupt or is not a valid .xlsx file.") from exc


def inspect_report(path_str: str, report_type: str, selected_sheet: str | None = None) -> dict[str, Any]:
    path = Path(path_str)
    if not path.exists():
        raise ConverterError(f"{report_type.title()} file does not exist.")
    ext = path.suffix.lower()
    if ext == ".xls":
        raise ConverterError("Legacy .xls is not supported safely by this offline parser. Save as .xlsx or CSV first.")
    if ext == ".csv":
        rows = parse_csv(path)
        sheet = None
        sheets: list[str] = []
        warnings: list[str] = []
        file_kind = "csv"
    elif ext in {".xlsx", ".xlsm"}:
        rows, sheet, sheets, warnings = inspect_xlsx(path, report_type, selected_sheet)
        file_kind = "xlsx"
    else:
        raise ConverterError("Use CSV or XLSX input. Legacy XLS and macro-enabled sheets are rejected.")

    header_idx, columns, header_warnings = detect_columns(rows, report_type, strict=False)
    warnings.extend(header_warnings)
    statuses = column_status(columns, report_type)
    missing = [item["label"] for item in statuses if item["required"] and not item["present"]]
    if missing:
        warnings.append(f"{report_type.title()} file is missing required columns: {', '.join(missing)}.")
    return {
        "ok": not missing,
        "reportType": report_type,
        "fileKind": file_kind,
        "sheet": sheet,
        "availableSheets": sheets,
        "headerRow": header_idx + 1 if header_idx is not None else None,
        "columns": statuses,
        "missingRequired": missing,
        "warnings": warnings,
    }


def read_report(path_str: str, report_type: str, selected_sheet: str | None = None) -> ParsedReport:
    path = Path(path_str)
    if not path.exists():
        raise ConverterError(f"{report_type.title()} file does not exist.")
    ext = path.suffix.lower()
    if ext == ".xls":
        raise ConverterError("Legacy .xls is not supported safely by this offline parser. Save as .xlsx or CSV first.")
    if ext == ".csv":
        rows = parse_csv(path)
        sheet = None
        sheets: list[str] = []
        warnings: list[str] = []
        file_kind = "csv"
    elif ext in {".xlsx", ".xlsm"}:
        rows, sheet, sheets, warnings = parse_xlsx(path, report_type, selected_sheet)
        file_kind = "xlsx"
    else:
        raise ConverterError("Use CSV or XLSX input. Legacy XLS and macro-enabled sheets are rejected.")

    header_idx, columns, header_warnings = detect_columns(rows, report_type)
    warnings.extend(header_warnings)
    start_idx = 0 if header_idx is None else header_idx + 1
    records: list[dict[str, Any]] = []
    for idx, row in enumerate(rows[start_idx:], start=start_idx + 1):
        if not row_nonempty(row):
            continue
        rec: dict[str, Any] = {"sourceRow": idx, "_cells": {}}
        for field, col_idx in columns.items():
            cell = get_cell(row, col_idx)
            rec[field] = cell.value
            rec["_cells"][field] = {
                "formula": cell.formula,
                "style": cell.style,
                "ref": cell.ref,
            }
        records.append(rec)
    return ParsedReport(report_type, str(path), file_kind, sheet, sheets, records, warnings)


def parse_date(value: Any) -> tuple[str | None, str | None]:
    if value in (None, ""):
        return None, "missing date"
    if isinstance(value, (int, float)):
        if value <= 0:
            return None, "invalid date"
        base = datetime(1899, 12, 30)
        return (base + timedelta(days=float(value))).date().isoformat(), None
    text = clean_display(value)
    iso_text = re.sub(r"Z$", "+00:00", text.replace("T", " "))
    try:
        return datetime.fromisoformat(iso_text).date().isoformat(), None
    except ValueError:
        pass
    date_prefix = re.match(r"^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})(?:\s|,|$)", text)
    candidates = [text]
    if date_prefix:
        candidates.append(date_prefix.group(1))
    formats = (
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%m/%d/%y",
        "%Y/%m/%d",
        "%m-%d-%Y",
        "%m-%d-%y",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%m/%d/%Y %H:%M",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %I:%M %p",
        "%m/%d/%Y %I:%M:%S %p",
        "%m/%d/%y %H:%M",
        "%m/%d/%y %H:%M:%S",
        "%m/%d/%y %I:%M %p",
        "%m/%d/%y %I:%M:%S %p",
        "%m-%d-%Y %H:%M",
        "%m-%d-%Y %H:%M:%S",
        "%m-%d-%Y %I:%M %p",
        "%m-%d-%Y %I:%M:%S %p",
        "%b %d %Y",
        "%B %d %Y",
        "%b %d, %Y",
        "%B %d, %Y",
    )
    for candidate in candidates:
        for fmt in formats:
            try:
                return datetime.strptime(candidate, fmt).date().isoformat(), None
            except ValueError:
                pass
    comma_text = text.replace(",", "")
    if comma_text != text:
        for fmt in ("%b %d %Y", "%B %d %Y"):
            try:
                return datetime.strptime(comma_text, fmt).date().isoformat(), None
            except ValueError:
                pass
    return None, "date needs conversion"


def parse_fee(value: Any) -> tuple[float | None, str | None]:
    if value in (None, ""):
        return None, "fee missing"
    if isinstance(value, (int, float)):
        amount = float(value)
    else:
        text = clean_display(value).replace("$", "").replace(",", "")
        try:
            amount = float(text)
        except ValueError:
            return None, "fee missing or text"
    if amount < 0:
        return None, "negative fee"
    return amount, None


def billing_code_text(value: Any, cell_meta: dict[str, Any] | None = None) -> tuple[str | None, str | None]:
    if value in (None, ""):
        return None, None
    if isinstance(value, (int, float)):
        style = (cell_meta or {}).get("style") or ""
        if re.fullmatch(r"0+", style):
            return str(int(value)).zfill(len(style)), None
        return str(int(value) if float(value).is_integer() else value), None
    return str(value), None


def explicit_phone_evidence(*values: Any) -> bool:
    for value in values:
        if normalize_header(value) == "phone":
            return True
    return False


def add_visit_metadata(item: dict[str, Any], record: dict[str, Any], billing_code: str | None = None, include_billing_code: bool = False) -> None:
    if include_billing_code and billing_code:
        item["billingCode"] = billing_code
    code = (billing_code or "").strip()
    if code in {"1", "2", "4", "30001", "30002"}:
        return
    if code == "30003" or explicit_phone_evidence(billing_code, record.get("appointment_title"), record.get("status")):
        item["visitKind"] = "consultation"


def identity_key(record: dict[str, Any]) -> tuple[str | None, str, str, str | None]:
    name = clean_display(record.get("client"))
    norm = normalize_identity(name)
    source = clean_display(record.get("source_client_id"))
    if source:
        return f"source:{source}", "source_id", norm, name
    if not norm:
        return None, "name", norm, name
    return f"name:{norm}", "name", norm, name


def normalize_time_value(value: Any) -> str:
    if value in (None, ""):
        return ""
    if isinstance(value, (int, float)):
        number = float(value)
        if 0 <= number < 1:
            minutes = round(number * 24 * 60)
            return f"{minutes // 60:02d}:{minutes % 60:02d}"
    text = clean_display(value)
    for fmt in ("%H:%M", "%H:%M:%S", "%I:%M %p", "%I:%M:%S %p"):
        try:
            return datetime.strptime(text.upper(), fmt).strftime("%H:%M")
        except ValueError:
            pass
    return normalize_identity(text)


def appointment_qualifier(record: dict[str, Any]) -> tuple[str, str] | None:
    appointment_id = clean_display(record.get("appointment_id"))
    if appointment_id:
        return ("appointment_id", normalize_identity(appointment_id))
    appointment_time = normalize_time_value(record.get("appointment_time"))
    if appointment_time:
        return ("appointment_time", appointment_time)
    return None


def reconciliation_base_key(record: dict[str, Any], report_type: str, row_clients: dict[tuple[str, int], tuple[str | None, str | None]]) -> tuple[str, str, str] | None:
    client_id, _ = row_clients.get((report_type, record["sourceRow"]), (None, None))
    if not client_id:
        return None
    clinician = normalize_identity(clean_display(record.get("clinician")))
    date, date_error = parse_date(record.get("date"))
    if not clinician or date_error or date is None:
        return None
    return client_id, clinician, date


def is_expected_attendance_without_billing(record: dict[str, Any]) -> bool:
    return cancellation_subtype(record.get("status")) in {"cancelled", "clinician_cancelled"}


def reconcile_reports(attendance: ParsedReport, billing: ParsedReport, row_clients: dict[tuple[str, int], tuple[str | None, str | None]]) -> dict[str, Any]:
    grouped: dict[tuple[str, str, str], dict[str, list[dict[str, Any]]]] = {}
    skipped = {"attendance": 0, "billing": 0}
    for report in [attendance, billing]:
        for record in report.records:
            key = reconciliation_base_key(record, report.report_type, row_clients)
            if key is None:
                skipped[report.report_type] += 1
                continue
            grouped.setdefault(key, {"attendance": [], "billing": []})[report.report_type].append(record)

    matched = 0
    unmatched_attendance = 0
    unmatched_billing = 0
    expected_cancelled_attendance: list[int] = []
    expected_clinician_cancelled_attendance: list[int] = []
    ambiguous: list[dict[str, Any]] = []

    for group in grouped.values():
        all_attendance_rows = list(group["attendance"])
        expected_attendance_rows = [record for record in all_attendance_rows if is_expected_attendance_without_billing(record)]
        expected_cancelled_attendance.extend(
            record["sourceRow"] for record in expected_attendance_rows
            if cancellation_subtype(record.get("status")) == "cancelled"
        )
        expected_clinician_cancelled_attendance.extend(
            record["sourceRow"] for record in expected_attendance_rows
            if cancellation_subtype(record.get("status")) == "clinician_cancelled"
        )
        attendance_rows = [record for record in all_attendance_rows if not is_expected_attendance_without_billing(record)]
        billing_rows = list(group["billing"])
        if len(attendance_rows) == 1 and len(billing_rows) == 1:
            matched += 1
            continue
        if not attendance_rows:
            unmatched_billing += len(billing_rows)
            continue
        if not billing_rows:
            unmatched_attendance += len(attendance_rows)
            continue

        used_attendance: set[int] = set()
        used_billing: set[int] = set()
        attendance_by_qualifier: dict[tuple[str, str], list[int]] = {}
        billing_by_qualifier: dict[tuple[str, str], list[int]] = {}
        for index, record in enumerate(attendance_rows):
            qualifier = appointment_qualifier(record)
            if qualifier:
                attendance_by_qualifier.setdefault(qualifier, []).append(index)
        for index, record in enumerate(billing_rows):
            qualifier = appointment_qualifier(record)
            if qualifier:
                billing_by_qualifier.setdefault(qualifier, []).append(index)
        for qualifier in set(attendance_by_qualifier) & set(billing_by_qualifier):
            attendance_matches = attendance_by_qualifier[qualifier]
            billing_matches = billing_by_qualifier[qualifier]
            if len(attendance_matches) == 1 and len(billing_matches) == 1:
                used_attendance.add(attendance_matches[0])
                used_billing.add(billing_matches[0])
                matched += 1

        remaining_attendance = [record for index, record in enumerate(attendance_rows) if index not in used_attendance]
        remaining_billing = [record for index, record in enumerate(billing_rows) if index not in used_billing]
        if remaining_attendance and remaining_billing:
            ambiguous.append({
                "attendanceRows": [record["sourceRow"] for record in remaining_attendance],
                "appointmentRows": [record["sourceRow"] for record in remaining_billing],
                "reason": "multiple rows share the same client, clinician, and date without a one-to-one source appointment ID or time",
            })
        else:
            unmatched_attendance += len(remaining_attendance)
            unmatched_billing += len(remaining_billing)

    ambiguous_attendance_rows = sum(len(item["attendanceRows"]) for item in ambiguous)
    ambiguous_billing_rows = sum(len(item["appointmentRows"]) for item in ambiguous)
    return {
        "matched": matched,
        "unmatchedAttendance": unmatched_attendance,
        "unmatchedAppointments": unmatched_billing,
        "expectedAttendanceWithoutBillingRows": len(expected_cancelled_attendance) + len(expected_clinician_cancelled_attendance),
        "expectedCancelledAttendanceRows": len(expected_cancelled_attendance),
        "expectedCancelledAttendance": expected_cancelled_attendance[:10],
        "expectedClinicianCancelledAttendanceRows": len(expected_clinician_cancelled_attendance),
        "expectedClinicianCancelledAttendance": expected_clinician_cancelled_attendance[:10],
        "ambiguousGroups": len(ambiguous),
        "ambiguousAttendanceRows": ambiguous_attendance_rows,
        "ambiguousAppointmentRows": ambiguous_billing_rows,
        "skippedAttendanceRows": skipped["attendance"],
        "skippedAppointmentRows": skipped["billing"],
        "ambiguous": ambiguous[:10],
        "matchCriteria": "stable client ID + normalized clinician + date, with source appointment ID/time used only when supplied",
        "schemaNote": "This is a preview only. Export still writes separate attendance and appointment collections; exporting reconciled visit rows would require a package schema update.",
        "notes": [
            "Cancelled and clinician-cancelled attendance rows are expected to have no billing row and are preserved without creating a charge.",
            "Late-cancelled source rows are tracked internally for a future importer-safe subtype; package v1 still exports the existing cancelled status only.",
            "Unmatched rows are preserved because cancellations, no-shows, and charges may legitimately differ.",
            "The preview does not mark paid/charged rows as attended and does not collapse duplicates.",
        ],
    }


def get_or_make_clinician(mapping: dict[str, Any], clinician_name: str) -> str:
    norm = normalize_identity(clinician_name)
    clinicians = mapping.setdefault("clinicians", {})
    if norm not in clinicians:
        clinicians[norm] = {"displayName": clinician_name, "createdAt": utc_now()}
    return clinicians[norm]["displayName"]


def resolve_client(mapping: dict[str, Any], key: str, key_type: str, norm: str, display: str) -> tuple[str, bool]:
    clients = mapping.setdefault("clients", {})
    pending = mapping.setdefault("pendingClients", {})
    if key in clients:
        return clients[key]["clientId"], False
    if key not in pending:
        pending[key] = {
            "clientId": str(uuid.uuid4()),
            "keyType": key_type,
            "normalizedName": norm,
            "displayName": display,
            "createdAt": utc_now(),
        }
    return pending[key]["clientId"], True


def analyze_records(attendance: ParsedReport, billing: ParsedReport, mapping: dict[str, Any]) -> dict[str, Any]:
    errors: list[dict[str, Any]] = []
    review_items: dict[str, dict[str, Any]] = {}
    warnings = list(attendance.warnings) + list(billing.warnings)
    all_identity_rows: dict[str, set[str]] = {}
    source_id_names: dict[str, set[str]] = {}
    row_clients: dict[tuple[str, int], tuple[str | None, str | None]] = {}

    for report in [attendance, billing]:
        for rec in report.records:
            key, key_type, norm, display = identity_key(rec)
            if not key:
                errors.append({"report": report.report_type, "row": rec["sourceRow"], "message": "blank client"})
                row_clients[(report.report_type, rec["sourceRow"])] = (None, None)
                continue
            all_identity_rows.setdefault(norm, set()).add(key)
            if key_type == "source_id":
                source_id_names.setdefault(norm, set()).add(key)
            if key_type == "name" and norm in set(mapping.get("ambiguousNames", [])):
                errors.append({"report": report.report_type, "row": rec["sourceRow"], "message": "same-name ambiguity requires a source unique ID"})
                row_clients[(report.report_type, rec["sourceRow"])] = (None, None)
                continue
            client_id, is_new = resolve_client(mapping, key, key_type, norm, display)
            row_clients[(report.report_type, rec["sourceRow"])] = (client_id, key)
            if is_new:
                review_id = hashlib.sha256(key.encode()).hexdigest()[:16]
                review_items[review_id] = {
                    "id": review_id,
                    "type": "new_client",
                    "displayName": display,
                    "keyType": key_type,
                    "assignedClientId": client_id,
                    "message": "New client identity. Review locally before export.",
                }

    for norm, keys in source_id_names.items():
        if len(keys) > 1:
            mapping.setdefault("ambiguousNames", [])
            if norm not in mapping["ambiguousNames"]:
                mapping["ambiguousNames"].append(norm)
            review_id = hashlib.sha256(("same-name:" + norm).encode()).hexdigest()[:16]
            review_items[review_id] = {
                "id": review_id,
                "type": "same_name_source_ids",
                "displayName": norm.title(),
                "message": "Same client name appears with multiple source IDs. The app will keep them separate by source ID; future reports without source IDs must be disambiguated.",
            }

    reconciliation = reconcile_reports(attendance, billing, row_clients)
    if reconciliation["ambiguousGroups"]:
        review_id = "reconciliation-ambiguous"
        review_items[review_id] = {
            "id": review_id,
            "type": "reconciliation_ambiguous",
            "message": (
                f"Reconciliation found {reconciliation['ambiguousGroups']} duplicate/ambiguous "
                "client-clinician-date group(s). Review before export; rows will be preserved separately."
            ),
        }

    return {
        "errors": errors,
        "reviewItems": list(review_items.values()),
        "warnings": warnings,
        "rowClients": row_clients,
        "reconciliation": reconciliation,
    }


def build_package(attendance: ParsedReport, billing: ParsedReport, mapping: dict[str, Any], row_clients: dict[tuple[str, int], tuple[str | None, str | None]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    errors: list[dict[str, Any]] = []
    attendance_items: list[dict[str, Any]] = []
    billing_items: list[dict[str, Any]] = []
    dates = {"attendance": [], "billing": []}

    for rec in attendance.records:
        client_id, _ = row_clients.get(("attendance", rec["sourceRow"]), (None, None))
        if not client_id:
            continue
        for field in ["client", "clinician", "date", "status", "appointment_time", "appointment_title", "billing_code"]:
            if rec.get("_cells", {}).get(field, {}).get("formula"):
                errors.append({"report": "attendance", "row": rec["sourceRow"], "message": f"{field} cell contains a formula; paste values first"})
        date, date_error = parse_date(rec.get("date"))
        clinician = clean_display(rec.get("clinician"))
        status = canonical_status(rec.get("status"))
        code, code_warning = billing_code_text(rec.get("billing_code"), rec.get("_cells", {}).get("billing_code"))
        if code_warning:
            errors.append({"report": "attendance", "row": rec["sourceRow"], "message": code_warning})
        if date_error:
            errors.append({"report": "attendance", "row": rec["sourceRow"], "message": date_error})
        if not clinician:
            errors.append({"report": "attendance", "row": rec["sourceRow"], "message": "blank clinician"})
        if not status:
            errors.append({"report": "attendance", "row": rec["sourceRow"], "message": unknown_status_message(rec.get("status"))})
        if date_error or not clinician or not status or code_warning:
            continue
        clinician_label = get_or_make_clinician(mapping, clinician)
        location = clean_display(rec.get("location"))
        item = {
            "clientId": client_id,
            "clinician": clinician_label,
            "serviceDate": date,
            "location": location or None,
            "status": status,
        }
        if cancellation_subtype(rec.get("status")) == "late_cancelled":
            item["cancellationSubtype"] = "late_cancelled"
        add_visit_metadata(item, rec, billing_code=code, include_billing_code=True)
        attendance_items.append(item)
        dates["attendance"].append(date)

    for rec in billing.records:
        client_id, _ = row_clients.get(("billing", rec["sourceRow"]), (None, None))
        if not client_id:
            continue
        for field in ["client", "clinician", "date", "fee", "billing_code", "appointment_time", "appointment_title"]:
            if rec.get("_cells", {}).get(field, {}).get("formula"):
                errors.append({"report": "billing", "row": rec["sourceRow"], "message": f"{field} cell contains a formula; paste values first"})
        date, date_error = parse_date(rec.get("date"))
        clinician = clean_display(rec.get("clinician"))
        fee, fee_error = parse_fee(rec.get("fee"))
        code, code_warning = billing_code_text(rec.get("billing_code"), rec.get("_cells", {}).get("billing_code"))
        if code_warning:
            errors.append({"report": "billing", "row": rec["sourceRow"], "message": code_warning})
        if date_error:
            errors.append({"report": "billing", "row": rec["sourceRow"], "message": date_error})
        if not clinician:
            errors.append({"report": "billing", "row": rec["sourceRow"], "message": "blank clinician"})
        if fee_error:
            errors.append({"report": "billing", "row": rec["sourceRow"], "message": fee_error})
        if date_error or not clinician or fee_error or code_warning:
            continue
        clinician_label = get_or_make_clinician(mapping, clinician)
        item = {
            "clientId": client_id,
            "clinician": clinician_label,
            "serviceDate": date,
            "totalFeeCharged": round(fee, 2),
            "billingCode": code,
        }
        add_visit_metadata(item, rec, billing_code=code)
        billing_items.append(item)
        dates["billing"].append(date)

    if not attendance_items:
        errors.append({"report": "attendance", "row": None, "message": "attendance export has no valid rows"})
    if not billing_items:
        errors.append({"report": "billing", "row": None, "message": "billing export has no valid rows"})

    collections = {
        "attendance": collection_payload(dates["attendance"], attendance_items),
        "billing": collection_payload(dates["billing"], billing_items),
    }
    legacy_codes = {"1", "4", "30001", "30002", "30003"}
    used_codes = {str(row.get("billingCode") or "").strip() for row in attendance_items + billing_items}
    durations = {code: minutes for code, minutes in DEFAULT_CODE_DURATIONS.items() if code not in legacy_codes or code in used_codes}
    package_basis = {
        "collections": collections,
        "billingCodeMinutes": durations,
    }
    package = {
        "format": PACKAGE_FORMAT,
        "version": PACKAGE_VERSION,
        "packageId": package_id(package_basis),
        "exportedAt": utc_now(),
        "collections": collections,
        "billingCodeMinutes": durations,
    }
    return package, errors


def collection_payload(dates: list[str], rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "coverageStart": min(dates) if dates else None,
        "coverageEnd": max(dates) if dates else None,
        "rowCount": len(rows),
        "rows": rows,
    }


def package_id(package_basis: dict[str, Any]) -> str:
    payload = json.dumps(package_basis, sort_keys=True, separators=(",", ":"))
    return "pkg_" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def promote_pending(mapping: dict[str, Any], row_clients: dict[tuple[str, int], tuple[str | None, str | None]]) -> None:
    clients = mapping.setdefault("clients", {})
    pending = mapping.setdefault("pendingClients", {})
    used_keys = {key for _, key in row_clients.values() if key}
    for key in sorted(used_keys):
        if key in pending and key not in clients:
            clients[key] = pending.pop(key)
            clients[key]["approvedAt"] = utc_now()


def load_inputs(args: argparse.Namespace) -> tuple[ParsedReport, ParsedReport]:
    attendance = read_report(args.attendance, "attendance", getattr(args, "attendance_sheet", None))
    billing = read_report(args.billing, "billing", getattr(args, "billing_sheet", None))
    return attendance, billing


def date_parse_summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    summary: dict[str, Any] = {"valid": 0, "missing": 0, "invalid": 0, "messages": {}}
    for record in records:
        _, error = parse_date(record.get("date"))
        if error:
            summary["invalid"] += 1
            summary["messages"][error] = summary["messages"].get(error, 0) + 1
            if error == "missing date":
                summary["missing"] += 1
        else:
            summary["valid"] += 1
    return summary


def attendance_status_summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    categories = {"show": 0, "cancelled": 0, "no show": 0, "clinician cancelled": 0}
    cancellation_subtypes = {"cancelled": 0, "late_cancelled": 0, "clinician_cancelled": 0}
    unknown: dict[str, int] = {}
    blank = 0
    for record in records:
        raw = record.get("status")
        normalized = normalize_header(raw)
        status = canonical_status(raw)
        if status:
            categories[status] += 1
            subtype = cancellation_subtype(raw)
            if subtype:
                cancellation_subtypes[subtype] += 1
        elif normalized:
            unknown[normalized] = unknown.get(normalized, 0) + 1
        else:
            blank += 1
    return {
        "categories": categories,
        "cancellationSubtypes": cancellation_subtypes,
        "unknownCount": sum(unknown.values()),
        "blankCount": blank,
        "unknownNormalizedValues": dict(sorted(unknown.items(), key=lambda item: (-item[1], item[0]))[:20]),
    }


def usability_summary(report: ParsedReport, row_clients: dict[tuple[str, int], tuple[str | None, str | None]]) -> dict[str, Any]:
    summary = {
        "usable": 0,
        "blankClient": 0,
        "blankClinician": 0,
        "dateInvalid": 0,
        "dateMessages": {},
    }
    for record in report.records:
        client_id, _ = row_clients.get((report.report_type, record["sourceRow"]), (None, None))
        clinician = normalize_identity(clean_display(record.get("clinician")))
        _, date_error = parse_date(record.get("date"))
        if client_id and clinician and not date_error:
            summary["usable"] += 1
            continue
        if not client_id:
            summary["blankClient"] += 1
        if not clinician:
            summary["blankClinician"] += 1
        if date_error:
            summary["dateInvalid"] += 1
            summary["dateMessages"][date_error] = summary["dateMessages"].get(date_error, 0) + 1
    return summary


def command_diagnose(args: argparse.Namespace) -> dict[str, Any]:
    attendance, billing = load_inputs(args)
    mapping = default_mapping()
    analysis = analyze_records(attendance, billing, mapping)
    package, package_errors = build_package(attendance, billing, mapping, analysis["rowClients"])
    all_errors = list(analysis["errors"]) + package_errors
    return {
        "ok": not all_errors,
        "attendance": {
            "fileKind": attendance.file_kind,
            "sheet": attendance.sheet,
            "availableSheets": attendance.available_sheets,
            "inputRows": len(attendance.records),
            "exportableRows": package["collections"]["attendance"]["rowCount"],
            "dateParsing": date_parse_summary(attendance.records),
            "reconciliationUsability": usability_summary(attendance, analysis["rowClients"]),
            "statusSummary": attendance_status_summary(attendance.records),
        },
        "billing": {
            "fileKind": billing.file_kind,
            "sheet": billing.sheet,
            "availableSheets": billing.available_sheets,
            "inputRows": len(billing.records),
            "exportableRows": package["collections"]["billing"]["rowCount"],
            "dateParsing": date_parse_summary(billing.records),
            "reconciliationUsability": usability_summary(billing, analysis["rowClients"]),
        },
        "warningCount": len(analysis["warnings"]),
        "errorCount": len(all_errors),
        "reviewItemCount": len(analysis["reviewItems"]),
        "reviewSummary": review_summary(analysis),
        "errorMessages": dict(sorted(message_counts(all_errors).items())),
        "reconciliation": analysis["reconciliation"],
    }


def message_counts(errors: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for error in errors:
        message = str(error.get("message", "unknown error"))
        counts[message] = counts.get(message, 0) + 1
    return counts


def review_summary(analysis: dict[str, Any]) -> dict[str, Any]:
    by_type: dict[str, int] = {}
    for item in analysis["reviewItems"]:
        item_type = str(item.get("type", "review"))
        by_type[item_type] = by_type.get(item_type, 0) + 1
    reconciliation = analysis["reconciliation"]
    return {
        "total": len(analysis["reviewItems"]),
        "newClientIds": by_type.get("new_client", 0),
        "sameNameSourceIdWarnings": by_type.get("same_name_source_ids", 0),
        "reconciliationReviewItems": by_type.get("reconciliation_ambiguous", 0),
        "reconciliationAmbiguousGroups": reconciliation.get("ambiguousGroups", 0),
        "reconciliationAmbiguousAttendanceRows": reconciliation.get("ambiguousAttendanceRows", 0),
        "reconciliationAmbiguousAppointmentRows": reconciliation.get("ambiguousAppointmentRows", 0),
        "expectedAttendanceWithoutBillingRows": reconciliation.get("expectedAttendanceWithoutBillingRows", 0),
        "expectedCancelledAttendanceRows": reconciliation.get("expectedCancelledAttendanceRows", 0),
        "expectedClinicianCancelledAttendanceRows": reconciliation.get("expectedClinicianCancelledAttendanceRows", 0),
        "unmatchedAttendanceRows": reconciliation.get("unmatchedAttendance", 0),
        "unmatchedAppointmentRows": reconciliation.get("unmatchedAppointments", 0),
        "byType": by_type,
    }


def limited_analysis_details(analysis: dict[str, Any], errors: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    all_errors = list(errors if errors is not None else analysis["errors"])
    all_reviews = list(analysis["reviewItems"])
    all_warnings = list(analysis["warnings"])
    return {
        "warnings": all_warnings[:OUTPUT_DETAIL_LIMIT],
        "warningCount": len(all_warnings),
        "errors": all_errors[:OUTPUT_DETAIL_LIMIT],
        "errorCount": len(all_errors),
        "reviewItems": all_reviews[:OUTPUT_DETAIL_LIMIT],
        "reviewItemCount": len(all_reviews),
        "detailsLimit": OUTPUT_DETAIL_LIMIT,
        "detailsTruncated": (
            len(all_warnings) > OUTPUT_DETAIL_LIMIT
            or len(all_errors) > OUTPUT_DETAIL_LIMIT
            or len(all_reviews) > OUTPUT_DETAIL_LIMIT
        ),
        "reviewSummary": review_summary(analysis),
        "reconciliation": analysis["reconciliation"],
    }


def command_analyze(args: argparse.Namespace) -> dict[str, Any]:
    state_dir = Path(args.state_dir).expanduser()
    mapping = load_mapping(state_dir)
    before_mapping = mapping_fingerprint(mapping)
    attendance, billing = load_inputs(args)
    analysis = analyze_records(attendance, billing, mapping)
    package, package_errors = build_package(attendance, billing, mapping, analysis["rowClients"])
    analysis["errors"].extend(package_errors)
    save_mapping_if_changed(state_dir, mapping, before_mapping, "analyze")
    response = {
        "ok": not analysis["errors"],
        "exportReady": not analysis["errors"] and not analysis["reviewItems"],
        "attendance": {
            "fileKind": attendance.file_kind,
            "sheet": attendance.sheet,
            "availableSheets": attendance.available_sheets,
            "inputRows": len(attendance.records),
            "exportableRows": package["collections"]["attendance"]["rowCount"],
        },
        "billing": {
            "fileKind": billing.file_kind,
            "sheet": billing.sheet,
            "availableSheets": billing.available_sheets,
            "inputRows": len(billing.records),
            "exportableRows": package["collections"]["billing"]["rowCount"],
        },
    }
    response.update(limited_analysis_details(analysis))
    return response


def command_inspect(args: argparse.Namespace) -> dict[str, Any]:
    return inspect_report(args.input, args.report_type, getattr(args, "sheet", None))


def command_export(args: argparse.Namespace) -> dict[str, Any]:
    state_dir = Path(args.state_dir).expanduser()
    mapping = load_mapping(state_dir)
    attendance, billing = load_inputs(args)
    analysis = analyze_records(attendance, billing, mapping)
    if analysis["errors"]:
        response = {"ok": False}
        response.update(limited_analysis_details(analysis))
        return response
    if analysis["reviewItems"] and not args.approve_new:
        response = {"ok": False, "message": "Review new or ambiguous identities before export."}
        response.update(limited_analysis_details(analysis, errors=[]))
        return response
    promote_pending(mapping, analysis["rowClients"])
    package, package_errors = build_package(attendance, billing, mapping, analysis["rowClients"])
    if package_errors:
        response = {"ok": False}
        response.update(limited_analysis_details(analysis, errors=package_errors))
        return response
    output = Path(args.output).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{output.name}.", dir=output.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(package, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.chmod(tmp_name, 0o600)
        os.replace(tmp_name, output)
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
    save_mapping(state_dir, mapping, "export")
    return {
        "ok": True,
        "output": str(output),
        "packageId": package["packageId"],
        "attendance": {"rowCount": package["collections"]["attendance"]["rowCount"]},
        "billing": {"rowCount": package["collections"]["billing"]["rowCount"]},
    }


def command_export_mapping(args: argparse.Namespace) -> dict[str, Any]:
    state_dir = Path(args.state_dir).expanduser()
    mapping = load_mapping(state_dir)
    output = Path(args.output).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as handle:
        json.dump(mapping, handle, indent=2, sort_keys=True)
        handle.write("\n")
    os.chmod(output, 0o600)
    return {"ok": True, "output": str(output)}


def command_import_mapping(args: argparse.Namespace) -> dict[str, Any]:
    state_dir = Path(args.state_dir).expanduser()
    incoming_path = Path(args.input).expanduser()
    with incoming_path.open("r", encoding="utf-8") as handle:
        incoming = json.load(handle)
    if incoming.get("version") != MAPPING_VERSION:
        raise ConverterError("Backup mapping version is unsupported.")
    mapping = load_mapping(state_dir)
    backup = backup_mapping(state_dir, "pre-import")
    conflicts: list[str] = []
    for section in ["clients", "pendingClients", "clinicians"]:
        mapping.setdefault(section, {})
        for key, value in incoming.get(section, {}).items():
            if key in mapping[section] and mapping[section][key].get("clientId") != value.get("clientId"):
                conflicts.append(f"{section}:{key}")
                continue
            mapping[section][key] = value
    for name in incoming.get("ambiguousNames", []):
        if name not in mapping.setdefault("ambiguousNames", []):
            mapping["ambiguousNames"].append(name)
    save_mapping(state_dir, mapping, "import")
    return {"ok": not conflicts, "conflicts": conflicts, "backup": str(backup) if backup else None}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Practice Converter offline core")
    sub = parser.add_subparsers(dest="command", required=True)
    inspect = sub.add_parser("inspect")
    inspect.add_argument("--report-type", choices=["attendance", "billing"], required=True)
    inspect.add_argument("--input", required=True)
    inspect.add_argument("--sheet")
    for name in ["analyze", "export"]:
        cmd = sub.add_parser(name)
        cmd.add_argument("--attendance", required=True)
        cmd.add_argument("--billing", required=True)
        cmd.add_argument("--attendance-sheet")
        cmd.add_argument("--billing-sheet")
        cmd.add_argument("--state-dir", default=str(app_state_dir()))
        if name == "export":
            cmd.add_argument("--output", required=True)
            cmd.add_argument("--approve-new", action="store_true")
    diag = sub.add_parser("diagnose")
    diag.add_argument("--attendance", required=True)
    diag.add_argument("--billing", required=True)
    diag.add_argument("--attendance-sheet")
    diag.add_argument("--billing-sheet")
    exp = sub.add_parser("export-mapping")
    exp.add_argument("--state-dir", default=str(app_state_dir()))
    exp.add_argument("--output", required=True)
    imp = sub.add_parser("import-mapping")
    imp.add_argument("--state-dir", default=str(app_state_dir()))
    imp.add_argument("--input", required=True)
    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "inspect":
            result = command_inspect(args)
        elif args.command == "analyze":
            result = command_analyze(args)
        elif args.command == "export":
            result = command_export(args)
        elif args.command == "diagnose":
            result = command_diagnose(args)
        elif args.command == "export-mapping":
            result = command_export_mapping(args)
        elif args.command == "import-mapping":
            result = command_import_mapping(args)
        else:
            raise ConverterError("Unknown command")
        print(json.dumps(result, sort_keys=True))
        return 0 if result.get("ok", True) else 2
    except ConverterError as exc:
        print(json.dumps({"ok": False, "errors": [{"message": str(exc)}]}), file=sys.stdout)
        return 2
    except Exception as exc:
        print(json.dumps({"ok": False, "errors": [{"message": f"Unexpected local error: {exc}"}]}), file=sys.stdout)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
