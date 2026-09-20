import { Plus, Trash2 } from "lucide-react";
import {
  metrics,
  type Condition,
  type Workspace,
} from "@workspace/practice/hub";
export const freshCondition = (): Condition => ({
  id: crypto.randomUUID(),
  type: "condition",
  metric: "utilization",
  operator: "gte",
  value: 80,
  upper: 100,
  scope: "practice",
  clinicianIds: [],
  periods: 1,
  compareTo: "value",
});
export default function RuleEditor({
  value,
  onChange,
  workspace,
  clinicians,
  depth = 0,
}: {
  value: Condition;
  onChange: (value: Condition) => void;
  workspace: Workspace;
  clinicians: { id: number; label: string }[];
  depth?: number;
}) {
  if (value.type === "group")
    return (
      <fieldset className="hub-condition">
        <legend>{depth ? "Condition group" : "If"}</legend>
        <select
          aria-label="Condition logic"
          value={value.logic}
          onChange={(e) =>
            onChange({ ...value, logic: e.target.value as "all" | "any" })
          }
        >
          <option value="all">All conditions (AND)</option>
          <option value="any">Any condition (OR)</option>
        </select>
        {value.children.map((child, i) => (
          <div className="hub-condition-row" key={child.id}>
            <RuleEditor
              value={child}
              workspace={workspace}
              clinicians={clinicians}
              depth={depth + 1}
              onChange={(next) =>
                onChange({
                  ...value,
                  children: value.children.map((c, j) => (j === i ? next : c)),
                })
              }
            />
            {value.children.length > 1 && (
              <button
                type="button"
                className="pr-icon"
                title="Remove condition"
                aria-label="Remove condition"
                onClick={() =>
                  onChange({
                    ...value,
                    children: value.children.filter((_, j) => j !== i),
                  })
                }
              >
                <Trash2 />
              </button>
            )}
          </div>
        ))}
        <div className="hub-actions">
          <button
            type="button"
            className="pr-button"
            onClick={() =>
              onChange({
                ...value,
                children: [...value.children, freshCondition()],
              })
            }
          >
            <Plus />
            Condition
          </button>
          {depth < 4 && (
            <button
              type="button"
              className="pr-button"
              onClick={() =>
                onChange({
                  ...value,
                  children: [
                    ...value.children,
                    {
                      id: crypto.randomUUID(),
                      type: "group",
                      logic: "any",
                      children: [freshCondition()],
                    },
                  ],
                })
              }
            >
              <Plus />
              Group
            </button>
          )}
        </div>
      </fieldset>
    );
  const edit = (patch: Partial<Extract<Condition, { type: "condition" }>>) =>
    onChange({ ...value, ...patch });
  return (
    <div className="hub-form-grid">
      <label className="pr-field">
        Metric
        <select
          value={value.metric}
          onChange={(e) => edit({ metric: e.target.value })}
        >
          {metrics.map(([key, label]) => (
            <option value={key} key={key}>
              {label}
            </option>
          ))}
          {workspace.kpis.map((k) => (
            <option key={k.id} value={k.key}>
              {k.name}
            </option>
          ))}
        </select>
      </label>
      <label className="pr-field">
        Scope
        <select
          value={value.scope}
          onChange={(e) =>
            edit({ scope: e.target.value as typeof value.scope })
          }
        >
          {[
            "practice",
            "all",
            "any",
            "average",
            "sum",
            "count",
            "percentage",
          ].map((x) => (
            <option key={x} value={x}>
              {x === "all"
                ? "All selected clinicians"
                : x === "any"
                  ? "Any selected clinician"
                  : x}
            </option>
          ))}
        </select>
      </label>
      <label className="pr-field">
        Comparison
        <select
          value={value.operator}
          onChange={(e) =>
            edit({ operator: e.target.value as typeof value.operator })
          }
        >
          {[
            ["gte", "At least"],
            ["gt", "Above"],
            ["lte", "At most"],
            ["lt", "Below"],
            ["eq", "Equal to"],
            ["between", "Between"],
            ["missing", "Missing data"],
          ].map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="pr-field">
        {value.compareTo === "previous" ||
        ["metric", "forecast", "budget"].includes(value.compareTo)
          ? "Difference from comparison"
          : "Threshold"}
        <input
          type="number"
          value={value.value}
          onChange={(e) => edit({ value: Number(e.target.value) })}
        />
      </label>
      <label className="pr-field">
        Upper bound / individual percentage threshold
        <input
          type="number"
          value={value.upper}
          onChange={(e) => edit({ upper: Number(e.target.value) })}
        />
      </label>
      <label className="pr-field">
        Consecutive periods
        <input
          type="number"
          min="1"
          max="60"
          value={value.periods}
          onChange={(e) => edit({ periods: Number(e.target.value) })}
        />
      </label>
      <label className="pr-field">
        Compare with
        <select
          value={value.compareTo}
          onChange={(e) =>
            edit({ compareTo: e.target.value as typeof value.compareTo })
          }
        >
          <option value="value">Fixed value</option>
          <option value="previous">Previous period + threshold</option>
          <option value="goal">Goal</option>
          <option value="metric">Another metric + difference</option>
          <option value="forecast" disabled={value.scope !== "practice"}>
            Active forecast + difference
          </option>
          <option
            value="budget"
            disabled={value.scope !== "practice" || value.metric !== "overhead"}
          >
            Operating budget + difference
          </option>
        </select>
      </label>
      {value.compareTo === "metric" && (
        <label className="pr-field">
          Comparison metric
          <select
            value={value.comparisonMetric ?? ""}
            onChange={(e) => edit({ comparisonMetric: e.target.value })}
          >
            <option value="">Select metric</option>
            {[
              ...metrics.map(([key, label]) => ({ key, name: label })),
              ...workspace.kpis.filter((k) => !k.archived),
            ].map((k) => (
              <option key={k.key} value={k.key}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="pr-field">
        Measurement
        <select
          value={value.measure ?? "value"}
          onChange={(e) =>
            edit({ measure: e.target.value as typeof value.measure })
          }
        >
          <option value="value">Current period</option>
          <option value="average">Rolling average</option>
          <option value="sum">Rolling total</option>
          <option value="change">Change over window</option>
          <option value="changePct">Percentage change over window</option>
        </select>
      </label>
      {value.measure && value.measure !== "value" && (
        <label className="pr-field">
          Window (reporting periods / forecast months)
          <input
            type="number"
            min="1"
            max="60"
            value={value.window ?? 1}
            onChange={(e) => edit({ window: Number(e.target.value) })}
          />
        </label>
      )}
      <label className="pr-field">
        Active from
        <input
          type="date"
          value={value.start ?? ""}
          onChange={(e) => edit({ start: e.target.value || null })}
        />
      </label>
      <label className="pr-field">
        Active through
        <input
          type="date"
          value={value.end ?? ""}
          onChange={(e) => edit({ end: e.target.value || null })}
        />
      </label>
      {value.scope !== "practice" && (
        <fieldset className="hub-span">
          <legend>Selected clinicians (none selected means all)</legend>
          <div className="hub-checks">
            {clinicians.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={value.clinicianIds.includes(c.id)}
                  onChange={(e) =>
                    edit({
                      clinicianIds: e.target.checked
                        ? [...value.clinicianIds, c.id]
                        : value.clinicianIds.filter((id) => id !== c.id),
                    })
                  }
                />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
