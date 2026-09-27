import { useMemo, useState } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { monthFlow, type Context, type Workspace } from "@workspace/practice/hub";

const currency = (value: number | null) => value === null
  ? "--"
  : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const label = (date: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
const shortDate = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));

type Paycheck = Workspace["familyPaychecks"][number];
type Props = {
  workspace: Workspace;
  context: Context;
  today: string;
  onPayeeChange: (id: number | null) => void;
  onAddPaycheck: (paycheck: Paycheck) => void;
  onUpdatePaycheck: (id: string, patch: Partial<Paycheck>) => void;
  onRemovePaycheck: (id: string) => void;
  onAllocationPercent: (id: string, percent: number) => void;
  onDefaultAllocationPercent: (key: "taxPct" | "reservePct" | "distributionPct", percent: number) => void;
  onAddFund: (name: string, kind: "tax" | "reserve" | "distribution" | "retained", percent: number, start: string) => void;
  onEditFunds: () => void;
  onNavigate: (section: "clinicians" | "sessions" | "marketing" | "budgets" | "summary") => void;
  onLegacyPayrollChange: (amount: number) => void;
};

export default function MoneyFlowToday({
  workspace, context, today, onPayeeChange, onAddPaycheck, onUpdatePaycheck,
  onRemovePaycheck, onAllocationPercent, onDefaultAllocationPercent,
  onAddFund, onEditFunds, onNavigate, onLegacyPayrollChange,
}: Props) {
  const [view, setView] = useState<"current" | "previous">("current");
  const [depositDate, setDepositDate] = useState(today);
  const [depositAmount, setDepositAmount] = useState("");
  const [fundName, setFundName] = useState("");
  const [fundKind, setFundKind] = useState<"tax" | "reserve" | "distribution" | "retained">("reserve");
  const [fundPercent, setFundPercent] = useState("");
  const previous = new Date(today.slice(0, 7) + "-01T12:00:00Z");
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const month = view === "current" ? today.slice(0, 7) + "-01" : previous.toISOString().slice(0, 7) + "-01";
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const latestDepositDate = end < today ? end : today;
  const flow = useMemo(() => monthFlow(workspace, context, month, today), [workspace, context, month, today]);
  const payee = context.clinicians.find((person) => person.id === workspace.settings.familyW2ClinicianId);
  const payeeProfile = workspace.clinicians.find((profile) =>
    profile.clinicianId === payee?.id && profile.status !== "archived" &&
    profile.start <= latestDepositDate && (!profile.end || profile.end >= month),
  );
  const w2People = context.clinicians.filter((person) =>
    (person.goalId ?? null) === workspace.settings.teamId &&
    String(person.classification).toLowerCase() === "w2",
  );
  const deposits = workspace.familyPaychecks
    .filter((paycheck) => paycheck.clinicianId === workspace.settings.familyW2ClinicianId && paycheck.date >= month && paycheck.date <= latestDepositDate)
    .sort((a, b) => b.date.localeCompare(a.date));
  const currentAllocationRows = workspace.allocations.filter((row) => !row.archived && row.start <= latestDepositDate && (!row.end || row.end >= month));
  const defaultFunds = [
    { id: "tax", name: "Tax fund", key: "taxPct" as const, percent: workspace.settings.taxPct },
    { id: "reserve", name: "Business reserves", key: "reservePct" as const, percent: workspace.settings.reservePct },
    { id: "distribution", name: "Your distribution", key: "distributionPct" as const, percent: workspace.settings.distributionPct },
  ];
  const allocationTotal = currentAllocationRows.length
    ? currentAllocationRows.reduce((sum, row) => sum + row.percent, 0)
    : defaultFunds.reduce((sum, row) => sum + row.percent, 0);
  const canAdd = payee && depositDate >= month && depositDate <= latestDepositDate && depositAmount.trim() !== "" && Number.isFinite(Number(depositAmount)) && Number(depositAmount) >= 0;

  return <div className="pw-today-flow">
    <header className="pw-today-flow-header">
      <div><h2>Money flow</h2><p>Where {label(month)} stands so far</p></div>
      <div className="pw-segmented" role="group" aria-label="Money flow period">
        <button type="button" aria-pressed={view === "current"} onClick={() => { setView("current"); setDepositDate(today); }}>This month</button>
        <button type="button" aria-pressed={view === "previous"} onClick={() => { setView("previous"); setDepositDate(new Date(Date.UTC(Number(previous.toISOString().slice(0, 4)), Number(previous.toISOString().slice(5, 7)), 0)).toISOString().slice(0, 10)); }}>Last month</button>
      </div>
    </header>

    {flow.through ? <p className="pw-flow-status">Estimated through {shortDate(flow.through)} from recorded sessions. Costs are estimated for the same span.</p>
      : <div className="pw-flow-notice">No completed session period overlaps {label(month)}. Enter sessions to see an operating estimate. <button type="button" onClick={() => onNavigate("sessions")}>Open sessions <ChevronRight /></button></div>}
    {flow.splitPeriods && <p className="pw-flow-note">A biweekly period crosses the month boundary. Its sessions are divided by calendar days for this estimate.</p>}
    {flow.incompleteClinicians.length > 0 && flow.through && <p className="pw-flow-note">No sessions recorded through {shortDate(flow.through)} for {flow.incompleteClinicians.join(", ")}. Profit may be understated.</p>}

    <div className="pw-flow-statement">
      <div className="pw-flow-group-title">Income <button type="button" onClick={() => onNavigate("clinicians")}>Rates <ChevronRight /></button></div>
      <div className="pw-flow-row"><span>Estimated session revenue <small>{flow.sessions === null ? "No completed sessions yet" : `${flow.sessions.toFixed(1)} completed sessions, using average rates where entered; otherwise listed fees`}</small></span><strong>{currency(flow.revenue)}</strong></div>
      {flow.otherIncome !== 0 && <div className="pw-flow-row"><span>Other business income</span><strong>{currency(flow.otherIncome)}</strong></div>}
      <div className="pw-flow-group-title">Cost to run the practice <button type="button" onClick={() => onNavigate("budgets")}>Expenses <ChevronRight /></button></div>
      <div className="pw-flow-row"><span>Other clinician pay <small>Estimated from pay structures</small></span><strong>-{currency(flow.clinicianPay - flow.familyGrossPay)}</strong></div>
      {payee && <div className="pw-flow-row"><span>{payee.label} - gross W2 pay <small>Salary is a business cost even when sessions vary</small></span><strong>-{currency(flow.familyGrossPay)}</strong></div>}
      <div className="pw-flow-row"><span>Employer payroll costs</span><strong>-{currency(flow.employerBurden + flow.legacyOwnerBurden)}</strong></div>
      <div className="pw-flow-row"><span>Support staff</span><strong>-{currency(flow.staffPay)}</strong></div>
      <div className="pw-flow-row"><span>Operating expenses <small>Includes the remaining overhead estimate while your list is incomplete</small></span><strong>-{currency(flow.overhead)}</strong></div>
      <div className="pw-flow-row"><span>Marketing <button type="button" onClick={() => onNavigate("marketing")}>Review</button></span><strong>-{currency(flow.marketing)}</strong></div>
      <div className="pw-flow-row"><span>Payment processing</span><strong>-{currency(flow.processing)}</strong></div>
      {workspace.settings.ownerPayrollMonthly > 0 && <div className="pw-flow-row pw-flow-legacy"><span>Separate owner payroll <small>Remove this if it duplicates W2 clinician salary</small><input type="number" min="0" aria-label="Separate owner payroll per month" value={workspace.settings.ownerPayrollMonthly} onChange={(event) => onLegacyPayrollChange(Number(event.target.value))} /></span><strong>-{currency(flow.legacyOwnerPayroll)}</strong></div>}
      <div className="pw-flow-row pw-flow-profit"><span>Estimated business profit <small>After gross payroll and all operating costs; before moving money to funds</small></span><strong>{currency(flow.profit)}</strong></div>
    </div>

    <section className="pw-flow-funds">
      <div className="pw-flow-section-heading"><div><h3>Decide where profit goes</h3><p>Estimated allocations from positive profit, not confirmed bank transfers</p></div><button type="button" className="pw-button" onClick={onEditFunds}>Edit funds</button></div>
      {(currentAllocationRows.length ? currentAllocationRows.map((row) => ({ ...row, key: null as null })) : defaultFunds).map((row) => {
        const amount = flow.allocations.find((item) => item.id === row.id)?.amount ?? 0;
        return <div className="pw-flow-fund-row" key={row.id}>
          <span>{row.name}</span>
          <label><input type="number" min="0" max="100" value={row.percent} aria-label={`${row.name} share of profit`} onChange={(event) => row.key ? onDefaultAllocationPercent(row.key, Number(event.target.value)) : onAllocationPercent(row.id, Number(event.target.value))} />%</label>
          <strong>{flow.profit === null ? "--" : currency(amount)}</strong>
        </div>;
      })}
      {allocationTotal > 100 && <p className="pw-flow-warning">Fund shares exceed 100%. Reduce them before saving.</p>}
      <div className="pw-flow-fund-row pw-flow-remainder"><span>Unassigned profit (stays in the business)</span><span /><strong>{currency(flow.retained)}</strong></div>
      <div className="pw-flow-add-fund">
        <input aria-label="New fund name" placeholder="New fund name" value={fundName} onChange={(event) => setFundName(event.target.value)} />
        <select aria-label="New fund purpose" value={fundKind} onChange={(event) => setFundKind(event.target.value as typeof fundKind)}>
          <option value="reserve">Business savings</option>
          <option value="tax">Tax fund</option>
          <option value="retained">Business profit</option>
          <option value="distribution">Your distribution</option>
        </select>
        <label><input type="number" min="0" max="100" aria-label="New fund share of profit" placeholder="Share" value={fundPercent} onChange={(event) => setFundPercent(event.target.value)} />%</label>
        <button type="button" className="pw-button" disabled={!fundName.trim() || fundPercent === "" || !Number.isFinite(Number(fundPercent)) || Number(fundPercent) < 0 || Number(fundPercent) > 100 || allocationTotal + Number(fundPercent) > 100} onClick={() => { onAddFund(fundName.trim(), fundKind, Number(fundPercent), month); setFundName(""); setFundPercent(""); }}><Plus /> Add fund</button>
      </div>
    </section>

    <section className="pw-flow-family">
      <div className="pw-flow-section-heading"><div><h3>Family take-home</h3><p>Net W2 deposits plus your distribution, without counting payroll twice</p></div></div>
      <label className="pw-flow-payee">Whose W2 paycheck goes to the family?
        <select value={workspace.settings.familyW2ClinicianId ?? ""} onChange={(event) => onPayeeChange(event.target.value ? Number(event.target.value) : null)}>
          <option value="">Select a W2 clinician</option>
          {w2People.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
        </select>
      </label>
      {payee && String(payee.classification).toLowerCase() !== "w2" && <p className="pw-flow-warning">This clinician is no longer marked W2. Review their classification in Clinicians & pay.</p>}
      {payee && payeeProfile?.payMode !== "salary" && <p className="pw-flow-warning">This paycheck is selected for family take-home, but the clinician's pay structure is not set to salary. <button type="button" onClick={() => onNavigate("clinicians")}>Review pay structure <ChevronRight /></button></p>}
      <div className="pw-flow-row"><span>{payee?.label ?? "W2 owner"} - net deposited <small>Entered paycheck deposits through {shortDate(latestDepositDate)}; gross salary is already a business cost</small></span><strong>{currency(flow.netPayDeposited)}</strong></div>
      <div className="pw-flow-row"><span>Your distribution <small>Estimated from this month's positive profit</small></span><strong>{currency(flow.distribution)}</strong></div>
      <div className="pw-flow-row pw-flow-takehome"><span>Family take-home <small>Deposited pay plus estimated distribution</small></span><strong>{currency(flow.familyTakeHome)}</strong></div>
      <div className="pw-flow-deposits">
        <h4>Net paychecks deposited</h4>
        {deposits.map((paycheck) => <div className="pw-flow-deposit" key={paycheck.id}>
          <input type="date" aria-label="Paycheck deposit date" min={month} max={latestDepositDate} value={paycheck.date} onChange={(event) => onUpdatePaycheck(paycheck.id, { date: event.target.value })} />
          <label>$<input type="number" min="0" step="0.01" aria-label="Net paycheck deposited" value={paycheck.netAmount} onChange={(event) => onUpdatePaycheck(paycheck.id, { netAmount: Number(event.target.value) })} /></label>
          <button type="button" className="pw-icon" aria-label="Remove net paycheck" title="Remove paycheck" onClick={() => onRemovePaycheck(paycheck.id)}><Trash2 /></button>
        </div>)}
        <div className="pw-flow-deposit pw-flow-add-deposit">
          <input type="date" aria-label="New paycheck deposit date" min={month} max={latestDepositDate} value={depositDate} onChange={(event) => setDepositDate(event.target.value)} />
          <label>$<input type="number" min="0" step="0.01" placeholder="Net deposit" aria-label="New net paycheck amount" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} /></label>
          <button type="button" className="pw-button" disabled={!canAdd} onClick={() => { onAddPaycheck({ id: crypto.randomUUID(), clinicianId: payee!.id, date: depositDate, netAmount: Number(depositAmount) }); setDepositAmount(""); }}><Plus /> Add deposit</button>
        </div>
        {payee && !deposits.length && <p className="pw-flow-note">Enter a net paycheck to complete family take-home. Gross salary is already included in costs above.</p>}
      </div>
    </section>
    <div className="pw-flow-next"><button type="button" className="pw-text-button" onClick={() => onNavigate("summary")}>Next month and six-month forecast <ChevronRight /></button></div>
  </div>;
}
