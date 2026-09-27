import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { monthFlow, type Context, type Workspace } from "@workspace/practice/hub";

const currency = (value: number | null) => value === null
  ? "--"
  : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const label = (date: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
const shortDate = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));

type Paycheck = Workspace["familyPaychecks"][number];
type Person = Context["clinicians"][number];
type Staff = Context["staff"][number];
type Profile = Workspace["clinicians"][number];
type Budget = Workspace["budgets"][number];
type Campaign = Workspace["campaigns"][number];
type Fund = Workspace["allocations"][number];
type NumberSetting = "processingPct" | "processingFixedPerTransaction" |
  "processingTransactionsPerSession" | "ownerPayrollMonthly" | "ownerPayrollBurdenPct" |
  "overheadFloorMonthly";

function InlineNumber({ label: name, value, onCommit, prefix, suffix, max = 1e10 }: {
  label: string;
  value: number;
  onCommit: (value: number) => void | Promise<void>;
  prefix?: string;
  suffix?: string;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState("");
  useEffect(() => setDraft(String(value)), [value]);
  async function commit() {
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next) || next < 0 || next > max) {
      setError(`Enter a number from 0 to ${max}.`);
      return;
    }
    if (next === value) { setError(""); return; }
    try { await onCommit(next); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this value."); }
  }
  return <label className="pw-flow-inline-number">
    {prefix && <b aria-hidden="true">{prefix}</b>}
    <input aria-label={name} type="number" min="0" max={max} step="any" value={draft}
      onChange={(event) => setDraft(event.target.value)} onBlur={() => void commit()}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setDraft(String(value)); setError(""); } }} />
    {suffix && <b aria-hidden="true">{suffix}</b>}
    {error && <small role="alert">{error}</small>}
  </label>;
}

function InlineText({ label: name, value, onCommit }: {
  label: string; value: string; onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input className="pw-flow-inline-text" aria-label={name} value={draft}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => { if (draft.trim() && draft.trim() !== value) onCommit(draft.trim()); else setDraft(value); }}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setDraft(value); }} />;
}

function Sources({ label: name, children }: { label: string; children: ReactNode }) {
  return <details className="pw-flow-sources"><summary>{name}<ChevronDown size={15} /></summary><div className="pw-flow-source-list">{children}</div></details>;
}

function SourceRow({ label: name, children }: { label: ReactNode; children: ReactNode }) {
  return <div className="pw-flow-source-row"><span>{name}</span><div>{children}</div></div>;
}

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
  onFundPatch: (id: string, patch: Partial<Fund>) => void;
  onFundRemove: (id: string) => void;
  onSettingNumber: (key: NumberSetting, value: number) => void;
  onOverheadMode: (mode: "baseline" | "detailed") => void;
  onAverageRate: (person: Person, rate: number | null, start: string) => void;
  onClinicianModel: (person: Person, patch: Partial<Profile>, start: string) => void;
  onPersonPatch: (person: Person, patch: Partial<Person>) => Promise<void>;
  onStaffPatch: (member: Staff, patch: Partial<Staff>) => Promise<void>;
  onBudgetPatch: (id: string, patch: Partial<Budget>) => void;
  onAddExpense: (start: string) => void;
  onAddMarketingCost: (start: string) => void;
  onCampaignPatch: (id: string, patch: Partial<Campaign>) => void;
  onAddCampaign: (start: string) => void;
  onNavigate: (section: "clinicians" | "sessions" | "marketing" | "budgets" | "summary") => void;
};

