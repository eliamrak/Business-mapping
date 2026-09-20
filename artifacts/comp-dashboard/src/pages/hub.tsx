import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  LayoutDashboard,
  Users,
  Wallet,
  TrendingUp,
  CalendarRange,
  FlaskConical,
  ClipboardList,
  Settings2,
  Sun,
  Moon,
  RotateCcw,
  ArrowLeft,
  Check,
  Menu,
  X,
  Download,
} from "lucide-react";
import {
  forecast,
  workspaceSchema,
  type Workspace,
  type Collection,
} from "@workspace/practice/hub";
import { ApiError } from "@workspace/api-client-react";
import { dateRangeSchema, daysInclusive } from "@workspace/practice";
import {
  getHub,
  getContext,
  hubKey,
  writeHub,
  approveProposal,
  type HubSnapshot,
} from "@/lib/hub-api";
import { DatePicker } from "@/pages/practice";
import RecordEditor from "@/components/hub/record-editor";
import RecordTable from "@/components/hub/record-table";
import { newRecord } from "@/components/hub/config";
import {
  Overview,
  Finances,
  PracticeOperations,
  Growth,
  Plans,
  type ViewProps,
} from "@/components/hub/views";
import Sandbox from "@/components/hub/sandbox";
import Updates from "@/components/hub/updates";
import Settings, { SettingsEditor } from "@/components/hub/settings";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import "@/pages/practice.css";
import "@/pages/hub.css";

