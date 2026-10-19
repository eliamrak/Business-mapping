import { useEffect, useState } from "react";
import { moneyPlanningSchema, type MoneyPlanningSettings } from "@workspace/practice/hub";
import { useUnsaved } from "@/components/hub/use-unsaved";
import { profitFirstPlanning, type PlanningBucket, type PlanningFundingGoal, type ProfitFirstPlanningInput } from "@/lib/profit-first-planning";
import "./profit-first-planning.css";

export type ProfitFirstPlanningProps = ProfitFirstPlanningInput & {
  /** Stage this object in the parent's active workspace/draft. No writes occur here. */
  onPlanningChange?: (next: MoneyPlanningSettings) => void;
};
const dollars = (n: number | null) => n === null ? "Unknown" : (Math.abs(n) < 0.5 ? 0 : n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const dollarInput = (n: number | null) => n === null ? "" : (Math.abs(n) < 0.005 ? 0 : n).toFixed(2);
const percent = (n: number | null) => n === null ? "Unknown" : `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
const parse = (value: string) => value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export default function ProfitFirstPlanning(props: ProfitFirstPlanningProps) {
  const [planning, setPlanning] = useState<MoneyPlanningSettings>(props.workspace.moneyPlanning ?? {});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setPlanning(props.workspace.moneyPlanning ?? {}); }, [props.workspace.moneyPlanning]);
  const report = profitFirstPlanning({ ...props, workspace: { ...props.workspace, moneyPlanning: planning } });
  const commit = (next: MoneyPlanningSettings) => {
    const result = moneyPlanningSchema.safeParse(next);
    if (!result.success) { setError("Enter finite, nonnegative planning amounts within the supported range."); return false; }
    setError(null);
    if (JSON.stringify(next) === JSON.stringify(props.workspace.moneyPlanning ?? {})) return true;
    props.onPlanningChange?.(result.data);
    return true;
  };
  const setEstimate = (key: string, value: string) => setPlanning(current => ({ ...current, estimatedMonthlyValues: { ...current.estimatedMonthlyValues, [key]: parse(value) } }));
  const presets = [
    { key: "building", name: "Building fund monthly contribution", bucket: "business-profit" as const, mode: "additional" as const },
    { key: "marketing", name: "Marketing monthly funding", bucket: "operating-expenses" as const, mode: "marketing-total" as const },
  ];
  const activeGoals = (planning.goals ?? []).filter(g => !g.archived);
  const presetGoals = presets.map(preset => ({ ...preset, goal: activeGoals.find(g => g.name === preset.name && g.mode === preset.mode && g.bucket === preset.bucket) }));
  const otherGoals = activeGoals.filter(g => !presetGoals.some(p => p.goal?.id === g.id));
  const goalAmount = (key: string) => presetGoals.find(g => g.key === key)?.goal?.monthlyAmount ?? activeGoals.find(g => g.id === key)?.monthlyAmount ?? null;
  const rawGoalDirty = Object.entries(drafts).some(([key, text]) => text !== (goalAmount(key) === null ? "" : String(goalAmount(key))));
  useUnsaved(rawGoalDirty || JSON.stringify(planning) !== JSON.stringify(props.workspace.moneyPlanning ?? {}));
  const stageGoal = (key: string, previous: PlanningFundingGoal | undefined, name: string, bucket: PlanningBucket, mode: PlanningFundingGoal["mode"], text: string) => {
    if (!previous && !text.trim()) return;
    const amount = parse(text);
    if (amount === null && text.trim()) { setError("Enter a nonnegative monthly funding amount."); return; }
    const goal: PlanningFundingGoal = { ...previous, id: previous?.id ?? crypto.randomUUID(), name, bucket, mode, monthlyAmount: amount };
    const next = { ...planning, goals: [...(planning.goals ?? []).filter(g => g.id !== goal.id), goal] };
    if (commit(next)) {
      setPlanning(next);
      setDrafts(current => { const copy = { ...current }; delete copy[key]; return copy; });
    }
  };
  const estimateInput = (key: string, value: number | null) => <input type="number" min="0" max="10000000000" step="any"
    value={drafts[`estimate:${key}`] ?? dollarInput(Object.hasOwn(planning.estimatedMonthlyValues ?? {}, key) ? planning.estimatedMonthlyValues![key] : value)}
    onChange={event => { const text = event.target.value; setDrafts(current => ({ ...current, [`estimate:${key}`]: text })); setEstimate(key, text); }}
    onBlur={() => { if (commit(planning)) setDrafts(current => { const copy = { ...current }; delete copy[`estimate:${key}`]; return copy; }); }}
    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
  return <section className="pf-planning" aria-label="Money planning estimates">
    <header><h2>Money planning estimates</h2><p>{report.sourcePeriod}</p></header>
    <div className="pf-summary">
      <div><span>Estimated monthly billed income</span><strong>{dollars(report.income)}</strong></div>
      <div><span>Monthly costs and goals estimate</span><strong>{dollars(report.totalMonthly)}</strong></div>
      <div><span>Required share of estimated income</span><strong>{percent(report.totalPercent)}</strong></div>
    </div>
    {report.exceedsIncome && <p className="pf-deficit" role="status"><strong>Planned costs and goals exceed estimated income</strong><br />Estimated monthly shortfall: {dollars(report.shortfall)}{report.status === "incomplete" ? " or more; some assumptions are missing." : "."}</p>}
    <p>Estimated monthly revenue needed: <strong>{dollars(report.neededRevenue)}</strong>. Additional estimated revenue needed: <strong>{dollars(report.additionalRevenueNeeded)}</strong>.</p>
    {report.noFiniteRevenueSolution && <p className="pf-deficit">The percentage floors leave no room for fixed costs or additional goals. Higher revenue alone cannot fund this scenario.</p>}
    <div className="pf-table-scroll"><table>
      <caption>Monthly funding estimates; confirmed current allocation totals 100%</caption>
      <thead><tr><th scope="col">Bucket</th><th scope="col">Current %</th><th scope="col">Current estimate</th><th scope="col">Required %</th><th scope="col">Required estimate</th><th scope="col">Scenario floor %</th></tr></thead>
      <tbody>{report.rows.map(row => <tr key={row.key}>
        <th scope="row">{row.label}</th><td>{percent(row.currentPercent)}</td><td>{dollars(row.currentMonthly)}</td>
        <td className={row.requiredPercent !== null && row.requiredPercent > 100 ? "pf-deficit" : undefined}>{percent(row.requiredPercent)}</td><td>{dollars(row.requiredMonthly)}</td>
        <td><input aria-label={`${row.label} scenario percentage floor`} type="number" min="0" step="0.1" value={row.scenarioPercent ?? ""}
          onChange={event => setPlanning(current => ({ ...current, scenarioPercents: { ...current.scenarioPercents, [row.key]: parse(event.target.value) } }))}
          onBlur={() => commit(planning)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></td>
      </tr>)}</tbody>
    </table></div>
    <p>Protected configured Erin / co-owner salary estimate: <strong>{dollars(report.protectedErinMonthly)}</strong> per month, included once in Owner payroll before optional goals.</p>
    <fieldset className="pf-goals"><legend>Monthly funding goals</legend>
      {presetGoals.map(preset => <label key={preset.key}>{preset.name}<input type="number" min="0" max="10000000000" step="100" placeholder="Not configured" disabled={!props.onPlanningChange}
        value={drafts[preset.key] ?? preset.goal?.monthlyAmount ?? ""}
        onChange={event => setDrafts(current => ({ ...current, [preset.key]: event.target.value }))}
        onBlur={event => stageGoal(preset.key, preset.goal, preset.name, preset.bucket, preset.mode, event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>)}
      {otherGoals.map(goal => <label key={goal.id}>{goal.name}<input type="number" min="0" max="10000000000" step="100" disabled={!props.onPlanningChange}
        value={drafts[goal.id] ?? goal.monthlyAmount ?? ""}
        onChange={event => setDrafts(current => ({ ...current, [goal.id]: event.target.value }))}
        onBlur={event => stageGoal(goal.id, goal, goal.name, goal.bucket, goal.mode, event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>)}
    </fieldset>
    <details open={report.status === "incomplete"}><summary>Cost estimates and source periods</summary>
      <div className="pf-estimates">
        <label>Monthly billed revenue estimate{estimateInput("revenue", report.revenue)}</label>
        {report.costs.map(cost => <label key={cost.key}>{cost.label}
          {cost.key === "therapistPay" ? <strong>{dollars(cost.monthly)}</strong> : estimateInput(cost.key, cost.monthly)}
          <small>{cost.source}</small>
        </label>)}
        <label>Total monthly clinician payroll estimate{estimateInput("clinicianPay", props.estimatedMonthlyValues?.clinicianPay ?? null)}</label>
        <label>Other monthly income estimate{estimateInput("otherIncome", report.otherIncome)}</label>
      </div>
    </details>
    {error && <p role="alert" className="pf-deficit">{error}</p>}
    {report.reasons.length > 0 && <ul className="pf-limitations">{report.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
    <details><summary>Planning estimate assumptions</summary><ul>{report.assumptions.map(note => <li key={note}>{note}</li>)}</ul></details>
  </section>;
}
