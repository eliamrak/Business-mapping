import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useListBusinessGoals,
  useListClinicians,
  type Clinician,
} from "@workspace/api-client-react";
import {
  dateRangeSchema,
  daysInclusive,
  summarizeSessions,
  type SessionRecord,
} from "@workspace/practice";
import {
  Activity,
  LayoutDashboard,
  CalendarDays,
  Check,
  ChevronDown,
  Columns3,
  ExternalLink,
  History,
  List,
  Moon,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sun,
  Users,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SessionEditor from "@/components/practice/session-editor";
import {
  listSessionRecords,
  sessionHistory,
  sessionKey,
} from "@/lib/session-api";
import { calculateClinicianMetrics } from "@/lib/calculations";
import "@/pages/practice.css";

type Range = { start: string; end: string };
type Columns = {
  desired: boolean;
  cancelled: boolean;
  noShow: boolean;
  scheduled: boolean;
  inPerson: boolean;
  telehealth: boolean;
  attendance: boolean;
  average: boolean;
};
const defaultColumns: Columns = {
  desired: true,
  cancelled: false,
  noShow: false,
  scheduled: false,
  inPerson: false,
  telehealth: false,
  attendance: false,
  average: true,
};
const preferencesKey = "emc.practice.preferences.v1";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Indiana/Indianapolis",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(date + "T12:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
const number = (value: number | null, decimals = 0) =>
  value === null
    ? "--"
    : value.toLocaleString("en-US", { maximumFractionDigits: decimals });
const currency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

function presetRange(preset: string): Range {
  const end = today();
  if (/^\d+$/.test(preset))
    return { start: shiftDate(end, 1 - Number(preset)), end };
  const [year, month] = end.split("-").map(Number);
  if (preset === "month") return { start: `${end.slice(0, 7)}-01`, end };
  if (preset === "last-month") {
    const last = shiftDate(`${end.slice(0, 7)}-01`, -1);
    return { start: last.slice(0, 7) + "-01", end: last };
  }
  if (preset === "quarter")
    return {
      start: `${year}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`,
      end,
    };
  return { start: `${year}-01-01`, end };
}
function readPreferences(): {
  theme: string;
  team: string;
  selected: number | null;
  range: Range;
  columns: Columns;
} {
  const fallback = {
    theme: "dark",
    team: "unassigned",
    selected: null as number | null,
    range: presetRange("14"),
    columns: defaultColumns,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(preferencesKey) ?? "null");
    if (!saved || typeof saved !== "object") return fallback;
    return {
      theme: saved.theme === "light" ? "light" : "dark",
      team:
        typeof saved.team === "string" &&
        /^(unassigned|[1-9]\d*)$/.test(saved.team)
          ? saved.team
          : fallback.team,
      selected: Number.isInteger(saved.selected) ? saved.selected : null,
      range: dateRangeSchema.safeParse(saved.range).success
        ? saved.range
        : fallback.range,
      columns: Object.fromEntries(
        Object.entries(defaultColumns).map(([key, value]) => [
          key,
          typeof saved.columns?.[key] === "boolean"
            ? saved.columns[key]
            : value,
        ]),
      ) as Columns,
    };
  } catch {
    return fallback;
  }
}