const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "practice", label: "Practice", icon: Users },
  { id: "finances", label: "Finances", icon: Wallet },
  { id: "growth", label: "Growth", icon: TrendingUp },
  { id: "plans", label: "Plans & goals", icon: CalendarRange },
  { id: "sandbox", label: "Sandbox", icon: FlaskConical },
  { id: "updates", label: "Updates", icon: ClipboardList },
  { id: "settings", label: "Settings", icon: Settings2 },
];
function readPreferences() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("emc.hub.preferences.v1") ?? "{}",
    );
    return {
      theme: saved.theme === "light" ? "light" : "dark",
      density: saved.density === "compact" ? "compact" : "comfortable",
      textSize: saved.textSize === "large" ? "large" : "normal",
      range: dateRangeSchema.safeParse(saved.range).success
        ? saved.range
        : null,
    };
  } catch {
    return {
      theme: "dark",
      density: "comfortable",
      textSize: "normal",
      range: null,
    };
  }
}
export default function Hub({ section = "overview" }: { section?: string }) {
  const query = useQuery({ queryKey: hubKey, queryFn: getHub });
  const contextQuery = useQuery({
    queryKey: ["hub-context"],
    queryFn: getContext,
  });
  const cache = useQueryClient();
  const [preferences, setPreferences] = useState(readPreferences),
    [mobileNav, setMobileNav] = useState(false),
    [editor, setEditor] = useState<{
      collection: Collection;
      record: Record<string, unknown>;
    } | null>(null),
    [settings, setSettings] = useState<string | null>(null),
    [confirm, setConfirm] = useState<{
      collection: Collection;
      id: string;
    } | null>(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const request = useRef<{
    requestId: string;
    data: Workspace;
    revision: number;
    action: string;
  } | null>(null);
  const today = new Date().toISOString().slice(0, 10),
    range = preferences.range ?? {
      start: today.slice(0, 7) + "-01",
      end: today,
    };
  const workspace = query.data?.data,
    context = contextQuery.data;
  const months = useMemo(
    () => (workspace && context ? forecast(workspace, context) : []),
    [workspace, context],
  );
  const page = navigation.find((n) => n.id === section) ?? navigation[0];
  function preference(patch: Partial<typeof preferences>) {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    try {
      localStorage.setItem("emc.hub.preferences.v1", JSON.stringify(next));
    } catch {}
  }
  function accept(snapshot: HubSnapshot) {
    cache.setQueryData(hubKey, snapshot);
    void cache.invalidateQueries({ queryKey: ["hub-history"] });
  }
  async function save(data: Workspace, action: string) {
    if (!query.data) throw new Error("Workspace is not loaded.");
    const parsed = workspaceSchema.safeParse(data);
    if (!parsed.success)
      throw new Error(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .slice(0, 10)
          .join("\n"),
      );
    if (
      request.current &&
      JSON.stringify(request.current.data) !== JSON.stringify(parsed.data)
    )
      throw new Error(
        "A previous save was not confirmed. Retry that same save or refresh before changing its values.",
      );
    request.current ??= {
      requestId: crypto.randomUUID(),
      data: parsed.data,
      revision: query.data.revision,
      action,
    };
    setSaving(true);
    setError("");
    try {
      const snapshot = await writeHub(
        request.current.data,
        request.current.revision,
        request.current.action,
        request.current.requestId,
      );
      accept(snapshot);
      request.current = null;
      setMessage(`${action}. Saved revision ${snapshot.revision}.`);
    } catch (e) {
      if (e instanceof ApiError && [400, 409].includes(e.status))
        request.current = null;
      throw new Error(
        e instanceof ApiError &&
          e.data &&
          typeof e.data === "object" &&
          "error" in e.data
          ? String(e.data.error)
          : "Save not confirmed. Your entry is still here; retry the same save.",
      );
    } finally {
      setSaving(false);
    }
  }
  function edit(collection: Collection, record?: Record<string, unknown>) {
    if (workspace)
      setEditor({
        collection,
        record: record ?? newRecord(collection, workspace, today),
      });
  }
  const table = (collection: Collection) => (
    <RecordTable
      key={collection}
      collection={collection}
      workspace={workspace!}
      context={context!}
      range={collection === "periods" ? undefined : range}
      onNew={() => edit(collection)}
      onEdit={(record) => edit(collection, record)}
      onArchive={(id) => setConfirm({ collection, id })}
      onCopy={(record) => {
        const copy: Record<string, unknown> = {
          ...structuredClone(record),
          id: crypto.randomUUID(),
          ...("name" in record ? { name: `${record.name} (copy)` } : {}),
          archived: false,
        };
        if (collection === "proposals") {
          copy.approvedAt = null;
          copy.approvedIds = [];
          copy.baseline = null;
          copy.status = "draft";
        }
        if (collection === "periods") {
          const length = daysInclusive(
            String(record.start),
            String(record.end),
          );
          const start = new Date(
            Date.parse(String(record.end) + "T12:00:00Z") + 86400000,
          )
            .toISOString()
            .slice(0, 10);
          Object.assign(copy, newRecord("periods", workspace!, start), {
            name: `Period starting ${start}`,
            start,
            end: new Date(
              Date.parse(start + "T12:00:00Z") + (length - 1) * 86400000,
            )
              .toISOString()
              .slice(0, 10),
          });
        }
        edit(collection, copy);
      }}
    />
  );
  const props: ViewProps | undefined =
    workspace && context
      ? {
          workspace,
          context,
          months,
          range,
          edit,
          settings: setSettings,
          save,
          table,
        }
      : undefined;
  return (
    <div
      className="practice-theme hub-app"
      data-appearance={preferences.theme}
      data-density={preferences.density}
      data-text-size={preferences.textSize}
    >
      <aside className={`hub-nav ${mobileNav ? "is-open" : ""}`}>
        <Link href="/hub" className="hub-brand">
          <span>EMC</span>
          <strong>Business hub</strong>
        </Link>
        <nav aria-label="Business areas">
          {navigation.map((item) => (
            <Link
              key={item.id}
              href={`/hub/${item.id}`}
              aria-current={page.id === item.id ? "page" : undefined}
              onClick={() => setMobileNav(false)}
            >
              <item.icon />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hub-nav-bottom">
          <a href={import.meta.env.BASE_URL}>
            <ArrowLeft />
            Compensation tools
          </a>
          <a href={`${import.meta.env.BASE_URL}practice`}>
            <Users />
            Session tracker
          </a>
          <div className="hub-actions">
            <button
              className="pr-icon"
              aria-label={`Switch to ${preferences.theme === "dark" ? "light" : "dark"} appearance`}
              title="Appearance"
              onClick={() =>
                preference({
                  theme: preferences.theme === "dark" ? "light" : "dark",
                })
              }
            >
              {preferences.theme === "dark" ? <Sun /> : <Moon />}
            </button>
            <select
              aria-label="Table density"
              value={preferences.density}
              onChange={(e) => preference({ density: e.target.value })}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </div>
          <label className="hub-checkbox">
            <input
              type="checkbox"
              checked={preferences.textSize === "large"}
              onChange={(e) =>
                preference({ textSize: e.target.checked ? "large" : "normal" })
              }
            />
            Larger text
          </label>
        </div>
      </aside>
      <main className="hub-main">
        <header className="hub-header">
          <div className="hub-actions">
            <button
              className="pr-icon hub-menu-button"
              title="Business navigation"
              aria-label="Business navigation"
              onClick={() => setMobileNav(!mobileNav)}
            >
              {mobileNav ? <X /> : <Menu />}
            </button>
            <span>{workspace?.settings.practiceName ?? "EMCounseling"}</span>
            <span className="hub-breadcrumb">/ {page.label}</span>
          </div>
          <div className="hub-actions">
            <DatePicker
              range={range}
              onChange={(next) => preference({ range: next })}
            />
            <button
              className="pr-icon"
              title="Refresh saved workspace"
              aria-label="Refresh saved workspace"
              disabled={saving}
              onClick={() => {
                if (
                  !window.dispatchEvent(
                    new Event("emc-discard", { cancelable: true }),
                  )
                )
                  return;
                request.current = null;
                void query.refetch();
                void contextQuery.refetch();
                setMessage("");
              }}
            >
              <RotateCcw />
            </button>
          </div>
        </header>
        <div className="hub-content">
          {import.meta.env.VITE_LOCAL_PREVIEW === "true" && (
            <p className="pr-local-data">Local preview / fictional test data</p>
          )}
          <div className="hub-page-heading">
            <div>
              <h1>{page.label}</h1>
              <p>
                {page.id === "sandbox"
                  ? "Draft changes stay separate until approved"
                  : page.id === "overview"
                    ? "Recorded actuals and expected outcomes"
                    : page.id === "updates"
                      ? "Biweekly reporting & source documents"
                      : "EMCounseling practice operations"}
              </p>
            </div>
            <span className="hub-save-status">
              {saving
                ? "Saving..."
                : query.data
                  ? `Saved / revision ${query.data.revision}`
                  : "Connecting..."}
            </span>
          </div>
          {message && (
            <p className="pr-success" role="status">
              <Check />
              {message}
            </p>
          )}
          {error && (
            <p className="pr-error hub-error" role="alert">
              {error}
            </p>
          )}
          {query.isPending || contextQuery.isPending ? (
            <div className="pr-empty" role="status">
              Loading workspace...
            </div>
          ) : query.isError || contextQuery.isError ? (
            <div className="pr-empty" role="alert">
              <h2>Workspace could not be loaded</h2>
              <p>Existing data has not been changed.</p>
              <button
                className="pr-button"
                onClick={() => {
                  void query.refetch();
                  void contextQuery.refetch();
                }}
              >
                <RotateCcw />
                Retry
              </button>
            </div>
          ) : props ? (
            <>
              {page.id === "overview" ? (
                <Overview {...props} />
              ) : page.id === "finances" ? (
                <Finances {...props} />
              ) : page.id === "practice" ? (
                <PracticeOperations {...props} />
              ) : page.id === "growth" ? (
                <Growth {...props} />
              ) : page.id === "plans" ? (
                <Plans {...props} />
              ) : page.id === "sandbox" ? (
                <Sandbox
                  {...props}
                  theme={preferences.theme}
                  approve={async (id, ids) => {
                    if (!query.data) throw new Error("Workspace unavailable.");
                    try {
                      accept(
                        await approveProposal(
                          id,
                          query.data.revision,
                          ids,
                          crypto.randomUUID(),
                        ),
                      );
                      setMessage(
                        "Proposal approved and applied to the active plan.",
                      );
                    } catch (e) {
                      throw new Error(
                        e instanceof ApiError &&
                          e.data &&
                          typeof e.data === "object" &&
                          "error" in e.data
                          ? String(e.data.error)
                          : "Approval not confirmed. Refresh before retrying.",
                      );
                    }
                  }}
                />
              ) : page.id === "updates" ? (
                <Updates {...props} theme={preferences.theme} />
              ) : (
                <Settings {...props} />
              )}
            </>
          ) : null}
          <footer className="pr-footer">
            <span>Manual data / actuals stay separate from forecasts</span>
            <span>
              {query.data?.updatedAt
                ? `Last saved ${new Date(query.data.updatedAt).toLocaleString()}`
                : "No business-hub records saved yet"}
            </span>
          </footer>
        </div>
      </main>
      {editor && workspace && context && (
        <RecordEditor
          collection={editor.collection}
          record={editor.record}
          workspace={workspace}
          context={context}
          theme={preferences.theme}
          onClose={() => setEditor(null)}
          onSave={async (record, corrections = {}) => {
            const rows = workspace[editor.collection];
            const data = {
              ...workspace,
              [editor.collection]: rows.some((r) => r.id === record.id)
                ? rows.map((r) => (r.id === record.id ? record : r))
                : [...rows, record],
            };
            data.periods = data.periods.map((p) =>
              corrections[p.id]
                ? { ...p, correctionReason: corrections[p.id].trim() }
                : p,
            );
            await save(
              data,
              `Saved ${String(record.name ?? record.description ?? editor.collection)}`,
            );
          }}
        />
      )}
      {settings && workspace && context && (
        <SettingsEditor
          section={settings}
          workspace={workspace}
          context={context}
          theme={preferences.theme}
          onClose={() => setSettings(null)}
          onSave={(data) => save(data, `Updated ${settings} assumptions`)}
        />
      )}
      {confirm && workspace && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirm(null);
          }}
        >
          <DialogContent
            className="practice-theme practice-dialog"
            data-appearance={preferences.theme}
          >
            <DialogHeader>
              <DialogTitle>Change record availability?</DialogTitle>
              <DialogDescription>
                Historical revisions remain available.
              </DialogDescription>
            </DialogHeader>
            <p>
              The record will be archived or restored. Forecasts will
              recalculate; recorded actuals are not deleted.
            </p>
            <div className="pr-dialog-actions">
              <button className="pr-button" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="pr-button pr-primary"
                disabled={saving}
                onClick={() =>
                  void save(
                    {
                      ...workspace,
                      [confirm.collection]: workspace[confirm.collection].map(
                        (r) =>
                          r.id === confirm.id
                            ? {
                                ...r,
                                archived: !("archived" in r && r.archived),
                              }
                            : r,
                      ),
                    },
                    "Changed record availability",
                  )
                    .then(() => setConfirm(null))
                    .catch((e) => setError(e.message))
                }
              >
                <Check />
                Confirm
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
