import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { additionalWithholdingPctFromNet, clinicianModelAt, clinicianTermsAt, estimateW2NetPay, monthFlow, staffMemberAt, type Context, type Workspace } from "@workspace/practice/hub";

const currency = (value: number | null) => value === null
  ? "--"
  : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const label = (date: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
const shortDate = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));

type Person = Context["clinicians"][number];
type Staff = Context["staff"][number];
type StaffPatchOptions = {
  year: number;
  effectiveDate: string | null;
};
type Profile = Workspace["clinicians"][number];
type Budget = Workspace["budgets"][number];
type Campaign = Workspace["campaigns"][number];
type Fund = Workspace["allocations"][number];
type NumberSetting = "processingPct" | "processingFixedPerTransaction" |
  "processingTransactionsPerSession" | "ownerPayrollMonthly" | "ownerPayrollBurdenPct" |
  "overheadFloorMonthly" | "estimatedIncomeTaxPct";

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
  onStaffPatch: (member: Staff, patch: Partial<Staff>, options?: StaffPatchOptions) => Promise<void>;
  onBudgetPatch: (id: string, patch: Partial<Budget>) => void;
  onAddExpense: (start: string) => void;
  onAddMarketingCost: (start: string) => void;
  onCampaignPatch: (id: string, patch: Partial<Campaign>) => void;
  onAddCampaign: (start: string) => void;
  onNavigate: (section: "clinicians" | "sessions" | "marketing" | "budgets" | "summary") => void;
};

