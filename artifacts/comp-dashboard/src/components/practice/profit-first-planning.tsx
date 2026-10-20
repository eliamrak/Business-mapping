import { useEffect, useId, useState } from "react";
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
type NumericInputTarget = { value: string; validity?: { badInput: boolean } };
const parse = (value: string, maximum: number, badInput = false) => badInput ? undefined : !value.trim() ? null
  : Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= maximum ? Number(value) : undefined;

export default function ProfitFirstPlanning(props: ProfitFirstPlanningProps) {
  const [planning, setPlanning] = useState<MoneyPlanningSettings>(props.workspace.moneyPlanning ?? {});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inputId = useId();
  useEffect(() => { setPlanning(props.workspace.moneyPlanning ?? {}); }, [props.workspace.moneyPlanning]);
  const report = profitFirstPlanning({ ...props, workspace: { ...props.workspace, moneyPlanning: planning } });
  const [costDetailsOpen, setCostDetailsOpen] = useState(report.status === "incomplete");
  useEffect(() => {
    if (report.status === "incomplete") setCostDetailsOpen(true);
  }, [report.status]);
  const setFieldError = (key: string, message?: string) => setErrors(current => {
    const next = { ...current };
    if (message) next[key] = message; else delete next[key];
    return next;
  });
  const validate = (key: string, target: NumericInputTarget, maximum = 1e10) => {
    const value = parse(target.value, maximum, target.validity?.badInput);
    setFieldError(key, value === undefined ? maximum === Infinity
      ? "Enter a finite, nonnegative percentage, or leave blank for Unknown."
      : `Enter a finite, nonnegative amount up to ${maximum.toLocaleString("en-US")}, or leave blank for Unknown.` : undefined);
    return value;
  };
  const commit = (next: MoneyPlanningSettings, key: string) => {
    if (Object.keys(errors).length) return false;
    const result = moneyPlanningSchema.safeParse(next);
    if (!result.success) { setFieldError(key, "Enter finite, nonnegative planning amounts within the supported range."); return false; }
    if (JSON.stringify(next) === JSON.stringify(props.workspace.moneyPlanning ?? {})) return true;
    props.onPlanningChange?.(result.data);
    return true;
  };
  const clearDraft = (key: string) => setDrafts(current => { const copy = { ...current }; delete copy[key]; return copy; });
  const editNumber = (key: string, target: NumericInputTarget, update?: (current: MoneyPlanningSettings, value: number | null) => MoneyPlanningSettings, maximum = 1e10) => {
    const text = target.value;
    setDrafts(current => ({ ...current, [key]: text }));
    const value = validate(key, target, maximum);
    if (value !== undefined && update) setPlanning(current => update(current, value));
  };
  const stageNumber = (key: string, target: NumericInputTarget, maximum = 1e10) => {
    // A controlled rerender can clear native badInput; only a new valid edit clears its error.
    if (!errors[key] && validate(key, target, maximum) !== undefined && commit(planning, key)) clearDraft(key);
  };
  const errorProps = (key: string) => ({ "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `${inputId}-${key}` : undefined });
  const fieldError = (key: string) => errors[key] && <span id={`${inputId}-${key}`} role="alert" className="pf-deficit">{errors[key]}</span>;
  const presets = [
    { key: "building", name: "Building fund monthly contribution", bucket: "business-profit" as const, mode: "additional" as const },
    { key: "marketing", name: "Marketing monthly funding", bucket: "operating-expenses" as const, mode: "marketing-total" as const },
  ];
  const activeGoals = (planning.goals ?? []).filter(g => !g.archived);
  const presetGoals = presets.map(preset => ({ ...preset, goal: activeGoals.find(g => g.name === preset.name && g.mode === preset.mode && g.bucket === preset.bucket) }));
  const otherGoals = activeGoals.filter(g => !presetGoals.some(p => p.goal?.id === g.id));
  useUnsaved(Object.keys(drafts).length > 0 || JSON.stringify(planning) !== JSON.stringify(props.workspace.moneyPlanning ?? {}));
  const stageGoal = (key: string, previous: PlanningFundingGoal | undefined, name: string, bucket: PlanningBucket, mode: PlanningFundingGoal["mode"], target: NumericInputTarget) => {
    if (errors[key]) return;
    const amount = validate(key, target);
    if (amount === undefined) return;
    if (!previous && amount === null) { clearDraft(key); return; }
    const goal: PlanningFundingGoal = { ...previous, id: previous?.id ?? crypto.randomUUID(), name, bucket, mode, monthlyAmount: amount };
    const next = { ...planning, goals: [...(planning.goals ?? []).filter(g => g.id !== goal.id), goal] };
    if (commit(next, key)) {
      setPlanning(next);
      clearDraft(key);
    }
  };
  const estimateInput = (key: string, value: number | null, label: string, months = 1) => {
    const monthly = Object.hasOwn(planning.estimatedMonthlyValues ?? {}, key) ? planning.estimatedMonthlyValues![key] : value;
    const maximum = 1e10 * months;
    return <><input aria-label={label} type="number" min="0" max={maximum} step="any" {...errorProps(`estimate:${key}`)}
    value={drafts[`estimate:${key}`] ?? dollarInput(monthly === null ? null : monthly * months)}
    onChange={event => editNumber(`estimate:${key}`, event.target, (current, amount) => ({ ...current, estimatedMonthlyValues: { ...current.estimatedMonthlyValues, [key]: amount === null ? null : amount / months } }), maximum)}
    onBlur={event => stageNumber(`estimate:${key}`, event.target, maximum)}
    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />{fieldError(`estimate:${key}`)}</>;
  };
  return <section className="pf-planning" aria-label="Money planning estimates">
    <header><h2>Money planning estimates</h2><p>{report.sourcePeriod}</p></header>
    <div className="pf-summary">
      <div><span>Estimated monthly billed income</span><strong>{dollars(report.income)}</strong></div>
      <div><span>Monthly budget needed</span><strong>{dollars(report.totalMonthly)}</strong></div>
      <div><span>Required %</span><strong>{percent(report.totalPercent)}</strong></div>
    </div>
    {report.exceedsIncome && <p className="pf-deficit" role="status"><strong>Planned costs and goals exceed estimated income</strong><br />Estimated monthly shortfall: {dollars(report.shortfall)}{report.status === "incomplete" ? " or more; some assumptions are missing." : "."}</p>}
    <p>Estimated monthly revenue needed: <strong>{dollars(report.neededRevenue)}</strong>. Additional estimated revenue needed: <strong>{dollars(report.additionalRevenueNeeded)}</strong>.</p>
    {report.noFiniteRevenueSolution && <p className="pf-deficit">The percentage floors leave no room for fixed costs or additional goals. Higher revenue alone cannot fund this scenario.</p>}
    <div className="pf-table-scroll"><table>
      <caption>Monthly allocation planning</caption>
      <thead><tr><th scope="col">Bucket</th><th scope="col">Current %</th><th scope="col">Current allocation ($/month)</th><th scope="col">Budget needed ($/month)</th><th scope="col">Gap ($/month)</th><th scope="col">Required %</th><th scope="col">Scenario floor %</th></tr></thead>
      <tbody>{report.rows.map(row => {
        const gap = row.requiredMonthly === null || row.currentMonthly === null ? null : row.requiredMonthly - row.currentMonthly;
        return <tr key={row.key}>
        <th scope="row">{row.label}</th><td>{percent(row.currentPercent)}</td><td>{dollars(row.currentMonthly)}</td>
        <td>{dollars(row.requiredMonthly)}</td><td className={gap !== null && gap > 0 ? "pf-deficit" : undefined}>{dollars(gap)}</td>
        <td className={row.requiredPercent !== null && row.requiredPercent > 100 ? "pf-deficit" : undefined}>{percent(row.requiredPercent)}</td>
        <td><input aria-label={`${row.label} scenario percentage floor`} type="number" min="0" step="0.1" {...errorProps(`floor:${row.key}`)} value={drafts[`floor:${row.key}`] ?? row.scenarioPercent ?? ""}
          onChange={event => editNumber(`floor:${row.key}`, event.target, (current, amount) => ({ ...current, scenarioPercents: { ...current.scenarioPercents, [row.key]: amount } }), Infinity)}
          onBlur={event => stageNumber(`floor:${row.key}`, event.target, Infinity)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />{fieldError(`floor:${row.key}`)}</td>
      </tr>; })}</tbody>
    </table></div>
    <p>Owner payroll: <strong>{dollars(report.protectedErinMonthly)}</strong>/month (protected)<small>Configured recipient: {props.context.clinicians.find(person => person.id === props.workspace.settings.familyW2ClinicianId)?.label ?? "not selected"}. Owner salary belongs to Erin; co-owner distributions belong to Elia.</small></p>
    <fieldset className="pf-goals"><legend>Monthly funding goals</legend>
      {presetGoals.map(preset => <label key={preset.key}>{preset.name}<input aria-label={preset.name} type="number" min="0" max="10000000000" step="100" placeholder="Not configured" disabled={!props.onPlanningChange} {...errorProps(preset.key)}
        value={drafts[preset.key] ?? preset.goal?.monthlyAmount ?? ""}
        onChange={event => editNumber(preset.key, event.target)}
        onBlur={event => stageGoal(preset.key, preset.goal, preset.name, preset.bucket, preset.mode, event.target)}
        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />{fieldError(preset.key)}</label>)}
      {otherGoals.map(goal => <label key={goal.id}>{goal.name}<input aria-label={goal.name} type="number" min="0" max="10000000000" step="100" disabled={!props.onPlanningChange} {...errorProps(goal.id)}
        value={drafts[goal.id] ?? goal.monthlyAmount ?? ""}
        onChange={event => editNumber(goal.id, event.target)}
        onBlur={event => stageGoal(goal.id, goal, goal.name, goal.bucket, goal.mode, event.target)}
        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />{fieldError(goal.id)}</label>)}
    </fieldset>
    <details open={costDetailsOpen} onToggle={event => setCostDetailsOpen(event.currentTarget.open)}><summary>Cost estimates and source periods</summary>
      <div className="pf-estimates">
        <label>Monthly billed revenue estimate{estimateInput("revenue", report.revenue, "Monthly billed revenue estimate")}</label>
        {report.costs.map(cost => <label key={cost.key}>{cost.key === "taxObligations" ? "Quarterly tax planning estimate" : cost.label}
          {cost.key === "therapistPay" ? <strong>{dollars(cost.monthly)}</strong> : estimateInput(cost.key, cost.monthly, cost.key === "taxObligations" ? "Quarterly tax planning estimate" : cost.label, cost.key === "taxObligations" ? 3 : 1)}
          {cost.key === "taxObligations" && <small>Quarterly estimate divided by 3: {dollars(cost.monthly)}/month. Planning only; not a calculated tax liability.</small>}
          <small>{cost.source}</small>
        </label>)}
        <label>Total monthly clinician payroll estimate{estimateInput("clinicianPay", props.estimatedMonthlyValues?.clinicianPay ?? null, "Total monthly clinician payroll estimate")}</label>
        <label>Other monthly income estimate{estimateInput("otherIncome", report.otherIncome, "Other monthly income estimate")}</label>
      </div>
    </details>
    {report.reasons.length > 0 && <ul className="pf-limitations">{report.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
    <details><summary>Planning estimate assumptions</summary><ul>
      <li>Current allocation is Current % times the displayed estimated monthly billed income. Confirmed current percentages total 100%.</li>
      <li>Budget needed includes configured costs, funding goals and scenario floors. Gap is budget needed minus current allocation; a positive gap needs more funding. Required % is budget needed divided by estimated income.</li>
      <li>Configured Erin salary is included once in Owner payroll before optional goals. Elia distributions are separate funding goals.</li>
      <li>The quarterly tax editor saves one third as the existing monthly tax planning estimate. An absent estimate and absent tax budget remain Unknown; current 3% is an allocation, not a tax liability.</li>
      {report.assumptions.map(note => <li key={note}>{note}</li>)}</ul></details>
  </section>;
}
