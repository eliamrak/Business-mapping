import { useState } from "react";
import { Plus, Pencil, Archive, Columns3, Search, Copy } from "lucide-react";
import type { Collection, Workspace, Context } from "@workspace/practice/hub";
import { fields, fieldOptions, labels } from "./config";
export default function RecordTable({
  collection,
  workspace,
  context,
  onEdit,
  onNew,
  onArchive,
  onCopy,
  extra,
  range,
}: {
  collection: Collection;
  workspace: Workspace;
  context: Context;
  onEdit: (record: Record<string, unknown>) => void;
  onNew: () => void;
  onArchive: (id: string) => void;
  onCopy?: (record: Record<string, unknown>) => void;
  extra?: React.ReactNode;
  range?: { start: string; end: string };
}) {
  const [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false);
  const key = `emc.hub.columns.${collection}`;
  const available = fields[collection].filter(
    (f) => f.type !== "textarea" && f.key !== "correctionReason",
  );
  const [columns, setColumns] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (Array.isArray(saved))
        return [
          ...new Set([
            available[0]?.key,
            ...saved.filter((k) => available.some((f) => f.key === k)),
          ]),
        ];
    } catch {}
    return available.slice(0, 5).map((f) => f.key);
  });
  const rows = (
    workspace[collection] as unknown as Record<string, unknown>[]
  ).filter(
    (r) =>
      (archived || !r.archived) &&
      (!range ||
        !["transactions", "funnels", "periods"].includes(collection) ||
        (collection === "transactions"
          ? String(r.date) >= range.start && String(r.date) <= range.end
          : collection === "periods"
            ? String(r.start) <= range.end && String(r.end) >= range.start
            : workspace.periods.some(
                (p) =>
                  p.id === r.periodId &&
                  p.start <= range.end &&
                  p.end >= range.start,
              ))) &&
      JSON.stringify(r).toLowerCase().includes(search.toLowerCase()),
  );
  function cell(
    record: Record<string, unknown>,
    field: (typeof available)[number],
  ) {
    const value = record[field.key];
    if (value === null || value === undefined || value === "") return "--";
    if (field.type === "checkbox") return value ? "Yes" : "No";
    if (field.type === "select")
      return (
        fieldOptions(field, workspace, context, record).find(
          (o) => o.value === String(value),
        )?.label ?? String(value)
      );
    if (typeof value === "number")
      return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
    return String(value);
  }
  return (
    <section className="hub-records">
      <div className="hub-section-heading">
        <h2>
          {labels[collection]} <small>{rows.length}</small>
        </h2>
        <div className="hub-actions">
          {extra}
          <details className="pr-picker pr-columns">
            <summary>
              <Columns3 />
              <span>Columns</span>
            </summary>
            <div className="pr-column-menu">
              {available.map((f) => (
                <label key={f.key}>
                  <input
                    type="checkbox"
                    checked={columns.includes(f.key)}
                    disabled={f.key === available[0]?.key}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...columns, f.key]
                        : columns.filter((k) => k !== f.key);
                      setColumns(next);
                      try {
                        localStorage.setItem(key, JSON.stringify(next));
                      } catch {}
                    }}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </details>
          <button className="pr-button pr-primary" onClick={onNew}>
            <Plus />
            Add
          </button>
        </div>
      </div>
      <div className="hub-list-tools">
        <label className="pr-search">
          <Search />
          <input
            aria-label={`Search ${labels[collection]}`}
            value={search}
            placeholder="Search records"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="hub-checkbox">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Include archived
        </label>
      </div>
      {rows.length ? (
        <div className="pr-table-wrap">
          <table>
            <thead>
              <tr>
                {available
                  .filter((f) => columns.includes(f.key))
                  .map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)}>
                  {available
                    .filter((f) => columns.includes(f.key))
                    .map((f, i) => (
                      <td key={f.key}>
                        {i === 0 ? (
                          <button
                            className="pr-table-name"
                            onClick={() => onEdit(r)}
                          >
                            {cell(r, f)}
                          </button>
                        ) : (
                          cell(r, f)
                        )}
                      </td>
                    ))}
                  <td>
                    {r.archived
                      ? "Archived"
                      : typeof r.status === "string"
                        ? r.status
                        : r.planningOnly
                          ? "Planning template"
                          : "Active"}
                  </td>
                  <td>
                    <div className="pr-row-actions">
                      <button
                        className="pr-icon"
                        title="Edit record"
                        aria-label={`Edit ${r.name ?? r.description ?? "record"}`}
                        onClick={() => onEdit(r)}
                      >
                        <Pencil />
                      </button>
                      {onCopy && (
                        <button
                          className="pr-icon"
                          title="Duplicate record"
                          aria-label="Duplicate record"
                          onClick={() => onCopy(r)}
                        >
                          <Copy />
                        </button>
                      )}
                      {"archived" in r && (
                        <button
                          className="pr-icon"
                          disabled={
                            collection === "periods" && r.status === "finalized"
                          }
                          title={
                            collection === "periods" && r.status === "finalized"
                              ? "Finalized periods are retained in the audit history"
                              : r.archived
                                ? "Restore record"
                                : "Archive record"
                          }
                          aria-label={
                            r.archived ? "Restore record" : "Archive record"
                          }
                          onClick={() => onArchive(String(r.id))}
                        >
                          <Archive />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="pr-empty pr-empty-period">
          <h3>{search ? "No matching records" : "No records yet"}</h3>
          <button className="pr-button" onClick={onNew}>
            <Plus />
            Add {labels[collection].toLowerCase()}
          </button>
        </div>
      )}
    </section>
  );
}
