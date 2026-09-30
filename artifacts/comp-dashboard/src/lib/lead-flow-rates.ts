export function leadFlowRate(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null || denominator === 0) return "-";
  return `${Math.round(numerator / denominator * 100)}%`;
}

export function leadFlowRates(values: {
  leads: number | null;
  scheduled: number | null;
  attended: number | null;
  clients: number | null;
}) {
  return {
    scheduledConsult: leadFlowRate(values.scheduled, values.leads),
    show: leadFlowRate(values.attended, values.scheduled),
    consultClose: leadFlowRate(values.clients, values.attended),
    overallClose: leadFlowRate(values.clients, values.leads),
  };
}
