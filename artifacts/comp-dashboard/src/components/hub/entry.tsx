import { useRef, useState } from "react";
import { useClerk } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, LogOut, RotateCcw } from "lucide-react";
import { customFetch, ApiError } from "@workspace/api-client-react";
import { funnelSchema, type Workspace } from "@workspace/practice/hub";
import { sessionInputSchema, type SessionWrite } from "@workspace/practice";
import { listSessionRecords, saveSessionRecord } from "@/lib/session-api";
import { useUnsaved } from "./use-unsaved";
import "@/pages/hub.css";
type EntryContext = {
  revision: number;
  teamId: number | null;
  clinicians: { id: number; label: string }[];
  periods: { id: string; name: string; start: string; end: string }[];
  campaigns: { id: string; name: string }[];
  funnels: Workspace["funnels"];
};
export default function Entry() {
  const cache = useQueryClient();
  const { signOut } = useClerk();
  const query = useQuery({
    queryKey: ["hub-entry"],
    queryFn: () => customFetch<EntryContext>("/api/hub/entry"),
  });
  const [mode, setMode] = useState("sessions"),
    [period, setPeriod] = useState(""),
    [target, setTarget] = useState(""),
    [draft, setDraft] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef<{
    payload: string;
    id: string;
    revision: number | null;
  } | null>(null);
  const draftId = useRef(crypto.randomUUID());
  const dirty = Object.keys(draft).length > 0;
  useUnsaved(dirty);
  const mayDiscard = () =>
    !dirty || window.confirm("Discard unsaved entry changes?");
  const sessions = useQuery({
    queryKey: ["entry-sessions", query.data?.teamId],
    queryFn: () =>
      listSessionRecords(query.data?.teamId?.toString() ?? "unassigned"),
    enabled: !!query.data,
  });
  const selected = query.data?.periods.find((p) => p.id === period),
    saved =
      mode === "sessions"
        ? sessions.data?.find(
            (s) =>
              s.clinicianId === Number(target) &&
              s.start === selected?.start &&
              s.end === selected?.end,
          )
        : query.data?.funnels.find(
            (f) => f.campaignId === target && f.periodId === period,
          );
  const fields =
    mode === "sessions"
      ? [
          ["completed", "Completed sessions"],
          ["desired", "Desired sessions"],
          ["cancelled", "Cancelled"],
          ["noShow", "No-shows"],
          ["scheduled", "Scheduled sessions"],
          ["inPerson", "In-person sessions"],
          ["telehealth", "Telehealth sessions"],
        ]
      : [
          ["spend", "Advertising spend ($)"],
          ["leads", "Leads"],
          ["scheduled", "Consultations scheduled"],
          ["attended", "Consultations attended"],
          ["clients", "New clients"],
          ["firstSessions", "First sessions"],
        ];
  const value = (key: string) =>
    draft[key] ??
    String((saved as unknown as Record<string, unknown>)?.[key] ?? "");
  const clear = () => {
    setDraft({});
    setMessage("");
    setError("");
    pending.current = null;
    draftId.current = crypto.randomUUID();
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !target || !query.data) return;
    setBusy(true);
    setError("");
    try {
      const values = Object.fromEntries(
        fields.map(([key]) => [
          key,
          value(key) === "" ? null : Number(value(key)),
        ]),
      );
      const entry =
        mode === "sessions"
          ? sessionInputSchema.parse({
              clinicianId: Number(target),
              start: selected.start,
              end: selected.end,
              ...values,
            })
          : funnelSchema.parse({
              ...saved,
              id: saved?.id ?? draftId.current,
              campaignId: target,
              periodId: period,
              attributedRevenue: null,
              ...values,
            });
      const payload = JSON.stringify(entry);
      if (pending.current && pending.current.payload !== payload)
        throw new Error(
          "Retry the previous save or refresh before changing the entry.",
        );
      pending.current ??= {
        payload,
        id: crypto.randomUUID(),
        revision:
          mode === "sessions"
            ? saved && "revision" in saved
              ? saved.revision
              : null
            : query.data.revision,
      };
      if (mode === "sessions")
        await saveSessionRecord({
          requestId: pending.current.id,
          expectedRevision: pending.current.revision,
          entry,
        } as SessionWrite);
      else
        await customFetch("/api/hub/entry/funnel", {
          method: "POST",
          body: JSON.stringify({
            requestId: pending.current.id,
            expectedRevision: pending.current.revision,
            entry,
          }),
        });
      pending.current = null;
      await query.refetch();
      await sessions.refetch();
      setDraft({});
      setMessage("Entry saved.");
    } catch (e) {
      if (e instanceof ApiError && [400, 403, 409].includes(e.status))
        pending.current = null;
      setError(
        e instanceof ApiError &&
          e.data &&
          typeof e.data === "object" &&
          "error" in e.data
          ? String(e.data.error)
          : e instanceof Error
            ? e.message
            : "Save not confirmed. Retry the same entry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="practice-theme" data-appearance="light">
      <div className="hub-content" style={{ maxWidth: 900, margin: "auto" }}>
        <div className="hub-section-heading">
          <h1>Practice updates</h1>
          <button
            className="pr-button"
            onClick={async () => {
              if (!mayDiscard()) return;
              cache.clear();
              await signOut({ redirectUrl: import.meta.env.BASE_URL || "/" });
            }}
          >
            <LogOut />
            Sign out
          </button>
        </div>
        <div className="hub-tabs" role="tablist" aria-label="Entry type">
          {["sessions", "leads"].map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                if (!mayDiscard()) return;
                clear();
                setMode(m);
                setTarget("");
              }}
            >
              {m === "sessions" ? "Sessions" : "Lead generation"}
            </button>
          ))}
        </div>
        {query.isError ? (
          <p role="alert">Could not load reporting periods.</p>
        ) : query.isPending ? (
          <p>Loading...</p>
        ) : !query.data.periods.length ? (
          <p>No open reporting periods.</p>
        ) : (
          <form onSubmit={submit}>
            <div className="hub-form-grid">
              <label className="pr-field">
                Reporting period
                <select
                  required
                  value={period}
                  onChange={(e) => {
                    if (!mayDiscard()) return;
                    clear();
                    setPeriod(e.target.value);
                  }}
                >
                  <option value="">Select...</option>
                  {query.data.periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} / {p.start} to {p.end}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pr-field">
                {mode === "sessions" ? "Clinician" : "Campaign"}
                <select
                  required
                  value={target}
                  onChange={(e) => {
                    if (!mayDiscard()) return;
                    clear();
                    setTarget(e.target.value);
                  }}
                >
                  <option value="">Select...</option>
                  {(mode === "sessions"
                    ? query.data.clinicians.map((c) => ({
                        id: String(c.id),
                        name: c.label,
                      }))
                    : query.data.campaigns
                  ).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {fields.map(([key, label]) => (
                <label className="pr-field" key={key}>
                  {label}
                  <input
                    type="number"
                    min="0"
                    step={key === "spend" ? "0.01" : "1"}
                    required={
                      mode === "sessions" &&
                      ["completed", "desired"].includes(key)
                    }
                    value={value(key)}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <p className="hub-muted">
              {saved
                ? "Saved entry / changes create a new revision"
                : "New entry"}
            </p>
            {error && (
              <p role="alert" className="pr-error">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="pr-success">
                {message}
              </p>
            )}
            <div className="hub-actions">
              <button
                className="pr-button pr-primary"
                disabled={busy || !selected || !target}
              >
                <Save />
                {busy ? "Saving..." : "Save entry"}
              </button>
              <button
                type="button"
                className="pr-button"
                onClick={async () => {
                  if (!mayDiscard()) return;
                  clear();
                  await query.refetch();
                  await sessions.refetch();
                }}
              >
                <RotateCcw />
                Refresh
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