export default function MoneyFlowToday({
  workspace, context, today, onPayeeChange, onAllocationPercent, onDefaultAllocationPercent,
  onAddFund, onFundPatch, onFundRemove, onSettingNumber, onOverheadMode,
  onAverageRate, onClinicianModel, onPersonPatch, onStaffPatch, onBudgetPatch,
  onAddExpense, onAddMarketingCost, onCampaignPatch, onAddCampaign, onNavigate,
}: Props) {
  const [view, setView] = useState<"current" | "previous">("current");
  const [fundName, setFundName] = useState("");
  const [fundKind, setFundKind] = useState<"tax" | "reserve" | "distribution" | "retained">("reserve");
  const [fundPercent, setFundPercent] = useState("");
  const [changeError, setChangeError] = useState("");
  const [staffModes, setStaffModes] = useState<Record<number, { mode: "year" | "date"; date: string }>>({});
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
  const staffChangeFor = (member: Staff): StaffPatchOptions => {
    const id = member.id ?? 0;
    const mode = staffModes[id]?.mode ?? "year";
    const fallback = month > today ? month : today;
    const date = staffModes[id]?.date || fallback;
    const year = Number((mode === "date" ? date : month).slice(0, 4));
    return { year, effectiveDate: mode === "date" ? date : null };
  };
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
    !campaign.archived && !campaign.planningOnly && campaign.start !== null &&
    campaign.start <= latestDepositDate &&
    (!campaign.end || campaign.end >= month),
  );
  const campaignsMissingStart = workspace.campaigns.filter((campaign) =>
    !campaign.archived && !campaign.planningOnly && campaign.start === null &&
    ((campaign.monthlySpend ?? 0) > 0 ||
      (campaign.otherMonthlyCost ?? 0) > 0 ||
      campaign.method !== null),
  );
  const overheadNote = workspace.settings.overheadMode === "baseline"
    ? "Includes the remaining overhead estimate while your list is incomplete"
    : "Uses entered expenses only because expenses are marked complete";
  const profileFor = (person: Person) =>
    clinicianModelAt(workspace, person.id, latestDepositDate);
  const listedRateFor = (person: Person) =>
    clinicianTermsAt(workspace, person.id, latestDepositDate).sessionRate ??
    person.sessionRate;
  const payee = context.clinicians.find((person) => person.id === workspace.settings.familyW2ClinicianId);
  const payAsOf = flow.through ?? latestDepositDate;
  const payeeProfile = payee
    ? clinicianModelAt(workspace, payee.id, payAsOf) ?? undefined
    : undefined;
  const futurePayeeProfile = payee && flow.through
    ? workspace.terms.some((term) =>
        term.clinicianId === payee.id &&
        term.effectiveDate > payAsOf &&
        term.effectiveDate <= latestDepositDate &&
        (term.payMode !== null || term.payAmount !== null),
      )
    : false;
  const annualFamilySalary = payeeProfile?.payMode === "salary" ? payeeProfile.payAmount : 0;
  const estimatedNetCheck = Math.round(estimateW2NetPay(annualFamilySalary / 24, workspace.settings.estimatedIncomeTaxPct).net * 100) / 100;
  const currentAllocationRows = workspace.allocations.filter((row) => !row.archived && row.start <= latestDepositDate && (!row.end || row.end >= month));
  const defaultFunds = [
    { id: "tax", name: "Tax fund", key: "taxPct" as const, percent: workspace.settings.taxPct },
    { id: "reserve", name: "Business reserves", key: "reservePct" as const, percent: workspace.settings.reservePct },
    { id: "distribution", name: "Your distribution", key: "distributionPct" as const, percent: workspace.settings.distributionPct },
  ];
  const allocationTotal = currentAllocationRows.length
    ? currentAllocationRows.reduce((sum, row) => sum + row.percent, 0)
    : defaultFunds.reduce((sum, row) => sum + row.percent, 0);
  const distributionShare = currentAllocationRows.length
    ? currentAllocationRows.filter((row) => row.kind === "distribution").reduce((sum, row) => sum + row.percent, 0)
    : workspace.settings.distributionPct;
  const distributionNote = flow.profit === null
    ? "Enter sessions to estimate profit and distributions"
    : flow.profit <= 0
      ? "No positive profit to distribute this month"
      : distributionShare === 0
        ? "No share of profit assigned to your distribution above"
        : `Estimated from ${distributionShare}% of positive profit, not a recorded transfer`;
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
        <button type="button" aria-pressed={view === "current"} onClick={() => setView("current")}>This month</button>
        <button type="button" aria-pressed={view === "previous"} onClick={() => setView("previous")}>Last month</button>
      </div>
    </header>
    {changeError && <p className="pw-flow-warning" role="alert">{changeError}</p>}

    {flow.through ? <p className="pw-flow-status">Session revenue is estimated through {shortDate(flow.through)} from recorded sessions. Scheduled clinician and staff payroll runs through {shortDate(latestDepositDate)}; other costs follow the recorded-session span.</p>
      : <div className="pw-flow-notice">No completed session period overlaps {label(month)}. Session revenue and profit are unavailable; support staff costs run through {shortDate(latestDepositDate)} where configured. <button type="button" onClick={() => onNavigate("sessions")}>Open sessions <ChevronRight /></button></div>}
    {flow.splitPeriods && <p className="pw-flow-note">A biweekly period crosses the month boundary. Its sessions are divided by calendar days for this estimate.</p>}
    {flow.incompleteClinicians.length > 0 && flow.through && <p className="pw-flow-note">No sessions recorded through {shortDate(flow.through)} for {flow.incompleteClinicians.join(", ")}. Profit may be understated.</p>}

    <div className="pw-flow-statement">
      <div className="pw-flow-group-title">Income</div>
      <div className="pw-flow-row"><span>Estimated session revenue <small>{flow.sessions === null ? "No completed sessions yet" : `${flow.sessions.toFixed(1)} completed sessions, using average rates where entered; otherwise listed fees`}</small></span><strong>{currency(flow.revenue)}</strong></div>
      <Sources label="Rates behind session revenue">
        {people.map((person) => <SourceRow key={person.id} label={person.label}>
          <InlineNumber label={`${person.label} average earned per completed session`} value={profileFor(person)?.expectedSessionRevenue ?? listedRateFor(person)}
            prefix="$" onCommit={(rate) => onAverageRate(person, rate, month)} />
          {profileFor(person)?.expectedSessionRevenue !== null &&
            profileFor(person)?.expectedSessionRevenue !== undefined &&
            profileFor(person)?.expectedSessionRevenue !== listedRateFor(person) &&
            <button type="button" className="pw-flow-source-link" onClick={() => onAverageRate(person, listedRateFor(person), month)}>Use listed fee</button>}
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
      {payee && <div className="pw-flow-row"><span>{payee.label} - gross W2 pay <small>Scheduled salary is a business cost even when sessions vary</small></span><strong>-{currency(flow.familyGrossPay)}</strong></div>}
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
        {staff.map((member) => {
          const effective = staffMemberAt(workspace, member, latestDepositDate);
          const id = member.id ?? 0;
          const mode = staffModes[id]?.mode ?? "year";
          const date = staffModes[id]?.date || (month > today ? month : today);
          const year = Number(month.slice(0, 4));
          return <SourceRow key={member.id} label={member.label ?? `Staff ${member.id}`}>
            {effective.annualSalary !== null ? <InlineNumber label={`${member.label} annual salary`} value={effective.annualSalary ?? 0} prefix="$"
              onCommit={(annualSalary) => onStaffPatch(member, { annualSalary }, staffChangeFor(member))} /> : <>
                <InlineNumber label={`${member.label} hourly rate`} value={effective.hourlyRate ?? 0} prefix="$"
                  onCommit={(hourlyRate) => onStaffPatch(member, { hourlyRate }, staffChangeFor(member))} />
                <InlineNumber label={`${member.label} hours per week`} value={effective.hoursPerWeek ?? 0} suffix="hrs" max={168}
                  onCommit={(hoursPerWeek) => onStaffPatch(member, { hoursPerWeek }, staffChangeFor(member))} />
              </>}
            <select aria-label={`${member.label ?? "Staff"} rate timing`} value={mode}
              onChange={(event) => setStaffModes((current) => ({
                ...current,
                [id]: { mode: event.target.value as "year" | "date", date },
              }))}>
              <option value="year">All {year}</option>
              <option value="date">Starts on specific date</option>
            </select>
            {mode === "date" && <input className="pw-flow-date" type="date" aria-label={`${member.label ?? "Staff"} rate start date`} value={date}
              onChange={(event) => setStaffModes((current) => ({
                ...current,
                [id]: { mode: "date", date: event.target.value },
              }))} />}
          </SourceRow>;
        })}
      </Sources>}
      <div className="pw-flow-row"><span>Operating expenses <small>{overheadNote}</small></span><strong>-{currency(flow.overhead)}</strong></div>
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
        {campaignsMissingStart.map((campaign) => <p className="pw-flow-note" key={campaign.id}>
          {campaign.name || "Campaign"} has monthly spend or assumptions but no start date, so it is not included yet.
        </p>)}
        {campaigns.map((campaign) => <SourceRow key={campaign.id} label={<InlineText label="Campaign name" value={campaign.name} onCommit={(name) => onCampaignPatch(campaign.id, { name })} />}>
          <div className="pw-flow-mini-field"><small>Source</small><InlineText label={`${campaign.name || "Campaign"} source`} value={campaign.source}
            onCommit={(source) => onCampaignPatch(campaign.id, { source })} /></div>
          <div className="pw-flow-mini-field"><small>Ad spend / month</small><InlineNumber label={`${campaign.name || "Campaign"} monthly ad spend`} value={campaign.monthlySpend ?? 0} prefix="$"
            onCommit={(monthlySpend) => onCampaignPatch(campaign.id, { monthlySpend })} /></div>
          <div className="pw-flow-mini-field"><small>Other costs / month</small><InlineNumber label={`${campaign.name || "Campaign"} other monthly cost`} value={campaign.otherMonthlyCost ?? 0} prefix="$"
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
      <div className="pw-flow-section-heading"><div><h3>Family take-home</h3><p>Estimated net W2 pay plus your distribution</p></div></div>
      <label className="pw-flow-payee">Whose W2 pay counts toward family take-home?
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
      {payee && payeeProfile?.payMode !== "salary" && <p className="pw-flow-warning">Enter an annual salary below to estimate W2 pay.</p>}
      {payee && futurePayeeProfile && <p className="pw-flow-warning">A newer pay setup starts after {shortDate(payAsOf)} and is not included in this estimate yet.</p>}
      {payee && <>
        <div className="pw-flow-row"><span>Annual gross salary <small>Enter once; paid on the 15th and last day of each month</small></span>
          <InlineNumber label={`${payee.label} annual gross salary`} value={annualFamilySalary} prefix="$" onCommit={(amount) => onClinicianModel(payee, { payMode: "salary", payAmount: amount }, month)} /></div>
        <div className="pw-flow-row"><span>Typical net per paycheck <small>Enter the amount that reaches your account once to calibrate the estimate</small></span>
          <InlineNumber label={`${payee.label} typical net per paycheck`} value={estimatedNetCheck} prefix="$" onCommit={(net) => {
            const rate = additionalWithholdingPctFromNet(annualFamilySalary / 24, net);
            if (rate === null) { setChangeError("Enter annual salary first, then a net check no larger than gross pay after employee payroll tax."); return; }
            onSettingNumber("estimatedIncomeTaxPct", rate);
            setChangeError("");
          }} /></div>
        <div className="pw-flow-row"><span>{payee.label} - estimated gross W2 pay <small>Scheduled checks through {flow.through ? shortDate(flow.through) : label(month)}</small></span><strong>{currency(flow.familyGrossPay)}</strong></div>
        <div className="pw-flow-row"><span>Employee Social Security and Medicare <small>Approx. 7.65% of gross pay; separate from employer payroll costs</small></span><strong>-{currency(flow.estimatedEmployeePayrollTax)}</strong></div>
        <div className="pw-flow-row pw-flow-tax-row"><span>Other withholding and deductions <small>Calibrated from your typical net check; may include income tax, benefits or retirement</small>
          <InlineNumber label="Additional withholding and deductions percentage" value={workspace.settings.estimatedIncomeTaxPct} suffix="%" max={100} onCommit={(value) => onSettingNumber("estimatedIncomeTaxPct", value)} /></span>
          <strong>-{currency(flow.estimatedAdditionalWithholding)}</strong></div>
        <div className="pw-flow-row"><span>{payee.label} - estimated net W2 pay <small>No paycheck entry required</small></span><strong>{currency(flow.estimatedNetPay)}</strong></div>
      </>}
      <div className="pw-flow-row"><span>Your distribution <small>{distributionNote}</small></span><strong>{currency(flow.distribution)}</strong></div>
      <div className="pw-flow-row pw-flow-takehome"><span>Family take-home <small>{!payee
        ? "Select a W2 clinician to estimate net pay"
        : flow.familyTakeHome === null
          ? "Add recorded sessions to estimate the distribution and total"
          : "Estimated net W2 pay plus your distribution"}</small></span>
        <strong className={flow.familyTakeHome === null ? "pw-flow-missing" : undefined}>{flow.familyTakeHome === null
          ? payee ? "Waiting for sessions" : "Select W2 pay"
          : currency(flow.familyTakeHome)}</strong></div>
    </section>
    <div className="pw-flow-next"><button type="button" className="pw-text-button" onClick={() => onNavigate("summary")}>Next month and six-month forecast <ChevronRight /></button></div>
  </div>;
}
