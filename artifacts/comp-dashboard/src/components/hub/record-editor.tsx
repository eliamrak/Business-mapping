import { useEffect, useState } from "react";
import { Save, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  type Workspace,
  type Collection,
  type Context,
  type Condition,
  type Rule,
} from "@workspace/practice/hub";
import { fields, schemas, fieldOptions, type Field, labels } from "./config";
import RuleEditor from "./rule-editor";

export function InputField({
  field,
  value,
  onChange,
  workspace,
  context,
  record,
}: {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  workspace: Workspace;
  context: Context;
  record: Record<string, unknown>;
}) {
  const options = fieldOptions(field, workspace, context, record);
  if (field.type === "checkbox")
    return (
      <label className="hub-checkbox">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        {field.label}
      </label>
    );
  return (
    <label
      className={`pr-field ${field.type === "textarea" ? "hub-span" : ""}`}
    >
      {field.label}
      {field.optional && <small>Optional</small>}
      {field.type === "select" ? (
        <select
          value={value == null ? "" : String(value)}
          onChange={(e) =>
            onChange(
              field.source === "legacyClinicians"
                ? e.target.value
                  ? Number(e.target.value)
                  : null
                : e.target.value ||
                    (field.key === "right" ? "" : field.optional ? null : ""),
            )
          }
        >
          {(field.optional || !value) && (
            <option value="">{field.optional ? "Not set" : "Select..."}</option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea
          rows={3}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type={field.type ?? "text"}
          required={!field.optional}
          value={value == null ? "" : String(value)}
          min={field.min}
          max={field.max}
          step={field.step ?? "any"}
          onChange={(e) =>
            onChange(
              field.type === "number"
                ? e.target.value === ""
                  ? null
                  : Number(e.target.value)
                : field.type === "date" && field.optional && !e.target.value
                  ? null
                  : e.target.value,
            )
          }
        />
      )}
    </label>
  );
}

export default function RecordEditor({
  collection,
  record,
  workspace,
  context,
  theme,
  onClose,
  onSave,
}: {
  collection: Collection;
  record: Record<string, unknown>;
  workspace: Workspace;
  context: Context;
  theme: string;
  onClose: () => void;
  onSave: (
    value: Record<string, unknown>,
    corrections?: Record<string, string>,
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState(record),
    [tags, setTags] = useState(((record.tags ?? []) as string[]).join(", ")),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [discard, setDiscard] = useState(false),
    [corrections, setCorrections] = useState<Record<string, string>>({});
  const finalized = workspace.periods.filter(
    (p) =>
      p.status === "finalized" &&
      (collection === "periods"
        ? p.id === record.id
        : ["transactions", "funnels"].includes(collection) &&
          [record.periodId, draft.periodId].includes(p.id)),
  );
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(record) ||
    Object.values(corrections).some(Boolean);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);
  const close = () => {
    if (!saving) {
      if (dirty) setDiscard(true);
      else onClose();
    }
  };
  const change = (key: string, value: unknown) =>
    setDraft((prev) => ({ ...prev, [key]: value }));
  let shown = fields[collection].filter((f) => f.key !== "correctionReason");
  if (collection === "campaigns") {
    const method = String(draft.method);
    const only: Record<string, string[]> = {
      cpl: ["cpl"],
      cac: ["cac"],
      clicks: ["cpm", "ctrPct", "clickToLeadPct"],
      historical: ["historicalStart", "historicalEnd"],
      manual: ["manualLeads", "manualClients"],
      custom: ["customKpiId"],
    };
    const conditional = Object.values(only).flat();
    shown = shown
      .filter(
        (f) =>
          !conditional.includes(f.key) ||
          only[method]?.includes(f.key) ||
          (draft.economicsSource === "historical" &&
            ["historicalStart", "historicalEnd"].includes(f.key)),
      )
      .map((f) =>
        conditional.includes(f.key) ? { ...f, advanced: false } : f,
      );
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const parsed = schemas[collection].safeParse(draft);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("\n"),
      );
      return;
    }
    setSaving(true);
    try {
      for (const period of finalized) {
        if (
          (corrections[period.id]?.trim().length ?? 0) < 8 ||
          corrections[period.id]?.trim() === period.correctionReason
        )
          throw new Error(
            `Enter a new correction reason for ${period.name} (at least 8 characters).`,
          );
      }
      await onSave(parsed.data as Record<string, unknown>, corrections);
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Your entry is still here.",
      );
    } finally {
      setSaving(false);
    }
  }
  const render = (field: Field) => (
    <InputField
      key={field.key}
      field={field}
      value={draft[field.key]}
      record={draft}
      workspace={workspace}
      context={context}
      onChange={(value) => change(field.key, value)}
    />
  );
  const blocks = (draft.blocks ?? []) as {
    day: number;
    startHour: number;
    endHour: number;
  }[];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="practice-theme practice-dialog hub-editor"
        data-appearance={theme}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <DialogHeader>
          <DialogTitle>{labels[collection]}</DialogTitle>
          <DialogDescription>
            {workspace[collection].some((x) => x.id === record.id)
              ? "Edit saved record"
              : "New record"}
          </DialogDescription>
        </DialogHeader>
        {discard ? (
          <div>
            <h3>Discard unsaved changes?</h3>
            <div className="pr-dialog-actions">
              <button className="pr-button" onClick={() => setDiscard(false)}>
                Keep editing
              </button>
              <button className="pr-button" onClick={onClose}>
                Discard changes
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={save}>
            {finalized.map((p) => (
              <label className="pr-field" key={p.id}>
                Correction reason: {p.name}
                <textarea
                  required
                  minLength={8}
                  value={corrections[p.id] ?? ""}
                  onChange={(e) =>
                    setCorrections({ ...corrections, [p.id]: e.target.value })
                  }
                />
              </label>
            ))}
            <div className="hub-form-grid">
              {shown.filter((f) => !f.advanced).map(render)}
            </div>
            {["budgets", "rooms", "campaigns"].includes(collection) && (
              <label className="hub-checkbox">
                <input
                  type="checkbox"
                  checked={!!draft.planningOnly}
                  onChange={(e) => change("planningOnly", e.target.checked)}
                />
                Planning template / excluded from the active plan until
                scheduled
              </label>
            )}
            {collection === "categories" && (
              <label className="pr-field">
                Tags
                <input
                  value={tags}
                  onChange={(e) => {
                    setTags(e.target.value);
                    change(
                      "tags",
                      e.target.value
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    );
                  }}
                />
              </label>
            )}
            {shown.some((f) => f.advanced) && (
              <details className="hub-details">
                <summary>Additional settings</summary>
                <div className="hub-form-grid">
                  {shown.filter((f) => f.advanced).map(render)}
                </div>
              </details>
            )}
            {collection === "rules" && (
              <>
                <RuleEditor
                  value={draft.condition as Condition}
                  onChange={(v) => change("condition", v)}
                  workspace={workspace}
                  clinicians={context.clinicians.filter((c) =>
                    workspace.settings.teamId === null
                      ? c.goalId == null
                      : c.goalId === workspace.settings.teamId,
                  )}
                />
                <fieldset className="hub-details">
                  <legend>Additional responses</legend>
                  {((draft.responses ?? []) as Rule["responses"]).map(
                    (response, index, responses) => {
                      const update = (patch: Partial<typeof response>) =>
                        change(
                          "responses",
                          responses.map((r, i) =>
                            i === index ? { ...r, ...patch } : r,
                          ),
                        );
                      return (
                        <div
                          className="hub-form-grid hub-condition"
                          key={response.id}
                        >
                          <label className="pr-field">
                            Response name
                            <input
                              required
                              value={response.name}
                              onChange={(e) => update({ name: e.target.value })}
                            />
                          </label>
                          <label className="pr-field">
                            Event template
                            <select
                              value={response.eventId ?? ""}
                              onChange={(e) =>
                                update({ eventId: e.target.value || null })
                              }
                            >
                              <option value="">Decision / reminder only</option>
                              {workspace.events.map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.name}
                                  {e.enabled ? "" : " (inactive template)"}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="pr-field">
                            Months relative to action date
                            <input
                              type="number"
                              min="-36"
                              max="36"
                              value={response.offsetMonths}
                              onChange={(e) =>
                                update({ offsetMonths: Number(e.target.value) })
                              }
                            />
                          </label>
                          <button
                            type="button"
                            className="pr-icon"
                            title="Remove response"
                            aria-label="Remove response"
                            onClick={() =>
                              change(
                                "responses",
                                responses.filter((r) => r.id !== response.id),
                              )
                            }
                          >
                            <Trash2 />
                          </button>
                        </div>
                      );
                    },
                  )}
                  <button
                    type="button"
                    className="pr-button"
                    onClick={() =>
                      change("responses", [
                        ...((draft.responses ?? []) as Rule["responses"]),
                        {
                          id: crypto.randomUUID(),
                          name: "",
                          eventId: null,
                          offsetMonths: 0,
                        },
                      ])
                    }
                  >
                    <Plus />
                    Response
                  </button>
                </fieldset>
              </>
            )}
            {collection === "kpis" && (
              <details className="hub-details">
                <summary>Dated formula versions</summary>
                {(
                  (draft.versions ??
                    []) as Workspace["kpis"][number]["versions"]
                ).map((version, index, versions) => (
                  <fieldset className="hub-condition" key={index}>
                    <legend>Version {index + 1}</legend>
                    <div className="hub-form-grid">
                      {[
                        {
                          key: "effectiveDate",
                          label: "Effective date",
                          type: "date",
                        } as Field,
                        ...fields.kpis.filter((f) =>
                          ["left", "operation", "right", "constant"].includes(
                            f.key,
                          ),
                        ),
                      ].map((field) => (
                        <InputField
                          key={field.key}
                          field={field}
                          value={version[field.key as keyof typeof version]}
                          record={version}
                          workspace={workspace}
                          context={context}
                          onChange={(value) =>
                            change(
                              "versions",
                              versions.map((v, i) =>
                                i === index ? { ...v, [field.key]: value } : v,
                              ),
                            )
                          }
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="pr-icon"
                      title="Remove formula version"
                      aria-label="Remove formula version"
                      onClick={() =>
                        change(
                          "versions",
                          versions.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <Trash2 />
                    </button>
                  </fieldset>
                ))}
                <button
                  type="button"
                  className="pr-button"
                  onClick={() =>
                    change("versions", [
                      ...((draft.versions ?? []) as unknown[]),
                      {
                        effectiveDate: workspace.settings.forecastStart,
                        left: draft.left,
                        operation: draft.operation,
                        right: draft.right,
                        constant: draft.constant,
                      },
                    ])
                  }
                >
                  <Plus />
                  Formula version
                </button>
              </details>
            )}
            {collection === "events" && (
              <fieldset className="hub-details">
                <legend>Dependencies</legend>
                <div className="hub-checks">
                  {workspace.events
                    .filter((x) => x.id !== draft.id)
                    .map((e) => (
                      <label key={e.id}>
                        <input
                          type="checkbox"
                          checked={(
                            (draft.dependsOn as string[]) ?? []
                          ).includes(e.id)}
                          onChange={(event) =>
                            change(
                              "dependsOn",
                              event.target.checked
                                ? [
                                    ...((draft.dependsOn as string[]) ?? []),
                                    e.id,
                                  ]
                                : ((draft.dependsOn as string[]) ?? []).filter(
                                    (id) => id !== e.id,
                                  ),
                            )
                          }
                        />
                        {e.name}
                      </label>
                    ))}
                </div>
              </fieldset>
            )}
            {collection === "rooms" && (
              <details className="hub-details">
                <summary>Weekly availability blocks</summary>
                {blocks.map((b, i) => (
                  <div className="hub-block-row" key={i}>
                    <label className="pr-field">
                      Day
                      <select
                        value={b.day}
                        onChange={(e) =>
                          change(
                            "blocks",
                            blocks.map((x, j) =>
                              i === j
                                ? { ...x, day: Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                      >
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                          (day, j) => (
                            <option key={j} value={j}>
                              {day}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label className="pr-field">
                      From (hour)
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.25"
                        value={b.startHour}
                        onChange={(e) =>
                          change(
                            "blocks",
                            blocks.map((x, j) =>
                              i === j
                                ? { ...x, startHour: Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="pr-field">
                      To (hour)
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.25"
                        value={b.endHour}
                        onChange={(e) =>
                          change(
                            "blocks",
                            blocks.map((x, j) =>
                              i === j
                                ? { ...x, endHour: Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="pr-icon"
                      title="Remove availability"
                      onClick={() =>
                        change(
                          "blocks",
                          blocks.filter((_, j) => i !== j),
                        )
                      }
                    >
                      <Trash2 />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="pr-button"
                  onClick={() =>
                    change("blocks", [
                      ...blocks,
                      { day: 1, startHour: 9, endHour: 17 },
                    ])
                  }
                >
                  <Plus />
                  Availability block
                </button>
              </details>
            )}
            {error && (
              <p className="pr-error hub-error" role="alert">
                {error}
              </p>
            )}
            <div className="pr-dialog-actions">
              <span className="pr-save-state">
                {dirty ? "Unsaved changes" : "Saved values"}
              </span>
              <button
                type="submit"
                className="pr-button pr-primary"
                disabled={saving}
              >
                <Save />
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