export default function MoneyFlowToday({
  workspace, context, today, onPayeeChange, onAddPaycheck, onUpdatePaycheck,
  onRemovePaycheck, onAllocationPercent, onDefaultAllocationPercent,
  onAddFund, onFundPatch, onFundRemove, onSettingNumber, onOverheadMode,
  onAverageRate, onClinicianModel, onPersonPatch, onStaffPatch, onBudgetPatch,
  onAddExpense, onAddMarketingCost, onCampaignPatch, onAddCampaign, onNavigate,
}: Props) {
  const [view, setView] = useState<"current" | "previous">("current");
  const [depositDate, setDepositDate] = useState(today);
  const [depositAmount, setDepositAmount] = useState("");
  const [fundName, setFundName] = useState("");
  const [fundKind, setFundKind] = useState<"tax" | "reserve" | "distribution" | "retained">("reserve");
  const [fundPercent, setFundPercent] = useState("");
  const [changeError, setChangeError] = useState("");
  const previous = new Date(today.slice(0, 7) + "-01T12:00:00Z");
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const month = view === "current" ? today.slice(0, 7) + "-01" : previous.toISOString().slice(0, 7) + "-01";
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const latestDepositDate = end < today ? end : today;
  const flow = useMemo(() => monthFlow(workspace, context, month, today), [workspace, context, month, today]);
  const people = context.clinicians.filter((person) =>
    (person.goalId ?? null) === workspace.settings.teamId,
  );
  const staff = context.staff.filter((member) =>
    (member.goalId ?? null) === workspace.settings.teamId,
  );
  const activeBudgets = workspace.budgets.filter((budget) =>
    !budget.archived && !budget.planningOnly && budget.start <= latestDepositDate &&
    (!budget.end || budget.end >= month),
  );
  const budgetKind = (budget: Budget) =>
    workspace.categories.find((category) => category.id === budget.categoryId)?.kind;
  const operatingBudgets = activeBudgets.filter((budget) =>
    ["expense", "facility"].includes(budgetKind(budget) ?? ""),
  );
  const marketingBudgets = activeBudgets.filter((budget) => budgetKind(budget) === "marketing");
  const incomeBudgets = activeBudgets.filter((budget) => budgetKind(budget) === "income");
  const campaigns = workspace.campaigns.filter((campaign) =>
    !campaign.archived && !campaign.planningOnly && campaign.start <= latestDepositDate &&
    (!campaign.end || campaign.end >= month),
  );
  const profileFor = (person: Person) => workspace.clinicians
    .filter((profile) => profile.clinicianId === person.id && profile.status === "active" &&
      profile.start <= latestDepositDate && (!profile.end || profile.end >= month))
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  const payee = context.clinicians.find((person) => person.id === workspace.settings.familyW2ClinicianId);
  const payeeProfile = payee ? profileFor(payee) : undefined;
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
  const payRow = (person: Person) => {
    const profile = profileFor(person);
    const mode = profile?.payMode ?? "existing_split";
    return <SourceRow label={person.label} key={person.id}>
      <select aria-label={`${person.label} pay method`} value={mode}
        onChange={(event) => onClinicianModel(person, { payMode: event.target.value as Profile["payMode"] }, month)}>
        <option value="existing_split">Session split</option>
        <option value="salary">Annual salary</option>
        <option value="hourly">Hourly</option>
        <option value="per_session">Per session</option>
      </select>
      {mode === "existing_split" ? <InlineNumber label={`${person.label} clinician share`} value={person.preCapClinicianSplit} suffix="%" max={100}
        onCommit={(share) => onPersonPatch(person, { preCapClinicianSplit: share, preCapPracticeSplit: 100 - share })} />
        : <InlineNumber label={`${person.label} ${mode === "salary" ? "annual salary" : mode === "hourly" ? "hourly rate" : "pay per session"}`}
          value={profile?.payAmount ?? 0} prefix="$"
          onCommit={(amount) => onClinicianModel(person, { payAmount: amount }, month)} />}
      {mode === "hourly" && <InlineNumber label={`${person.label} paid hours per week`} value={profile?.paidHoursPerWeek ?? 0}
        suffix="hrs" max={100} onCommit={(hours) => onClinicianModel(person, { paidHoursPerWeek: hours }, month)} />}
    </SourceRow>;
  };

  return <div className="pw-today-flow">
    <header className="pw-today-flow-header">
      <div><h2>Money flow</h2><p>Where {label(month)} stands so far</p></div>
      <div className="pw-segmented" role="group" aria-label="Money flow period">
        <button type="button" aria-pressed={view === "current"} onClick={() => { setView("current"); setDepositDate(today); }}>This month</button>
        <button type="button" aria-pressed={view === "previous"} onClick={() => { setView("previous"); setDepositDate(new Date(Date.UTC(Number(previous.toISOString().slice(0, 4)), Number(previous.toISOString().slice(5, 7)), 0)).toISOString().slice(0, 10)); }}>Last month</button>
      </div>
    </header>
    {changeError && <p className="pw-flow-warning" role="alert">{changeError}</p>}

    {flow.through ? <p className="pw-flow-status">Estimated through {shortDate(flow.through)} from recorded sessions. Costs are estimated for the same span.</p>
      : <div className="pw-flow-notice">No completed session period overlaps {label(month)}. Enter sessions to see an operating estimate. <button type="button" onClick={() => onNavigate("sessions")}>Open sessions <ChevronRight /></button></div>}
    {flow.splitPeriods && <p className="pw-flow-note">A biweekly period crosses the month boundary. Its sessions are divided by calendar days for this estimate.</p>}
    {flow.incompleteClinicians.length > 0 && flow.through && <p className="pw-flow-note">No sessions recorded through {shortDate(flow.through)} for {flow.incompleteClinicians.join(", ")}. Profit may be understated.</p>}

    <div className="pw-flow-statement">
      <div className="pw-flow-group-title">Income</div>
      <div className="pw-flow-row"><span>Estimated session revenue <small>{flow.sessions === null ? "No completed sessions yet" : `${flow.sessions.toFixed(1)} completed sessions, using average rates where entered; otherwise listed fees`}</small></span><strong>{currency(flow.revenue)}</strong></div>
      <Sources label="Rates behind session revenue">
        {people.map((person) => <SourceRow key={person.id} label={person.label}>
          <InlineNumber label={`${person.label} average earned per completed session`} value={profileFor(person)?.expectedSessionRevenue ?? person.sessionRate}
            prefix="$" onCommit={(rate) => onAverageRate(person, rate, month)} />
          {profileFor(person)?.expectedSessionRevenue !== null && profileFor(person)?.expectedSessionRevenue !== undefined &&
            <button type="button" className="pw-flow-source-link" onClick={() => onAverageRate(person, null, month)}>Use listed fee</button>}
        </SourceRow>)}
        <button type="button" className="pw-flow-source-link" onClick={() => onNavigate("sessions")}>Edit recorded sessions <ChevronRight size={14} /></button>
      </Sources>
      {(flow.otherIncome !== 0 || incomeBudgets.length > 0) && <>
        <div className="pw-flow-row"><span>Other business income</span><strong>{currency(flow.otherIncome)}</strong></div>
        <Sources label="Business income sources">
          {incomeBudgets.map((budget) => <SourceRow key={budget.id} label={<InlineText label="Income source name" value={budget.name} onCommit={(name) => onBudgetPatch(budget.id, { name })} />}>
            <InlineNumber label={`${budget.name} amount`} value={budget.amount} prefix="$"
              onCommit={(amount) => onBudgetPatch(budget.id, { amount })} />
            <span className="pw-flow-source-unit">{budget.cadence.replace("_", " ")}</span>
          </SourceRow>)}
        </Sources>
      </>}
      <div className="pw-flow-group-title">Cost to run the practice</div>
      <div className="pw-flow-row"><span>Other clinician pay <small>Estimated from pay structures</small></span><strong>-{currency(flow.clinicianPay - flow.familyGrossPay)}</strong></div>
      <Sources label="Clinician pay setup">{people.filter((person) => person.id !== payee?.id).map(payRow)}</Sources>
      {payee && <div className="pw-flow-row"><span>{payee.label} - gross W2 pay <small>Salary is a business cost even when sessions vary</small></span><strong>-{currency(flow.familyGrossPay)}</strong></div>}
      {payee && <Sources label={`${payee.label} pay setup`}>{payRow(payee)}</Sources>}
      <div className="pw-flow-row"><span>Employer payroll costs</span><strong>-{currency(flow.employerBurden + flow.legacyOwnerBurden)}</strong></div>
      <Sources label="Employer payroll rates">
        {people.filter((person) => String(person.classification).toLowerCase() === "w2").map((person) => <SourceRow label={person.label} key={person.id}>
          {(["w2EmployerFicaPct", "futaSutaPct", "workersCompPct", "otherEmployerBurdenPct"] as const).map((key) =>
            <div className="pw-flow-mini-field" key={key}><small>{key === "w2EmployerFicaPct" ? "FICA" : key === "futaSutaPct" ? "Unemployment" : key === "workersCompPct" ? "Workers comp" : "Other"}</small>
              <InlineNumber label={`${person.label} ${key}`} value={person[key]} suffix="%" max={100}
                onCommit={(value) => onPersonPatch(person, { [key]: value })} /></div>,
          )}
        </SourceRow>)}
        <SourceRow label="Separate owner payroll burden"><InlineNumber label="Separate owner payroll burden percentage" value={workspace.settings.ownerPayrollBurdenPct} suffix="%" max={100}
          onCommit={(value) => onSettingNumber("ownerPayrollBurdenPct", value)} /></SourceRow>
      </Sources>
      <div className="pw-flow-row"><span>Support staff</span><strong>-{currency(flow.staffPay)}</strong></div>
      {staff.length > 0 && <Sources label="Support staff pay">
        {staff.map((member) => <SourceRow key={member.id} label={member.label ?? `Staff ${member.id}`}>
          {member.annualSalary !== null ? <InlineNumber label={`${member.label} annual salary`} value={member.annualSalary ?? 0} prefix="$"
            onCommit={(annualSalary) => onStaffPatch(member, { annualSalary })} /> : <>
              <InlineNumber label={`${member.label} hourly rate`} value={member.hourlyRate ?? 0} prefix="$"
                onCommit={(hourlyRate) => onStaffPatch(member, { hourlyRate })} />
              <InlineNumber label={`${member.label} hours per week`} value={member.hoursPerWeek ?? 0} suffix="hrs" max={168}
                onCommit={(hoursPerWeek) => onStaffPatch(member, { hoursPerWeek })} />
            </>}
        </SourceRow>)}
      </Sources>}
      <div className="pw-flow-row"><span>Operating expenses <small>Includes the remaining overhead estimate while your list is incomplete</small></span><strong>-{currency(flow.overhead)}</strong></div>
      <Sources label="Operating expense sources">
        <div className="pw-flow-source-row"><span>Overhead basis</span><div className="pw-segmented" role="group" aria-label="Overhead basis">
          <button type="button" aria-pressed={workspace.settings.overheadMode === "baseline"} onClick={() => onOverheadMode("baseline")}>Keep estimate</button>
          <button type="button" aria-pressed={workspace.settings.overheadMode === "detailed"} onClick={() => onOverheadMode("detailed")}>Expenses complete</button>
        </div></div>
        {workspace.settings.overheadMode === "baseline" && <SourceRow label="Monthly overhead baseline"><InlineNumber label="Monthly overhead baseline" value={workspace.settings.overheadFloorMonthly} prefix="$"
          onCommit={(value) => onSettingNumber("overheadFloorMonthly", value)} /></SourceRow>}
        {operatingBudgets.map((budget) => <SourceRow key={budget.id} label={<InlineText label="Expense name" value={budget.name} onCommit={(name) => onBudgetPatch(budget.id, { name })} />}>
          <InlineNumber label={`${budget.name} amount`} value={budget.amount} prefix="$"
            onCommit={(amount) => onBudgetPatch(budget.id, { amount })} />
          <select aria-label={`${budget.name} billing frequency`} value={budget.cadence}
            onChange={(event) => onBudgetPatch(budget.id, { cadence: event.target.value as Budget["cadence"] })}>
            <option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option>
            <option value="annual">Annual</option><option value="once">One-time</option><option value="per_session">Per session</option>
            <option value="percent_revenue">% of revenue</option>
          </select>
          <input className="pw-flow-date" type="date" aria-label={`${budget.name} forecast start`} value={budget.start}
            onChange={(event) => onBudgetPatch(budget.id, { start: event.target.value })} />
        </SourceRow>)}
        <button type="button" className="pw-flow-source-link" onClick={() => onAddExpense(month)}><Plus size={15} /> Add expense</button>
      </Sources>
      <div className="pw-flow-row"><span>Marketing</span><strong>-{currency(flow.marketing)}</strong></div>
      <Sources label="Marketing spend and services">
        {campaigns.map((campaign) => <SourceRow key={campaign.id} label={<InlineText label="Campaign name" value={campaign.name} onCommit={(name) => onCampaignPatch(campaign.id, { name })} />}>
          <div className="pw-flow-mini-field"><small>Source</small><InlineText label={`${campaign.name} source`} value={campaign.source}
            onCommit={(source) => onCampaignPatch(campaign.id, { source })} /></div>
          <div className="pw-flow-mini-field"><small>Ad spend / month</small><InlineNumber label={`${campaign.name} monthly ad spend`} value={campaign.monthlySpend} prefix="$"
            onCommit={(monthlySpend) => onCampaignPatch(campaign.id, { monthlySpend })} /></div>
          <div className="pw-flow-mini-field"><small>Other costs / month</small><InlineNumber label={`${campaign.name} other monthly cost`} value={campaign.otherMonthlyCost} prefix="$"
            onCommit={(otherMonthlyCost) => onCampaignPatch(campaign.id, { otherMonthlyCost })} /></div>
        </SourceRow>)}
        {marketingBudgets.map((budget) => <SourceRow key={budget.id} label={<InlineText label="Marketing cost name" value={budget.name} onCommit={(name) => onBudgetPatch(budget.id, { name })} />}>
          <InlineNumber label={`${budget.name} marketing cost`} value={budget.amount} prefix="$"
            onCommit={(amount) => onBudgetPatch(budget.id, { amount })} />
          <span className="pw-flow-source-unit">{budget.cadence.replace("_", " ")}</span>
        </SourceRow>)}
        <div className="pw-flow-source-actions">
          <button type="button" className="pw-flow-source-link" onClick={() => onAddCampaign(month)}><Plus size={15} /> Add campaign</button>
          <button type="button" className="pw-flow-source-link" onClick={() => onAddMarketingCost(month)}><Plus size={15} /> Add service cost</button>
        </div>
      </Sources>
      <div className="pw-flow-row"><span>Payment processing</span><strong>-{currency(flow.processing)}</strong></div>
      <Sources label="Processing fee settings">
        <SourceRow label="Percentage per successful charge"><InlineNumber label="Processing percent" value={workspace.settings.processingPct} suffix="%" max={100}
          onCommit={(value) => onSettingNumber("processingPct", value)} /></SourceRow>
        <SourceRow label="Fixed fee per successful charge"><InlineNumber label="Processing fixed fee" value={workspace.settings.processingFixedPerTransaction} prefix="$"
          onCommit={(value) => onSettingNumber("processingFixedPerTransaction", value)} /></SourceRow>
        <SourceRow label="Charges per completed session"><InlineNumber label="Processing charges per session" value={workspace.settings.processingTransactionsPerSession} max={10}
          onCommit={(value) => onSettingNumber("processingTransactionsPerSession", value)} /></SourceRow>
      </Sources>
      <div className="pw-flow-row pw-flow-legacy"><span>Separate owner payroll <small>Monthly gross payroll not already included in clinician or staff pay</small></span>
        <div className="pw-flow-value-edit"><InlineNumber label="Separate owner payroll per month" value={workspace.settings.ownerPayrollMonthly} prefix="$"
          onCommit={(value) => onSettingNumber("ownerPayrollMonthly", value)} /><strong>-{currency(flow.legacyOwnerPayroll)}</strong></div></div>
      <div className="pw-flow-row pw-flow-profit"><span>Estimated business profit <small>After gross payroll and all operating costs; before moving money to funds</small></span><strong>{currency(flow.profit)}</strong></div>
    </div>

    <section className="pw-flow-funds">
      <div className="pw-flow-section-heading"><div><h3>Decide where profit goes</h3><p>Estimated shares of positive profit, not confirmed bank transfers</p></div></div>
      {currentAllocationRows.length ? currentAllocationRows.map((row) => <div className="pw-flow-fund-row" key={row.id}>
        <InlineText label={`${row.name} fund name`} value={row.name} onCommit={(name) => onFundPatch(row.id, { name })} />
        <select aria-label={`${row.name} purpose`} value={row.kind}
          onChange={(event) => onFundPatch(row.id, { kind: event.target.value as Fund["kind"], household: event.target.value === "distribution" })}>
          <option value="reserve">Business savings</option><option value="tax">Tax fund</option>
          <option value="retained">Business profit</option><option value="distribution">Your distribution</option>
        </select>
        <InlineNumber label={`${row.name} share of profit`} value={row.percent} suffix="%" max={100}
          onCommit={(percent) => onAllocationPercent(row.id, percent)} />
        <strong>{flow.profit === null ? "--" : currency(flow.allocations.find((item) => item.id === row.id)?.amount ?? 0)}</strong>
        <button type="button" className="pw-icon" aria-label={`Remove ${row.name} fund`} title={`Remove ${row.name}`} onClick={() => onFundRemove(row.id)}><Trash2 size={16} /></button>
      </div>) : defaultFunds.map((row) => <div className="pw-flow-fund-row" key={row.id}>
        <span>{row.name}</span><span className="pw-flow-source-unit">{row.id === "distribution" ? "Family" : "Business"}</span>
        <InlineNumber label={`${row.name} share of profit`} value={row.percent} suffix="%" max={100}
          onCommit={(percent) => onDefaultAllocationPercent(row.key, percent)} />
        <strong>{flow.profit === null ? "--" : currency(flow.allocations.find((item) => item.id === row.id)?.amount ?? 0)}</strong><span />
      </div>)}
      {allocationTotal > 100 && <p className="pw-flow-warning">Fund shares exceed 100%. Reduce them before saving.</p>}
      <div className="pw-flow-fund-row pw-flow-remainder"><span>{flow.profit !== null && flow.profit < 0 ? "Operating loss (no funds available)" : "Unassigned profit (stays in the business)"}</span><span /><span /><strong>{currency(flow.retained)}</strong><span /></div>
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
      <label className="pw-flow-payee">Whose paycheck counts toward family take-home?
        <select value={workspace.settings.familyW2ClinicianId ?? ""} onChange={(event) => onPayeeChange(event.target.value ? Number(event.target.value) : null)}>
          <option value="">Select a clinician</option>
          {people.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
        </select>
      </label>
      {payee && <SourceRow label={`${payee.label} employment type`}><select aria-label={`${payee.label} classification`} value={String(payee.classification).toLowerCase()}
        onChange={(event) => void onPersonPatch(payee, { classification: event.target.value as Person["classification"] })
          .then(() => setChangeError(""))
          .catch((cause) => setChangeError(cause instanceof Error ? cause.message : "Could not update employment type."))}>
        <option value="w2">W2 employee</option><option value="owner">Owner</option><option value="1099">1099 contractor</option>
      </select></SourceRow>}
      {payee && String(payee.classification).toLowerCase() !== "w2" && <p className="pw-flow-warning">Set the selected clinician to W2 for employer payroll costs to be included.</p>}
      {payee && payeeProfile?.payMode !== "salary" && <p className="pw-flow-warning">Set this clinician's pay method to Annual salary in the pay setup above.</p>}
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