function IconButton({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="pr-icon"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function DatePicker({
  range,
  onChange,
}: {
  range: Range;
  onChange: (range: Range) => void;
}) {
  const [draft, setDraft] = useState(range);
  const [error, setError] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    setDraft(range);
  }, [range]);
  function apply(next: Range) {
    const parsed = dateRangeSchema.safeParse(next);
    if (!parsed.success) {
      setError("Choose valid dates, with the start on or before the end.");
      return;
    }
    onChange(next);
    setError("");
    if (details.current) details.current.open = false;
  }
  return (
    <details className="pr-picker" ref={details}>
      <summary aria-label="Date range">
        <CalendarDays />
        <span>
          {dateLabel(range.start)} - {dateLabel(range.end)}
        </span>
        <ChevronDown />
      </summary>
      <div className="pr-date-menu">
        <div className="pr-presets">
          {[
            ["7", "Last 7 days"],
            ["14", "Last 14 days"],
            ["30", "Last 30 days"],
            ["90", "Last 90 days"],
            ["month", "This month"],
            ["last-month", "Last month"],
            ["quarter", "This quarter"],
            ["year", "Year to date"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => apply(presetRange(value))}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="pr-date-fields">
          <label className="pr-field">
            From
            <input
              type="date"
              value={draft.start}
              onChange={(event) =>
                setDraft({ ...draft, start: event.target.value })
              }
            />
          </label>
          <label className="pr-field">
            To
            <input
              type="date"
              value={draft.end}
              onChange={(event) =>
                setDraft({ ...draft, end: event.target.value })
              }
            />
          </label>
        </div>
        {error && (
          <p className="pr-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="pr-button pr-primary"
          type="button"
          onClick={() => apply(draft)}
        >
          <Check />
          Apply dates
        </button>
      </div>
    </details>
  );
}

function HistoryDialog({
  record,
  theme,
  onClose,
}: {
  record: SessionRecord;
  theme: string;
  onClose: () => void;
}) {
  const history = useQuery({
    queryKey: ["session-history", record.id],
    queryFn: ({ signal }) => sessionHistory(record.id, signal),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="practice-theme practice-dialog"
        data-appearance={theme}
      >
        <DialogHeader>
          <DialogTitle>Entry history</DialogTitle>
          <DialogDescription>
            {dateLabel(record.start)} - {dateLabel(record.end)}
          </DialogDescription>
        </DialogHeader>
        {history.isPending ? (
          <p role="status">Loading history...</p>
        ) : history.isError ? (
          <div role="alert">
            <p className="pr-error">History could not be loaded.</p>
            <button className="pr-button" onClick={() => history.refetch()}>
              <RotateCcw />
              Retry
            </button>
          </div>
        ) : (
          <ol className="pr-history">
            {history.data.map((version) => (
              <li key={version.revision}>
                <div>
                  <strong>Revision {version.revision}</strong>
                  <small>{new Date(version.recordedAt).toLocaleString()}</small>
                  <small>{version.actor ?? "Legacy entry"}</small>
                </div>
                <dl>
                  <div>
                    <dt>Completed</dt>
                    <dd>{version.entry.completed}</dd>
                  </div>
                  <div>
                    <dt>Desired</dt>
                    <dd>{version.entry.desired}</dd>
                  </div>
                  <div>
                    <dt>Cancelled</dt>
                    <dd>{version.entry.cancelled ?? "Not entered"}</dd>
                  </div>
                  <div>
                    <dt>No-shows</dt>
                    <dd>{version.entry.noShow ?? "Not entered"}</dd>
                  </div>
                  {(["scheduled", "inPerson", "telehealth"] as const).map(
                    (key) => (
                      <div key={key}>
                        <dt>
                          {
                            {
                              scheduled: "Scheduled",
                              inPerson: "In-person",
                              telehealth: "Telehealth",
                            }[key]
                          }
                        </dt>
                        <dd>{version.entry[key] ?? "Not entered"}</dd>
                      </div>
                    ),
                  )}
                </dl>
                {version.entry.sourceAttachmentId && (
                  <a
                    href={`/api/hub/attachments/${version.entry.sourceAttachmentId}`}
                    download
                  >
                    Source document
                  </a>
                )}
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Practice() {
  const [preferences, setPreferences] = useState(readPreferences);
  const { team, theme, range, columns } = preferences;
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"clinician" | "team">("clinician");
  const [editor, setEditor] = useState<{
    clinician: Clinician;
    record?: SessionRecord;
  } | null>(null);
  const [historyRecord, setHistoryRecord] = useState<SessionRecord | null>(
    null,
  );
  const [status, setStatus] = useState("");
  const [showCompensation, setShowCompensation] = useState(false);
  const goalsQuery = useListBusinessGoals();
  const cliniciansQuery = useListClinicians();
  const sessionsQuery = useQuery({
    queryKey: sessionKey(team),
    queryFn: ({ signal }) => listSessionRecords(team, signal),
  });
  const clinicians = useMemo(
    () =>
      (cliniciansQuery.data ?? []).filter((c) =>
        team === "unassigned" ? c.goalId == null : c.goalId === Number(team),
      ),
    [cliniciansQuery.data, team],
  );
  const selected =
    clinicians.find((c) => c.id === preferences.selected) ?? clinicians[0];
  const rows = useMemo(
    () =>
      clinicians.map((clinician) => ({
        clinician,
        summary: summarizeSessions(
          (sessionsQuery.data ?? []).filter(
            (r) => r.clinicianId === clinician.id,
          ),
          range,
        ),
      })),
    [clinicians, sessionsQuery.data, range],
  );
  const current = rows.find((row) => row.clinician.id === selected?.id);
  const selectedRecords = (sessionsQuery.data ?? [])
    .filter((row) => row.clinicianId === selected?.id)
    .sort((a, b) => b.end.localeCompare(a.end));
  const rangeRecords = selectedRecords.filter(
    (row) => row.start <= range.end && row.end >= range.start,
  );
  const reported = rows.filter((row) => row.summary.completed !== null);
  const totalCompleted = reported.length
    ? reported.reduce((sum, row) => sum + (row.summary.completed ?? 0), 0)
    : null;
  const totalDesired = reported.length
    ? reported.reduce((sum, row) => sum + (row.summary.desired ?? 0), 0)
    : null;
  const dataThrough = rows.reduce<string | null>(
    (latest, row) =>
      row.summary.dataThrough && (!latest || row.summary.dataThrough > latest)
        ? row.summary.dataThrough
        : latest,
    null,
  );
  const partialCount = rows.reduce(
    (sum, row) => sum + row.summary.partial.length,
    0,
  );
  const busy =
    goalsQuery.isPending ||
    cliniciansQuery.isPending ||
    sessionsQuery.isPending;
  const failed =
    goalsQuery.isError || cliniciansQuery.isError || sessionsQuery.isError;
  const compensationHref = `${import.meta.env.BASE_URL}?view=team`;

  useEffect(() => {
    try {
      localStorage.setItem(preferencesKey, JSON.stringify(preferences));
    } catch {
      /* Preferences are optional when browser storage is unavailable. */
    }
  }, [preferences]);
  function selectClinician(id: number) {
    setPreferences((previous) => ({ ...previous, selected: id }));
    setView("clinician");
    setShowCompensation(false);
  }
  function refresh() {
    void goalsQuery.refetch();
    void cliniciansQuery.refetch();
    void sessionsQuery.refetch();
  }
  function columnsPicker() {
    return (
      <details className="pr-picker pr-columns">
        <summary aria-label="Visible columns">
          <Columns3 />
          <span>Columns</span>
          <ChevronDown />
        </summary>
        <div className="pr-column-menu">
          {(
            [
              ["desired", "Desired"],
              ["cancelled", "Cancelled"],
              ["noShow", "No-shows"],
              ["scheduled", "Scheduled"],
              ["inPerson", "In person"],
              ["telehealth", "Telehealth"],
              ["attendance", "Attendance"],
              ["average", "Avg / recorded week"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={columns[key]}
                onChange={(event) =>
                  setPreferences({
                    ...preferences,
                    columns: { ...columns, [key]: event.target.checked },
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
      </details>
    );
  }
  function stat(label: string, value: string, context: string) {
    return (
      <div className="pr-stat">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{context}</small>
      </div>
    );
  }
  const list = clinicians.filter((c) =>
    c.label.toLowerCase().includes(search.toLowerCase()),
  );
  const totalsUnavailable = busy || failed;

  return (
    <div className="practice-theme practice-app" data-appearance={theme}>
      <aside className="pr-rail" aria-label="Main navigation">
        <a
          className="pr-logo"
          href={import.meta.env.BASE_URL}
          aria-label="EMCounseling compensation dashboard"
        >
          EMC
        </a>
        <span className="pr-rail-active" aria-current="page">
          <Users />
          <span>Practice</span>
        </span>
        <a
          className="pr-rail-link"
          href={`${import.meta.env.BASE_URL}workspace`}
          aria-label="My Practice"
          title="My Practice"
        >
          <LayoutDashboard />
          <span>My Practice</span>
        </a>
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              className="pr-rail-link"
              href={`${import.meta.env.BASE_URL}reference`}
              aria-label="Original compensation layout"
            >
              <SlidersHorizontal />
              <span>Original</span>
            </a>
          </TooltipTrigger>
          <TooltipContent>Original compensation layout</TooltipContent>
        </Tooltip>
        <div className="pr-rail-bottom">
          <IconButton
            label={
              theme === "dark"
                ? "Switch to light appearance"
                : "Switch to dark appearance"
            }
            onClick={() =>
              setPreferences({
                ...preferences,
                theme: theme === "dark" ? "light" : "dark",
              })
            }
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </IconButton>
        </div>
      </aside>
      <aside className="pr-roster">
        <div className="pr-roster-heading">
          <h2>Clinicians</h2>
          <span>{clinicians.length}</span>
        </div>
        <label className="pr-team-select">
          Team
          <select
            value={team}
            onChange={(event) => {
              setPreferences({
                ...preferences,
                team: event.target.value,
                selected: null,
              });
              setSearch("");
              setStatus("");
            }}
          >
            <option value="unassigned">Unassigned clinicians</option>
            {goalsQuery.data?.map((goal) => (
              <option key={goal.id} value={String(goal.id)}>
                {goal.name}
              </option>
            ))}
          </select>
        </label>
        <label className="pr-search">
          <Search />
          <input
            aria-label="Find a clinician"
            placeholder="Find a clinician"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="pr-people">
          {list.map((c) => {
            const summary = rows.find(
              (row) => row.clinician.id === c.id,
            )!.summary;
            return (
              <button
                key={c.id}
                type="button"
                className="pr-person"
                aria-pressed={selected?.id === c.id}
                onClick={() => selectClinician(c.id)}
              >
                <span className="pr-avatar">{initials(c.label)}</span>
                <span>
                  <strong>{c.label}</strong>
                  <small>
                    {totalsUnavailable
                      ? "Session data unavailable"
                      : summary.completed === null
                        ? "No recorded totals"
                        : `${number(summary.completed)} sessions / ${number(summary.utilization)}%`}
                  </small>
                </span>
              </button>
            );
          })}
          {!busy && !list.length && (
            <p className="pr-roster-empty">
              {search
                ? "No matching clinicians."
                : "No clinicians in this team."}
            </p>
          )}
        </div>
        <a className="pr-manage" href={compensationHref}>
          <Plus />
          Manage clinicians
          <ExternalLink />
        </a>
      </aside>
      <main className="pr-main">
        <header className="pr-top">
          <div>
            <span>EMCounseling</span>
            <b>Practice</b>
          </div>
          <div className="pr-top-actions">
            <DatePicker
              range={range}
              onChange={(next) =>
                setPreferences({ ...preferences, range: next })
              }
            />
            <IconButton
              label="Refresh saved data"
              onClick={refresh}
              disabled={sessionsQuery.isFetching}
            >
              <RotateCcw />
            </IconButton>
          </div>
        </header>
        <div className="pr-mobile-selects">
          <label className="pr-field">
            Team
            <select
              value={team}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  team: event.target.value,
                  selected: null,
                })
              }
            >
              <option value="unassigned">Unassigned clinicians</option>
              {goalsQuery.data?.map((goal) => (
                <option key={goal.id} value={String(goal.id)}>
                  {goal.name}
                </option>
              ))}
            </select>
          </label>
          <label className="pr-field">
            Clinician
            <select
              value={selected?.id ?? ""}
              onChange={(event) => selectClinician(Number(event.target.value))}
            >
              <option value="" disabled>
                Select clinician
              </option>
              {clinicians.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="pr-content">
          {import.meta.env.VITE_LOCAL_PREVIEW === "true" && (
            <p className="pr-local-data">Local preview / fictional test data</p>
          )}
          <div className="pr-page-heading">
            <div>
              <h1>Session tracker</h1>
              <p>
                Recorded actuals{" "}
                {dataThrough && !totalsUnavailable
                  ? `/ Through ${dateLabel(dataThrough)}`
                  : ""}
              </p>
            </div>
            <div className="pr-segment" aria-label="Workspace view">
              <button
                type="button"
                aria-pressed={view === "clinician"}
                onClick={() => setView("clinician")}
              >
                <Users />
                Clinician
              </button>
              <button
                type="button"
                aria-pressed={view === "team"}
                onClick={() => setView("team")}
              >
                <List />
                Team
              </button>
            </div>
          </div>
          <div className="pr-team-stats">
            {stat(
              "Team completed",
              totalsUnavailable ? "--" : number(totalCompleted),
              "Whole recorded periods",
            )}
            {stat(
              "Team desired",
              totalsUnavailable ? "--" : number(totalDesired),
              "Same recorded periods",
            )}
            {stat(
              "Reporting coverage",
              totalsUnavailable
                ? "--"
                : `${reported.length} / ${clinicians.length}`,
              "Clinicians with recorded totals",
            )}
          </div>
          {status && (
            <p className="pr-success" role="status">
              <Check />
              {status}
            </p>
          )}
          {busy ? (
            <div className="pr-empty" role="status">
              <Activity />
              <h2>Loading your practice...</h2>
            </div>
          ) : failed ? (
            <div className="pr-empty" role="alert">
              <h2>Practice data could not be loaded</h2>
              <p>No totals have been assumed or changed.</p>
              <button className="pr-button" onClick={refresh}>
                <RotateCcw />
                Retry
              </button>
            </div>
          ) : !selected ? (
            <div className="pr-empty">
              <Users />
              <h2>No clinicians in this team</h2>
              <a className="pr-button pr-primary" href={compensationHref}>
                <Plus />
                Manage clinicians
              </a>
            </div>
          ) : (
            <>
              {partialCount > 0 && (
                <div className="pr-notice">
                  <CalendarDays />
                  <span>
                    {partialCount} saved{" "}
                    {partialCount === 1 ? "period crosses" : "periods cross"}{" "}
                    this date range. Those totals are excluded, not prorated.
                  </span>
                </div>
              )}
              {view === "team" ? (
                <>
                  <div className="pr-section-heading">
                    <h2>Team sessions</h2>
                    {columnsPicker()}
                  </div>
                  <div className="pr-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Clinician</th>
                          <th>Completed</th>
                          {columns.desired && <th>Desired</th>}
                          <th>Utilization</th>
                          {columns.average && <th>Avg / recorded week</th>}
                          {columns.cancelled && <th>Cancelled</th>}
                          {columns.noShow && <th>No-shows</th>}
                          {columns.scheduled && <th>Scheduled</th>}
                          {columns.inPerson && <th>In person</th>}
                          {columns.telehealth && <th>Telehealth</th>}
                          {columns.attendance && <th>Attendance</th>}
                          <th>Recorded days</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ clinician, summary }) => (
                          <tr key={clinician.id}>
                            <td>
                              <button
                                className="pr-table-name"
                                onClick={() => selectClinician(clinician.id)}
                              >
                                {clinician.label}
                              </button>
                            </td>
                            <td>{number(summary.completed)}</td>
                            {columns.desired && (
                              <td>{number(summary.desired)}</td>
                            )}
                            <td>
                              {summary.utilization === null
                                ? "--"
                                : `${number(summary.utilization)}%`}
                            </td>
                            {columns.average && (
                              <td>
                                {number(summary.averagePerRecordedWeek, 1)}
                              </td>
                            )}
                            {columns.cancelled && (
                              <td>{number(summary.cancelled)}</td>
                            )}
                            {columns.noShow && (
                              <td>{number(summary.noShow)}</td>
                            )}
                            {columns.scheduled && (
                              <td>{number(summary.scheduled)}</td>
                            )}
                            {columns.inPerson && (
                              <td>{number(summary.inPerson)}</td>
                            )}
                            {columns.telehealth && (
                              <td>{number(summary.telehealth)}</td>
                            )}
                            {columns.attendance && (
                              <td>
                                {summary.attendance === null
                                  ? "--"
                                  : `${number(summary.attendance)}%`}
                              </td>
                            )}
                            <td>
                              {summary.coveredDays} /{" "}
                              {daysInclusive(range.start, range.end)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <>
                  <div className="pr-clinician-heading">
                    <div className="pr-profile">
                      <span className="pr-avatar">
                        {initials(selected.label)}
                      </span>
                      <div>
                        <h2>{selected.label}</h2>
                        <p>
                          {selected.roleType.replaceAll("_", " ")} /{" "}
                          {String(selected.classification).toUpperCase()}
                        </p>
                      </div>
                    </div>
                    <button
                      className="pr-button pr-primary"
                      onClick={() => {
                        setEditor({ clinician: selected });
                        setStatus("");
                      }}
                    >
                      <Plus />
                      Record sessions
                    </button>
                  </div>
                  <div className="pr-person-stats">
                    {stat(
                      "Completed",
                      number(current!.summary.completed),
                      `${current!.summary.coveredDays} recorded days`,
                    )}
                    {stat(
                      "Desired",
                      number(current!.summary.desired),
                      "For those recorded days",
                    )}
                    <div className="pr-stat pr-utilization">
                      <div
                        className="pr-gauge"
                        style={
                          {
                            "--fill": `${Math.max(0, Math.min(100, current!.summary.utilization ?? 0))}%`,
                          } as React.CSSProperties
                        }
                      >
                        <span>
                          {current!.summary.utilization === null
                            ? "--"
                            : `${number(current!.summary.utilization)}%`}
                        </span>
                      </div>
                      <div>
                        <span>Utilization</span>
                        <small>Completed / desired</small>
                      </div>
                    </div>
                  </div>
                  <div className="pr-section-heading">
                    <h2>Saved periods</h2>
                    {columnsPicker()}
                  </div>
                  {!rangeRecords.length ? (
                    <div className="pr-empty pr-empty-period">
                      <CalendarDays />
                      <h3>No recorded periods in this range</h3>
                      <p>
                        {selectedRecords.length
                          ? `${selectedRecords.length} saved periods are outside these dates.`
                          : "Completed and desired totals have not been entered."}
                      </p>
                    </div>
                  ) : (
                    <div className="pr-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Period</th>
                            <th>Completed</th>
                            {columns.desired && <th>Desired</th>}
                            {columns.average && <th>Avg / recorded week</th>}
                            {columns.cancelled && <th>Cancelled</th>}
                            {columns.noShow && <th>No-shows</th>}
                            {columns.scheduled && <th>Scheduled</th>}
                            {columns.inPerson && <th>In person</th>}
                            {columns.telehealth && <th>Telehealth</th>}
                            {columns.attendance && <th>Attendance</th>}
                            <th>
                              <span className="pr-sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rangeRecords.map((record) => {
                            const partial =
                              record.start < range.start ||
                              record.end > range.end;
                            return (
                              <tr key={record.id}>
                                <td>
                                  <strong>{dateLabel(record.start)}</strong>
                                  <small>to {dateLabel(record.end)}</small>
                                  {partial && (
                                    <span className="pr-excluded">
                                      Outside range / excluded
                                    </span>
                                  )}
                                </td>
                                <td>{number(record.completed)}</td>
                                {columns.desired && (
                                  <td>{number(record.desired)}</td>
                                )}
                                {columns.average && (
                                  <td>
                                    {number(
                                      record.completed /
                                        (daysInclusive(
                                          record.start,
                                          record.end,
                                        ) /
                                          7),
                                      1,
                                    )}
                                  </td>
                                )}
                                {columns.cancelled && (
                                  <td>{number(record.cancelled)}</td>
                                )}
                                {columns.noShow && (
                                  <td>{number(record.noShow)}</td>
                                )}
                                {columns.scheduled && (
                                  <td>{number(record.scheduled ?? null)}</td>
                                )}
                                {columns.inPerson && (
                                  <td>{number(record.inPerson ?? null)}</td>
                                )}
                                {columns.telehealth && (
                                  <td>{number(record.telehealth ?? null)}</td>
                                )}
                                {columns.attendance && (
                                  <td>
                                    {record.scheduled
                                      ? `${number((record.completed / record.scheduled) * 100)}%`
                                      : "--"}
                                  </td>
                                )}
                                <td>
                                  <div className="pr-row-actions">
                                    <IconButton
                                      label={`Correct period starting ${record.start}`}
                                      onClick={() => {
                                        setEditor({
                                          clinician: selected,
                                          record,
                                        });
                                        setStatus("");
                                      }}
                                    >
                                      <Pencil />
                                    </IconButton>
                                    <IconButton
                                      label={`History for period starting ${record.start}`}
                                      onClick={() => setHistoryRecord(record)}
                                    >
                                      <History />
                                    </IconButton>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="pr-compensation">
                    <button
                      className="pr-disclosure"
                      type="button"
                      aria-expanded={showCompensation}
                      onClick={() => setShowCompensation(!showCompensation)}
                    >
                      <span>
                        <SlidersHorizontal />
                        Compensation model
                      </span>
                      <ChevronDown
                        className={showCompensation ? "pr-rotated" : ""}
                      />
                    </button>
                    {showCompensation && (
                      <CompensationDetails
                        clinician={selected}
                        href={compensationHref}
                      />
                    )}
                  </div>
                </>
              )}
            </>
          )}
          <footer className="pr-footer">
            <span>Manual records / America/Indiana/Indianapolis</span>
            <span>
              {sessionsQuery.isFetching
                ? "Refreshing..."
                : failed
                  ? "Connection needs attention"
                  : "Up to date"}
            </span>
          </footer>
        </div>
      </main>
      {editor && (
        <SessionEditor
          clinician={editor.clinician}
          record={editor.record}
          range={range}
          team={team}
          theme={theme}
          onClose={() => setEditor(null)}
          onSaved={(record) => {
            setStatus(
              `Saved ${editor.clinician.label}'s totals. Revision ${record.revision}.`,
            );
            setEditor(null);
          }}
        />
      )}
      {historyRecord && (
        <HistoryDialog
          record={historyRecord}
          theme={theme}
          onClose={() => setHistoryRecord(null)}
        />
      )}
    </div>
  );
}

function CompensationDetails({
  clinician,
  href,
}: {
  clinician: Clinician;
  href: string;
}) {
  const metrics = calculateClinicianMetrics(clinician);
  return (
    <div className="pr-compensation-body">
      <p>
        Annual projection from existing compensation assumptions, separate from
        recorded actuals.
      </p>
      <dl>
        <div>
          <dt>Session rate</dt>
          <dd>{currency(clinician.sessionRate)}</dd>
        </div>
        <div>
          <dt>Planned sessions / week</dt>
          <dd>{clinician.sessionsPerWeek}</dd>
        </div>
        <div>
          <dt>Clinician split before cap</dt>
          <dd>{clinician.preCapClinicianSplit}%</dd>
        </div>
        <div>
          <dt>Clinician split after cap</dt>
          <dd>
            {clinician.capEnabled
              ? `${clinician.postCapClinicianSplit}%`
              : "No cap"}
          </dd>
        </div>
        <div>
          <dt>Projected annual compensation</dt>
          <dd>{currency(metrics.clinicianCompensation)}</dd>
        </div>
        <div>
          <dt>Projected practice net before overhead</dt>
          <dd>{currency(metrics.practiceNetBeforeOverhead)}</dd>
        </div>
      </dl>
      <a className="pr-text-link" href={href}>
        Open compensation settings
        <ExternalLink />
      </a>
    </div>
  );
}
