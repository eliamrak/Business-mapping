import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  Download,
  Check,
  FileText,
  History,
  Copy,
  Save,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import {
  workspaceSchema,
  type Collection,
  type Workspace,
} from "@workspace/practice/hub";
import { sessionInputSchema } from "@workspace/practice";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { saveSessionRecord } from "@/lib/session-api";
import { exportCsv } from "@/lib/hub-api";
import { fields, schemas, newRecord, fieldOptions, type Field } from "./config";
import { Tabs, fmt, type ViewProps } from "./views";
import Reports from "./reports";
type Attachment = {
  id: string;
  periodId: string;
  name: string;
  size: number;
  mime: string;
  actor: string;
  createdAt: string;
};
type Preview = {
  sheets: { name: string; rows: string[][] }[];
  limited?: boolean;
  manual?: boolean;
};
const sessionFields: Field[] = [
  {
    key: "clinicianId",
    label: "Clinician",
    type: "select",
    source: "legacyClinicians",
  },
  { key: "start", label: "Period start", type: "date" },
  { key: "end", label: "Period end", type: "date" },
  { key: "completed", label: "Completed", type: "number" },
  { key: "desired", label: "Desired", type: "number" },
  { key: "cancelled", label: "Cancelled", type: "number", optional: true },
  { key: "noShow", label: "No-shows", type: "number", optional: true },
  {
    key: "scheduled",
    label: "Scheduled sessions",
    type: "number",
    optional: true,
  },
  {
    key: "inPerson",
    label: "Completed in person",
    type: "number",
    optional: true,
  },
  {
    key: "telehealth",
    label: "Completed by telehealth",
    type: "number",
    optional: true,
  },
];
export default function Updates(props: ViewProps & { theme: string }) {
  const { workspace, context, save, table, theme } = props;
  const cache = useQueryClient();
  const [tab, setTab] = useState("periods"),
    [periodId, setPeriodId] = useState(""),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [reviewPeriod, setReviewPeriod] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [sheet, setSheet] = useState(0),
    [header, setHeader] = useState(0),
    [target, setTarget] = useState("transactions"),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [prepared, setPrepared] = useState<Record<string, unknown>[]>([]),
    [rowErrors, setRowErrors] = useState<string[]>([]),
    [savedRows, setSavedRows] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    requestIds = useRef<string[]>([]);
  const attachments = useQuery({
    queryKey: ["hub-attachments"],
    queryFn: () => customFetch<Attachment[]>("/api/hub/attachments"),
  });
  const history = useQuery({
    queryKey: ["hub-history", workspace],
    queryFn: () =>
      customFetch<
        { revision: number; actor: string; action: string; createdAt: string }[]
      >("/api/hub/history"),
    enabled: tab === "history",
  });
  const period =
    workspace.periods.find((p) => p.id === periodId) ??
    workspace.periods.find((p) => p.status !== "finalized" && !p.archived);
  async function upload(file: File) {
    if (!file.size || file.size > 10 * 1024 * 1024) {
      setError("Choose a file between 1 byte and 10 MB.");
      return;
    }
    if (!period) {
      setError("Create or select a draft reporting period first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await customFetch("/api/hub/attachments", {
        method: "POST",
        body: JSON.stringify({
          id: crypto.randomUUID(),
          periodId: period.id,
          name: file.name,
          data,
        }),
      });
      await attachments.refetch();
      setStatus("Source document saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function openFile(file: Attachment) {
    setAttachment(file);
    setPreview(null);
    setPrepared([]);
    setSavedRows(0);
    setRowErrors([]);
    setMapping({});
    setSheet(0);
    setHeader(0);
    setBusy(true);
    try {
      setPreview(
        await customFetch<Preview>(`/api/hub/attachments/${file.id}/preview`),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  }
  const importFields =
    target === "sessions"
      ? sessionFields
      : fields[target as Collection].filter(
          (f) => !["notes", "archived", "sourceAttachmentId"].includes(f.key),
        );
  const rows = preview?.sheets[sheet]?.rows ?? [],
    headers = rows[header] ?? [];
  const mappingKey = `emc.import-mapping.${target}.${JSON.stringify(headers)}`;
  useEffect(() => {
    if (!headers.length) return;
    try {
      const saved = JSON.parse(localStorage.getItem(mappingKey) ?? "null");
      if (saved && typeof saved === "object") {
        setMapping(saved);
        return;
      }
    } catch {}
    setMapping(
      Object.fromEntries(
        importFields.flatMap((field) => {
          const index = headers.findIndex((h) =>
            [field.key, field.label].some(
              (label) => label.toLowerCase() === String(h).trim().toLowerCase(),
            ),
          );
          return index < 0 ? [] : [[field.key, String(index)]];
        }),
      ),
    );
  }, [mappingKey]);
  function prepare() {
    if (!attachment) return;
    setRowErrors([]);
    const errors: string[] = [],
      records: Record<string, unknown>[] = [];
    const parent = workspace.periods.find((p) => p.id === attachment.periodId);
    if (!parent) return;
    if (parent.status === "finalized") {
      setRowErrors([
        "This period is finalized. Correct its existing entries individually with a reason.",
      ]);
      return;
    }
    const required: Record<string, string[]> = {
      transactions: ["categoryId", "description", "amount"],
      budgets: ["name", "categoryId", "amount", "cadence"],
      sessions: ["clinicianId", "completed", "desired"],
      funnels: ["campaignId"],
    };
    const missing = required[target].filter(
      (key) => mapping[key] === undefined || mapping[key] === "",
    );
    if (
      target === "funnels" &&
      ![
        "spend",
        "leads",
        "scheduled",
        "attended",
        "clients",
        "firstSessions",
      ].some((key) => mapping[key] !== undefined && mapping[key] !== "")
    )
      missing.push("at least one funnel measurement");
    if (missing.length) {
      setPrepared([]);
      setRowErrors([
        `Map required fields before review: ${missing.join(", ")}. Missing measurements are not assumed to be zero.`,
      ]);
      return;
    }
    if (preview?.limited) {
      setRowErrors([
        "This file exceeds the 1,000-row review limit. Split it into smaller files before importing.",
      ]);
      return;
    }
    const existing =
      target === "sessions"
        ? (context.sessions as unknown as Record<string, unknown>[])
        : (workspace[target as Collection] as unknown as Record<
            string,
            unknown
          >[]);
    if (
      existing.some(
        (r) =>
          r.sourceAttachmentId === attachment.id ||
          r.attachmentId === attachment.id,
      )
    ) {
      setRowErrors([
        "This attachment already has imported records. Correct those records instead of importing it twice.",
      ]);
      return;
    }
    for (let index = header + 1; index < rows.length; index++) {
      if (rows[index].every((cell) => !String(cell ?? "").trim())) continue;
      const record: Record<string, unknown> =
        target === "sessions"
          ? {
              clinicianId: null,
              start: parent.start,
              end: parent.end,
              completed: null,
              desired: null,
              cancelled: null,
              noShow: null,
            }
          : newRecord(target as Collection, workspace, parent.start);
      record.periodId = parent.id;
      if (target === "transactions") record.attachmentId = attachment.id;
      else record.sourceAttachmentId = attachment.id;
      for (const field of importFields) {
        const column = mapping[field.key];
        if (column === undefined || column === "") continue;
        const raw = String(rows[index][Number(column)] ?? "").trim();
        if (field.type === "number") {
          const numeric = raw.replace(/[$,\s]/g, "");
          record[field.key] = raw === "" ? null : Number(numeric);
        } else if (field.type === "select") {
          const options = fieldOptions(field, workspace, context, record);
          const match = options.find(
            (o) =>
              o.label.toLowerCase() === raw.toLowerCase() || o.value === raw,
          );
          record[field.key] =
            field.source === "legacyClinicians"
              ? match
                ? Number(match.value)
                : null
              : (match?.value ?? (raw || null));
        } else if (field.type === "checkbox")
          record[field.key] = ["true", "yes", "1"].includes(raw.toLowerCase());
        else record[field.key] = raw || (field.optional ? null : "");
      }
      if (target === "sessions") delete record.periodId;
      const schema =
        target === "sessions"
          ? sessionInputSchema
          : schemas[target as Collection];
      const result = schema.safeParse(record);
      if (!result.success)
        errors.push(
          `Row ${index + 1}: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
        );
      else records.push(result.data as Record<string, unknown>);
    }
    if (target !== "sessions" && !errors.length) {
      const candidate = {
        ...workspace,
        [target]: [...workspace[target as Collection], ...records],
      };
      const result = workspaceSchema.safeParse(candidate);
      if (!result.success)
        errors.push(
          ...result.error.issues.map(
            (i) => `${i.path.join(".")}: ${i.message}`,
          ),
        );
    }
    setRowErrors(errors);
    setPrepared(records);
    if (!errors.length)
      try {
        localStorage.setItem(mappingKey, JSON.stringify(mapping));
      } catch {}
    requestIds.current = records.map(() => crypto.randomUUID());
    setSavedRows(0);
  }
  async function importRecords() {
    if (!attachment || rowErrors.length) return;
    setBusy(true);
    setError("");
    try {
      if (target === "sessions") {
        for (let i = savedRows; i < prepared.length; i++) {
          await saveSessionRecord({
            requestId: requestIds.current[i],
            expectedRevision: null,
            entry: sessionInputSchema.parse(prepared[i]),
          });
          setSavedRows(i + 1);
        }
        await cache.invalidateQueries({ queryKey: ["hub-context"] });
        await cache.invalidateQueries({ queryKey: ["session-records"] });
      } else
        await save(
          {
            ...workspace,
            [target]: [...workspace[target as Collection], ...prepared],
          },
          `Import ${prepared.length} ${target} from ${attachment.name}`,
        );
      setStatus(`${prepared.length} reviewed records imported.`);
      setAttachment(null);
      setPrepared([]);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Import failed. Already saved session rows are retained; retry continues safely.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function finalize() {
    const p = workspace.periods.find((p) => p.id === reviewPeriod);
    if (!p) return;
    setBusy(true);
    try {
      await save(
        {
          ...workspace,
          periods: workspace.periods.map((x) =>
            x.id === p.id
              ? {
                  ...x,
                  status: x.status === "draft" ? "reviewed" : "finalized",
                  finalizedAt:
                    x.status === "reviewed" ? new Date().toISOString() : null,
                }
              : x,
          ),
        },
        `${p.status === "draft" ? "Reviewed" : "Finalized"} period: ${p.name}`,
      );
      setReviewPeriod(null);
      setStatus("Reporting state saved.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not finalize this period.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ["periods", "Reporting periods"],
          ["documents", "Documents & imports"],
          ["history", "Audit history"],
          ["reports", "Reports & recovery"],
        ]}
      />
      {status && (
        <p className="pr-success" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="pr-error hub-error" role="alert">
          {error}
        </p>
      )}
      {tab === "reports" ? (
        <Reports {...props} />
      ) : tab === "periods" ? (
        <>
          {table("periods")}
          <section className="hub-period-review">
            <h2>Review queue</h2>
            {workspace.periods
              .filter((p) => !p.archived && p.status !== "finalized")
              .map((p) => (
                <div key={p.id} className="hub-section-heading">
                  <div>
                    <strong>{p.name}</strong>
                    <p className="hub-muted">
                      {p.start} to {p.end} / {p.status}
                    </p>
                  </div>
                  <button
                    className="pr-button"
                    onClick={() => setReviewPeriod(p.id)}
                  >
                    <Check />
                    {p.status === "draft" ? "Review period" : "Finalize period"}
                  </button>
                </div>
              ))}
          </section>
        </>
      ) : tab === "documents" ? (
        <>
          <div className="hub-section-heading">
            <h2>Source documents</h2>
            <div className="hub-actions">
              <select
                aria-label="Attachment reporting period"
                value={period?.id ?? ""}
                onChange={(e) => setPeriodId(e.target.value)}
              >
                <option value="" disabled>
                  Select period
                </option>
                {workspace.periods
                  .filter((p) => !p.archived && p.status !== "finalized")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <input
                ref={input}
                type="file"
                accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg,.webp"
                aria-label="Upload source document"
                className="hub-file"
                onChange={(e) => {
                  if (e.target.files?.[0]) void upload(e.target.files[0]);
                }}
              />
              <button
                className="pr-button pr-primary"
                disabled={!period || busy}
                onClick={() => input.current?.click()}
              >
                <Upload />
                {busy ? "Working..." : "Upload document"}
              </button>
              <select
                aria-label="Template type"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="transactions">Expense template</option>
                <option value="budgets">Budget template</option>
                <option value="funnels">Lead-generation template</option>
                <option value="sessions">Session template</option>
              </select>
              <button
                className="pr-icon"
                aria-label="Download import template"
                title="Download import template"
                onClick={() =>
                  void exportCsv([
                    Object.fromEntries(importFields.map((f) => [f.key, ""])),
                  ]).catch((e) => setError(e.message))
                }
              >
                <Download />
              </button>
            </div>
          </div>
          <div className="pr-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Period</th>
                  <th>Size</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {attachments.data?.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <a href={`/api/hub/attachments/${file.id}`} download>
                        {file.name}
                      </a>
                    </td>
                    <td>
                      {
                        workspace.periods.find((p) => p.id === file.periodId)
                          ?.name
                      }
                    </td>
                    <td>{fmt(file.size / 1024)} KB</td>
                    <td>
                      <button
                        className="pr-button"
                        onClick={() => void openFile(file)}
                      >
                        <FileText />
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="hub-section-heading">
            <h2>Saved workspace revisions</h2>
            <a className="pr-button" href="/api/hub/export" download>
              <Download />
              Hub JSON backup
            </a>
          </div>
          <div className="pr-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Revision</th>
                  <th>Action</th>
                  <th>By</th>
                  <th>When</th>
                  <th>Snapshot</th>
                </tr>
              </thead>
              <tbody>
                {history.data?.map((h) => (
                  <tr key={h.revision}>
                    <td>{h.revision}</td>
                    <td>{h.action}</td>
                    <td>{h.actor}</td>
                    <td>{new Date(h.createdAt).toLocaleString()}</td>
                    <td>
                      <a
                        href={`/api/hub/history/${h.revision}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View snapshot
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {reviewPeriod && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setReviewPeriod(null);
          }}
        >
          <DialogContent
            className="practice-theme practice-dialog"
            data-appearance={theme}
          >
            <DialogHeader>
              <DialogTitle>Confirm reporting period</DialogTitle>
              <DialogDescription>
                {workspace.periods.find((p) => p.id === reviewPeriod)?.name}
              </DialogDescription>
            </DialogHeader>
            <p>
              {workspace.periods.find((p) => p.id === reviewPeriod)?.status ===
              "draft"
                ? "Mark these entered figures as reviewed?"
                : "Finalized figures will appear as actuals. Later corrections require a reason and retain revision history."}
            </p>
            {error && (
              <p className="pr-error" role="alert">
                {error}
              </p>
            )}
            <div className="pr-dialog-actions">
              <button
                className="pr-button"
                onClick={() => setReviewPeriod(null)}
              >
                Cancel
              </button>
              <button
                className="pr-button pr-primary"
                disabled={busy}
                onClick={() => void finalize()}
              >
                <Check />
                Confirm
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {attachment && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setAttachment(null);
          }}
        >
          <DialogContent
            className="practice-theme practice-dialog hub-import"
            data-appearance={theme}
            onPointerDownOutside={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>Review source document</DialogTitle>
              <DialogDescription>{attachment.name}</DialogDescription>
            </DialogHeader>
            {busy && !preview ? (
              <p>Reading document...</p>
            ) : preview?.manual ? (
              <>
                <p>
                  Reference attachment. Structured figures remain manual until
                  reviewed.
                </p>
                <a
                  className="pr-button"
                  href={`/api/hub/attachments/${attachment.id}`}
                  download
                >
                  <Download />
                  Open original
                </a>
              </>
            ) : (
              <>
                <div className="hub-form-grid">
                  <label className="pr-field">
                    Worksheet
                    <select
                      value={sheet}
                      disabled={savedRows > 0}
                      onChange={(e) => {
                        setSheet(Number(e.target.value));
                        setPrepared([]);
                        setMapping({});
                      }}
                    >
                      {preview?.sheets.map((s, i) => (
                        <option key={i} value={i}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="pr-field">
                    Header row
                    <input
                      type="number"
                      min="1"
                      max={Math.max(1, rows.length)}
                      value={header + 1}
                      disabled={savedRows > 0}
                      onChange={(e) => {
                        setHeader(Number(e.target.value) - 1);
                        setPrepared([]);
                      }}
                    />
                  </label>
                  <label className="pr-field">
                    Import into
                    <select
                      value={target}
                      disabled={savedRows > 0}
                      onChange={(e) => {
                        setTarget(e.target.value);
                        setPrepared([]);
                        setMapping({});
                      }}
                    >
                      <option value="transactions">Actual expense lines</option>
                      <option value="budgets">Budget lines</option>
                      <option value="funnels">Lead-generation figures</option>
                      <option value="sessions">Session totals</option>
                    </select>
                  </label>
                </div>
                <details className="hub-details" open={!prepared.length}>
                  <summary>Column mapping</summary>
                  <div className="hub-form-grid">
                    {importFields.map((field) => (
                      <label className="pr-field" key={field.key}>
                        {field.label}
                        <select
                          value={mapping[field.key] ?? ""}
                          disabled={savedRows > 0}
                          onChange={(e) => {
                            setMapping({
                              ...mapping,
                              [field.key]: e.target.value,
                            });
                            setPrepared([]);
                          }}
                        >
                          <option value="">Default / not mapped</option>
                          {headers.map((head, i) => (
                            <option key={i} value={i}>
                              {head || `Column ${i + 1}`}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </details>
                <div className="pr-table-wrap hub-preview-table">
                  <table>
                    <thead>
                      <tr>
                        {headers.map((head, i) => (
                          <th key={i}>{head || `Column ${i + 1}`}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(header + 1, header + 7).map((row, i) => (
                        <tr key={i}>
                          {headers.map((_, j) => (
                            <td key={j}>{row[j]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rowErrors.length > 0 && (
                  <p className="pr-error hub-error" role="alert">
                    {rowErrors.slice(0, 20).join("\n")}
                  </p>
                )}
                {prepared.length > 0 && !rowErrors.length && (
                  <div className="pr-table-wrap hub-preview-table">
                    <table>
                      <caption>Values to import</caption>
                      <thead>
                        <tr>
                          {importFields.map((f) => (
                            <th key={f.key}>{f.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {prepared.slice(0, 20).map((record, i) => (
                          <tr key={i}>
                            {importFields.map((f) => (
                              <td key={f.key}>
                                {fieldOptions(
                                  f,
                                  workspace,
                                  context,
                                  record,
                                ).find((o) => o.value === String(record[f.key]))
                                  ?.label ??
                                  String(record[f.key] ?? "Not entered")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {prepared.length > 0 && !rowErrors.length && (
                  <p className="pr-success">
                    {prepared.length} valid records ready for review
                    confirmation.{" "}
                    {savedRows ? `${savedRows} session rows saved.` : ""}
                  </p>
                )}
                {error && (
                  <p className="pr-error hub-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="pr-dialog-actions">
                  <button
                    className="pr-button"
                    disabled={busy || savedRows > 0}
                    onClick={prepare}
                  >
                    <Check />
                    Validate mapped rows
                  </button>
                  <button
                    className="pr-button pr-primary"
                    disabled={busy || !prepared.length || !!rowErrors.length}
                    onClick={() => void importRecords()}
                  >
                    <Save />
                    {busy
                      ? "Importing..."
                      : savedRows
                        ? "Continue import"
                        : "Confirm import"}
                  </button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
