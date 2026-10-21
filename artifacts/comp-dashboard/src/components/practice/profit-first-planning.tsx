import { useEffect, useId, useState } from "react";
import { moneyPlanningSchema, type MoneyPlanningSettings } from "@workspace/practice/hub";
import { useUnsaved } from "@/components/hub/use-unsaved";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { profitFirstPlanning, type PlanningBucket, type PlanningFundingGoal, type ProfitFirstPlanningInput } from "@/lib/profit-first-planning";
import "./profit-first-planning.css";

export type ProfitFirstPlanningProps = ProfitFirstPlanningInput & {
  /** Stage this object in the parent's active workspace/draft. No writes occur here. */
  onPlanningChange?: (next: MoneyPlanningSettings) => void;
  onOpenBudget?: () => void;
  /** Funding editors belong in Goals; all supports combined editor integrations. */
  renderMode?: "allocations" | "funding" | "all";
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
  const [costDetailsOpen, setCostDetailsOpen] = useState(false);
  const setFieldError = (key: string, message?: string) => setErrors(current => {
    const next = { ...current };
    if (message) next[key] = message; else delete next[key];
    return next;
  });
  const validate = (key: string, target: NumericInputTarget, maximum = 1e10, required = false) => {
    const parsed = parse(target.value, maximum, target.validity?.badInput);
    const value = required && parsed === null ? undefined : parsed;
    setFieldError(key, value === undefined ? required ? "Enter a percentage from 0 to 100; this input is required." : maximum === Infinity
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
  const editNumber = (key: string, target: NumericInputTarget, update?: (current: MoneyPlanningSettings, value: number | null) => MoneyPlanningSettings, maximum = 1e10, required = false) => {
    const text = target.value;
    setDrafts(current => ({ ...current, [key]: text }));
    const value = validate(key, target, maximum, required);
    if (value !== undefined && update) setPlanning(current => update(current, value));
  };
  const stageNumber = (key: string, target: NumericInputTarget, maximum = 1e10, required = false) => {
    // A controlled rerender can clear native badInput; only a new valid edit clears its error.
    if (!errors[key] && validate(key, target, maximum, required) !== undefined && commit(planning, key)) clearDraft(key);
  };
  const errorProps = (key: string) => ({ "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `${inputId}-${key}` : undefined });
  const fieldError = (key: string) => errors[key] && <span id={`${inputId}-${key}`} role="alert" className="pf-deficit">{errors[key]}</span>;
  const presets = [
    { key: "building", name: "Building fund monthly contribution", bucket: "business-profit" as const, mode: "additional" as const },
    { key: "marketing", name: "Marketing monthly funding", bucket: "operating-expenses" as const, mode: "marketing-total" as const },
  ];
  const activeGoals = (planning.goals ?? []).filter(goal => !goal.archived);
  const presetGoals = presets.map(preset => ({ ...preset, goal: activeGoals.find(goal => goal.name === preset.name && goal.mode === preset.mode && goal.bucket === preset.bucket) }));
  const otherGoals = activeGoals.filter(goal => !presetGoals.some(preset => preset.goal?.id === goal.id));
  useUnsaved(Object.keys(drafts).length > 0 || JSON.stringify(planning) !== JSON.stringify(props.workspace.moneyPlanning ?? {}));
  const stageGoal = (key: string, previous: PlanningFundingGoal | undefined, name: string, bucket: PlanningBucket, mode: PlanningFundingGoal["mode"], target: NumericInputTarget) => {
    if (errors[key]) return;
    const amount = validate(key, target);
    if (amount === undefined) return;
    if (!previous && amount === null) { clearDraft(key); return; }
    const goal: PlanningFundingGoal = { ...previous, id: previous?.id ?? crypto.randomUUID(), name, bucket, mode, monthlyAmount: amount };
    const next = { ...planning, goals: [...(planning.goals ?? []).filter(existing => existing.id !== goal.id), goal] };
    if (commit(next, key)) { setPlanning(next); clearDraft(key); }
  };
  const estimateInput = (key: string, value: number | null, label: string, months = 1) => {
    const monthly = Object.hasOwn(planning.estimatedMonthlyValues ?? {}, key) ? planning.estimatedMonthlyValues![key] : value;
    const maximum = 1e10 * months;
    return <><input aria-label={label} type="number" min="0" max={maximum} step="any" placeholder="Unknown" disabled={!props.onPlanningChange} {...errorProps(`estimate:${key}`)}
    value={drafts[`estimate:${key}`] ?? dollarInput(monthly === null ? null : monthly * months)}
    onChange={event => editNumber(`estimate:${key}`, event.target, (current, amount) => ({ ...current, estimatedMonthlyValues: { ...current.estimatedMonthlyValues, [key]: amount === null ? null : amount / months } }), maximum)}
    onBlur={event => stageNumber(`estimate:${key}`, event.target, maximum)}
    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />{fieldError(`estimate:${key}`)}</>;
  };
  const help = (text: string) => <Popover><PopoverTrigger asChild><button type="button" className="pf-help" aria-label={`Help: ${text}`}>?</button></PopoverTrigger><PopoverContent className="pf-help-content" collisionPadding={12} aria-label="Planning explanation">{text}</PopoverContent></Popover>;
  const costValue = (key: string) => report.costs.find(cost => cost.key === key)?.monthly ?? null;
  const inlineCostKeys = ["overhead", "fees", "marketing", "taxObligations"];
  const secondaryReasons = report.reasons.filter(reason => reason !== "Quarterly tax planning estimate is missing."
    && reason !== "Monthly billed revenue estimate is missing."
    && !["overhead", "fees", "marketing"].some(key => costValue(key) === null && reason.startsWith(report.costs.find(cost => cost.key === key)!.label + ":")));
  const month = new Date(`${props.asOf.slice(0, 7)}-01T12:00:00Z`);
  const monthLabel = Number.isFinite(month.valueOf()) ? month.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }) : "Month unknown";
  const fundingInputs = <div className="pf-goals">
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
  </div>;
  if (props.renderMode === "funding") return <section className="pf-planning" aria-label="Monthly funding goals"><h2>Monthly funding goals</h2>{fundingInputs}</section>;
  return <section className="pf-planning" aria-label="Money planning estimates">
    <header><h2>{monthLabel} allocations</h2></header>
    <div className="pf-summary">
      <label><span>Billed revenue {help("Monthly billed revenue input. Other income is added to calculate total income.")}</span>{estimateInput("revenue", report.revenue, "Monthly billed revenue estimate")}{report.revenue === null && <small>Monthly billed revenue estimate is missing.</small>}</label>
      <div><span>Total income</span><strong>{dollars(report.income)}</strong></div>
      <div><span>Monthly budget needed</span><strong>{dollars(report.totalMonthly)}</strong></div>
      <div><span>Required %</span><strong>{percent(report.totalPercent)}</strong></div>
    </div>
    {report.currentPercentTotal > 100 && <p role="status" className="pf-deficit">Current allocations total {percent(report.currentPercentTotal)}. This exceeds 100%; each entered percentage is retained.</p>}
    {report.exceedsIncome && <p className="pf-deficit" role="status"><strong>Planned costs and goals exceed estimated income</strong><br />Estimated monthly shortfall: {dollars(report.shortfall)}{report.status === "incomplete" ? " or more; some assumptions are missing." : "."}</p>}
    <p>Estimated monthly revenue needed: <strong>{dollars(report.neededRevenue)}</strong>. Additional estimated revenue needed: <strong>{dollars(report.additionalRevenueNeeded)}</strong>.</p>
    {report.noFiniteRevenueSolution && <p className="pf-deficit">The percentage floors leave no room for fixed costs or additional goals. Higher revenue alone cannot fund this scenario.</p>}
    <div className="pf-table-scroll"><table role="table">
      <caption>Monthly allocation planning</caption>
      <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Bucket</th><th role="columnheader" scope="col">Current %</th><th role="columnheader" scope="col">Current allocation ($/month)</th><th role="columnheader" scope="col">Budget needed ($/month)</th><th role="columnheader" scope="col">Gap ($/month)</th><th role="columnheader" scope="col">Required %</th><th role="columnheader" scope="col">Planning inputs {help("Current % and minimum income share are your allocation choices. Budget needed, Gap and Required % are calculated from costs and goals.")}</th></tr></thead>
      <tbody role="rowgroup">{report.rows.map(row => {
        const gap = row.requiredMonthly === null || row.currentMonthly === null ? null : row.requiredMonthly - row.currentMonthly;
        return <tr key={row.key} role="row">
        <th scope="row" role="rowheader">{row.label}</th><td role="cell" data-label="Current %"><label className="pf-current-percent"><input aria-label={`${row.label} current allocation percentage`} type="number" min="0" max="100" step="any" required disabled={!props.onPlanningChange} {...errorProps(`current:${row.key}`)} value={drafts[`current:${row.key}`] ?? row.currentPercent}
          onChange={event => editNumber(`current:${row.key}`, event.target, (current, amount) => ({ ...current, currentPercents: { ...current.currentPercents, [row.key]: amount! } }), 100, true)}
          onBlur={event => stageNumber(`current:${row.key}`, event.target, 100, true)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /><span aria-hidden="true">%</span>{fieldError(`current:${row.key}`)}</label></td><td role="cell" data-label="Current allocation ($/month)">{dollars(row.currentMonthly)}</td>
        <td role="cell" data-label="Budget needed ($/month)">{dollars(row.requiredMonthly)}</td><td role="cell" data-label="Gap ($/month)" className={gap !== null && gap > 0 ? "pf-deficit" : undefined}>{dollars(gap)}</td>
        <td role="cell" data-label="Required %" className={row.requiredPercent !== null && row.requiredPercent > 100 ? "pf-deficit" : undefined}>{percent(row.requiredPercent)}</td>
        <td role="cell" data-label="Planning inputs" className="pf-inline-inputs"><label><span>Minimum income share % {help("Your choice: reserve at least this percentage of total monthly income for this bucket. For example, 5% of $10,000 is $500. Budget costs and funding goals can require more; this does not replace Current %.")}</span><input aria-label={`${row.label} scenario percentage floor`} type="number" min="0" step="0.1" placeholder="Unknown" disabled={!props.onPlanningChange} {...errorProps(`floor:${row.key}`)} value={drafts[`floor:${row.key}`] ?? row.scenarioPercent ?? ""}
          onChange={event => editNumber(`floor:${row.key}`, event.target, (current, amount) => ({ ...current, scenarioPercents: { ...current.scenarioPercents, [row.key]: amount } }), Infinity)}
          onBlur={event => stageNumber(`floor:${row.key}`, event.target, Infinity)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />{fieldError(`floor:${row.key}`)}</label>
          {row.key === "operating-expenses" && <>
            {props.costSource !== "budget" ? <>
              <label><span>Overhead estimate $</span>{estimateInput("overhead", costValue("overhead"), "Overhead set-aside estimate")}</label>
              <label><span>Processing estimate $</span>{estimateInput("fees", costValue("fees"), "Processing cost estimate")}</label>
              <label><span>Marketing estimate $</span>{estimateInput("marketing", costValue("marketing"), "Existing marketing estimate")}</label>
            </> : <>
            <div className="pf-cost-source"><span>Overhead (Budget source)</span><strong>{dollars(costValue("overhead"))}</strong></div>
            <div className="pf-cost-source"><span>Marketing (Budget source)</span><strong>{dollars(costValue("marketing"))}</strong></div>
            {props.onOpenBudget && <button type="button" className="pf-budget-link" onClick={props.onOpenBudget}>Open Budget</button>}
            <div className="pf-cost-source"><span>Processing (calculated estimate) {help("Configured percentage and fixed processing fees applied to estimated collections and payment transactions. Billed sessions and client charges do not establish actual processor fees.")}</span><strong>{dollars(costValue("fees"))}</strong></div>
            </>}
          </>}
          {row.key === "taxes" && <label><span>Quarterly taxes $ {help("Enter the quarterly tax amount. One third funds each month; no tax rate is assumed.")}</span>{estimateInput("taxObligations", costValue("taxObligations"), "Quarterly tax planning estimate", 3)}
            {costValue("taxObligations") === null && <small>Quarterly tax planning estimate is missing.</small>}
          </label>}
        </td>
      </tr>; })}</tbody>
    </table></div>
    {props.renderMode === "all" && <details><summary>Monthly funding goals</summary>{fundingInputs}</details>}
    <details open={costDetailsOpen} onToggle={event => setCostDetailsOpen(event.currentTarget.open)}><summary>Cost estimates and source periods</summary>
      <p>{report.sourcePeriod}</p>
      <div className="pf-estimates">
        {report.costs.map(cost => <label key={cost.key}>{cost.label}
          {cost.key === "therapistPay" || inlineCostKeys.includes(cost.key) ? <strong>{dollars(cost.monthly)}</strong> : estimateInput(cost.key, cost.monthly, cost.label)}
          <small>{cost.source}</small>
        </label>)}
        <label>Total monthly clinician payroll estimate{estimateInput("clinicianPay", props.estimatedMonthlyValues?.clinicianPay ?? null, "Total monthly clinician payroll estimate")}</label>
        <label>Other monthly income estimate{estimateInput("otherIncome", report.otherIncome, "Other monthly income estimate")}</label>
      </div>
    </details>
    {secondaryReasons.length > 0 && <details className="pf-limitations"><summary>Other missing inputs and assumptions ({secondaryReasons.length})</summary><ul>{secondaryReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></details>}
    <details><summary>Planning estimate assumptions</summary><ul>
      <li>Current allocation is Current % times the displayed estimated monthly billed income. Percentages are saved as entered, without normalization.</li>
      <li>Budget needed includes configured costs, funding goals and scenario floors. Gap is budget needed minus current allocation; a positive gap needs more funding. Required % is budget needed divided by estimated income.</li>
      <li>The quarterly tax editor saves one third as the existing monthly tax planning estimate. An absent estimate and absent tax budget remain Unknown; current 3% is an allocation, not a tax liability.</li>
      {report.assumptions.map(note => <li key={note}>{note}</li>)}</ul></details>
  </section>;
}
