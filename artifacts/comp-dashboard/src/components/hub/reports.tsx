import { useState } from "react";
import { Download, Upload, FileDown, ShieldCheck } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { managementReport, type ReportSection } from "@/lib/management-report";
import type { ViewProps } from "./views";

type BackupPreview = {
  token: string | null;
  counts: Record<string, number>;
  existing: Record<string, number>;
  canRestore: boolean;
  digest: string;
  exportedAt: string;
};
export default function Reports(props: ViewProps) {
  const [sections, setSections] = useState<ReportSection[]>([
      "position",
      "categories",
      "forecast",
      "decisions",
    ]),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<BackupPreview | null>(null),
    [confirmation, setConfirmation] = useState("");
  return (
    <>
      <section>
        <h2>Management report</h2>
        <div className="hub-checks">
          {(
            [
              ["position", "Recorded position"],
              ["categories", "Category breakdown"],
              ["forecast", "Active forecast"],
              ["decisions", "Decision signals"],
            ] as const
          ).map(([key, name]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={sections.includes(key)}
                onChange={(e) =>
                  setSections(
                    e.target.checked
                      ? [...sections, key]
                      : sections.filter((s) => s !== key),
                  )
                }
              />
              {name}
            </label>
          ))}
        </div>
        <p className="hub-muted">
          Actuals: {props.range.start} to {props.range.end}. Forecast:{" "}
          {props.months.length} months.
        </p>
        <button
          className="pr-button"
          disabled={pending || !sections.length}
          onClick={() => {
            setPending(true);
            setError("");
            void managementReport(
              props.workspace,
              props.context,
              props.months,
              props.range,
              sections,
            )
              .then((doc) => doc.save("emc-management-report.pdf"))
              .catch((e) => setError(e.message))
              .finally(() => setPending(false));
          }}
        >
          <FileDown />
          Download PDF
        </button>
      </section>
      <section className="hub-details">
        <h2>Backup and recovery</h2>
        <p className="hub-muted">
          Includes compensation, scenarios, sessions, hub records, documents and
          audit history. Passwords, accounts and login sessions are excluded.
          Keep the file private. Restore is allowed only into an empty app with
          a matching database schema.
        </p>
        <div className="hub-actions">
          <a className="pr-button" href="/api/hub/backup" download>
            <Download />
            Business-data backup
          </a>
          <label className="pr-button hub-upload">
            <Upload />
            Review backup
            <input
              type="file"
              accept="application/json,.json"
              disabled={pending}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setPreview(null);
                setConfirmation("");
                setError("");
                if (file.size > 14 * 1024 * 1024) {
                  setError(
                    "In-app recovery accepts backups up to 14 MB. Use the documented PostgreSQL restore for larger backups.",
                  );
                  return;
                }
                setPending(true);
                try {
                  const data = JSON.parse(await file.text());
                  setPreview(
                    await customFetch<BackupPreview>(
                      "/api/hub/backup/preview",
                      { method: "POST", body: JSON.stringify(data) },
                    ),
                  );
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Backup could not be read.",
                  );
                } finally {
                  setPending(false);
                }
              }}
            />
          </label>
        </div>
        {preview && (
          <>
            <h3>Backup from {preview.exportedAt}</h3>
            <div className="pr-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Records</th>
                    <th>In backup</th>
                    <th>In this app</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(preview.counts).map(([table, count]) => (
                    <tr key={table}>
                      <td>{table.replaceAll("_", " ")}</td>
                      <td>{count}</td>
                      <td>{preview.existing[table]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.canRestore ? (
              <>
                <label className="pr-field">
                  Type RESTORE EMPTY APP to confirm
                  <input
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
                <button
                  className="pr-button"
                  disabled={pending || confirmation !== "RESTORE EMPTY APP"}
                  onClick={async () => {
                    setPending(true);
                    setError("");
                    try {
                      await customFetch("/api/hub/backup/restore", {
                        method: "POST",
                        body: JSON.stringify({
                          token: preview.token,
                          digest: preview.digest,
                          confirmation,
                        }),
                      });
                      location.reload();
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "Restore failed.",
                      );
                      setPending(false);
                    }
                  }}
                >
                  <ShieldCheck />
                  Restore reviewed backup
                </button>
              </>
            ) : (
              <p role="status">
                This app already contains data. Nothing will be overwritten.
              </p>
            )}
          </>
        )}
      </section>
      {error && (
        <p className="pr-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
