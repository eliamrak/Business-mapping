import { GrowthInput } from "./growth-input";
import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type {
  GrowthFamily,
  GrowthSettings,
} from "../../lib/reviewed-growth-observations";
const n = (v: number | null | undefined) =>
  v == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(v);
const label = (m: string) =>
  new Date(m + "-01T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
export function GrowthTrajectory({
  cutoff,
  actualMonths,
  families,
  settings,
  onChange,
}: {
  cutoff: string | null;
  actualMonths: { month: string; sessions: number | null }[];
  families: (GrowthFamily & {
    planningReason?: string | null;
    planningProvisional?: boolean;
  })[];
  settings: GrowthSettings;
  onChange: (settings: GrowthSettings) => void;
}) {
  const [history, setHistory] = useState(3),
    [selected, setSelected] = useState("");
  const family = families.find((f) => f.historyMonths === history);
  const future = Array.from({ length: 6 }, (_, i) => {
    if (!cutoff) return null;
    const date = new Date(cutoff.slice(0, 7) + "-01T12:00:00Z");
    date.setUTCMonth(date.getUTCMonth() + i + 1);
    const month = date.toISOString().slice(0, 7),
      index = family?.months.findIndex((m) => m.month === month) ?? -1;
    const capacity = index >= 0 ? (family?.capacity?.[index] ?? null) : null;
    return {
      month,
      actual: null as number | null,
      estimate:
        index >= 0 ? (family?.projection?.workload[index] ?? null) : null,
      capacity,
      target: capacity === null ? null : capacity * settings.occupancy,
    };
  }).filter((v): v is NonNullable<typeof v> => v !== null);
  const points = [
    ...actualMonths.map((m) => ({
      month: m.month,
      actual: m.sessions,
      estimate: null as number | null,
      capacity: null as number | null,
      target: null as number | null,
    })),
    ...future,
  ];
  const inspected =
    points.find((p) => p.month === selected) ?? future[0] ?? points.at(-1);
  const goalDate = cutoff
    ? new Date(cutoff.slice(0, 7) + "-01T12:00:00Z")
    : null;
  goalDate?.setUTCMonth(goalDate.getUTCMonth() + settings.goalMonths);
  const inspect = (state: { activeLabel?: unknown } | null) => {
    if (typeof state?.activeLabel === "string") setSelected(state.activeLabel);
  };
  return (
    <div className="pw-growth-trajectory">
      <div className="pw-reviewed-growth-controls">
        <label>
          Target occupancy (%)
          <GrowthInput
            type="number"
            min="0"
            max="100"
            value={settings.occupancy * 100}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (
                e.target.value !== "" &&
                Number.isFinite(v) &&
                v >= 0 &&
                v <= 100
              )
                onChange({ ...settings, occupancy: v / 100 });
            }}
          />
        </label>
        <label>
          Reach target in (months)
          <GrowthInput
            type="number"
            min="1"
            max="36"
            step="1"
            value={settings.goalMonths}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isInteger(v) && v >= 1 && v <= 36)
                onChange({
                  ...settings,
                  goalMonths: v,
                  checkMonths: Math.max(6, v, settings.checkMonths),
                });
            }}
          />
        </label>
        <p>
          Goal month:{" "}
          {goalDate ? label(goalDate.toISOString().slice(0, 7)) : "Unavailable"}
        </p>
      </div>
      <div
        className="pw-contributor-tabs pw-growth-scope"
        role="group"
        aria-label="Forecast history"
      >
        {[3, 12].map((m) => (
          <button
            type="button"
            key={m}
            aria-pressed={history === m}
            onClick={() => setHistory(m)}
          >
            Last {m} months
          </button>
        ))}
      </div>
      {family &&
        family.historyMonths === 12 &&
        family.leadMonths.length < 12 && (
          <small>Uses {family.leadMonths.length} available lead months.</small>
        )}
      {family && family.coveredMonths < family.historyMonths && (
        <p>
          Partial attendance history: {family.coveredMonths} of{" "}
          {family.historyMonths} months.
        </p>
      )}
      <p>
        <strong>
          {n(
            family && family.coveredDays
              ? family.establishedDays / family.coveredDays
              : null,
          )}
        </strong>{" "}
        average established active clients
      </p>
      {(family?.planningProvisional ?? family?.provisional) && (
        <p>Incomplete lead month: estimates are provisional.</p>
      )}
      <p>Sessions per month · solid: actual · dashed: estimated</p>
      <div
        style={{ height: 320, width: "100%", minWidth: 0 }}
        role="region"
        aria-label="Actual and estimated monthly sessions chart"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            onMouseMove={inspect}
            onClick={inspect}
            accessibilityLayer
          >
            <CartesianGrid
              vertical={false}
              stroke="currentColor"
              opacity={0.15}
            />
            <XAxis
              dataKey="month"
              tick={{ style: { fill: "#000d16" } }}
              tickFormatter={label}
              minTickGap={35}
            />
            <YAxis width={45} tick={{ style: { fill: "#000d16" } }} />
            <Tooltip
              contentStyle={{ background: "#fff", color: "#102f43" }}
              labelStyle={{ color: "#102f43" }}
              labelFormatter={(v) => label(String(v))}
              formatter={(v, name) => [n(Number(v)), name]}
            />
            <Line
              type="linear"
              dataKey="actual"
              name="Actual sessions"
              stroke="#173e57"
              strokeWidth={3}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="estimate"
              name="Estimated sessions"
              stroke="#006758"
              strokeWidth={3}
              strokeDasharray="7 4"
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="target"
              name={`Target (${n(settings.occupancy * 100)}%)`}
              stroke="#795200"
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="capacity"
              name="Full capacity (100%)"
              stroke="#734551"
              dot={false}
              isAnimationActive={false}
            />
            {goalDate && (
              <ReferenceLine
                x={goalDate.toISOString().slice(0, 7)}
                stroke="#795200"
                strokeDasharray="4 4"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <label>
        Inspect month
        <select
          aria-label="Inspect month"
          value={inspected?.month ?? ""}
          onChange={(e) => setSelected(e.target.value)}
        >
          {points.map((p) => (
            <option key={p.month} value={p.month}>
              {label(p.month)}
            </option>
          ))}
        </select>
      </label>
      <output aria-live="polite">
        {inspected
          ? `${label(inspected.month)} · ${inspected.month <= (cutoff ?? "").slice(0, 7) ? "Actual sessions: " + n(inspected.actual) : "Estimated sessions: " + n(inspected.estimate) + " · Target: " + n(inspected.target) + " · Full capacity: " + n(inspected.capacity)}`
          : "Covered session history is unavailable."}
      </output>
      {!family?.projection && (
        <p role="status">
          {family?.planningReason ??
            family?.reason ??
            "Forecast unavailable for this scope."}
        </p>
      )}
      {family?.projection && (
        <p>
          Estimated monthly sessions: {n(future[0]?.estimate)} →{" "}
          {n(future.at(-1)?.estimate)} over the next six months.
        </p>
      )}
      <p>
        Target line: {n(settings.occupancy * 100)}% occupancy. Full-capacity
        line: 100%. Estimates are not guarantees.
      </p>
      <p>
        <strong>{n(family?.projection?.goalPace)}</strong> estimated leads/month
        to reach the selected target.
      </p>
      <p>
        <strong>{n(family?.projection?.physicalLeadCeiling)}</strong>{" "}
        leads/month maximum before the{" "}
        <strong>physical 100% capacity limit</strong> in the checked horizon—not
        the selected occupancy target.
      </p>
      {family?.projection?.goalStatus === "capacity-limited" && (
        <p role="status">
          The target lead pace would exceed physical capacity during the checked
          horizon.
        </p>
      )}
    </div>
  );
}
