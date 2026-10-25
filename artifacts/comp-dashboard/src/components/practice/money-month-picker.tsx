import { useId } from "react";
import "./money-month-picker.css";

export const moneyMonthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function validMoneyMonth(value: string) { return /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value); }
export function shiftMoneyMonth(value: string, offset: number) {
  const index = Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1 + offset;
  if (!validMoneyMonth(value) || index < 12 || index > 9999 * 12 + 11) return value;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`;
}
/** View selection only: no workspace mutation, request or save callback. Parent owns selection across tabs. */
export default function MoneyMonthPicker({ value, today, onChange }: { value: string; today: string; onChange: (month: string) => void }) {
  const id = useId(), current = today.slice(0, 7);
  const selected = validMoneyMonth(value) ? value : current;
  const year = Number(selected.slice(0, 4)), month = Number(selected.slice(5, 7));
  // A rolling native year menu supports older/later years without a 10,000-option mobile picker.
  const years = Array.from({ length: Math.min(9999, year + 25) - Math.max(1, year - 25) + 1 }, (_, index) => Math.max(1, year - 25) + index);
  const previous = shiftMoneyMonth(selected, -1), next = shiftMoneyMonth(selected, 1);
  const select = (candidate: string) => { if (validMoneyMonth(candidate) && candidate !== selected) onChange(candidate); };
  return <div className="pw-money-month-control pw-money-month-picker" role="group" aria-labelledby={`${id}-label`}>
    <strong id={`${id}-label`} className="pw-money-month-label" aria-live="polite">{moneyMonthNames[month - 1]} {selected.slice(0, 4)}</strong>
    <label className="pw-draft-field"><span>Month</span><select aria-label="Money month" value={selected.slice(5, 7)} onChange={event => select(`${selected.slice(0, 4)}-${event.target.value}`)}>{moneyMonthNames.map((name, index) => <option key={name} value={String(index + 1).padStart(2, "0")}>{name}</option>)}</select></label>
    <label className="pw-draft-field"><span>Year</span><select aria-label="Money year" value={year} onChange={event => select(`${event.target.value.padStart(4, "0")}-${selected.slice(5, 7)}`)}>{years.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
    <button type="button" className="pw-button" aria-label="Previous Money month" disabled={previous === selected} onClick={() => select(previous)}>Previous</button>
    <button type="button" className="pw-button" aria-label="Next Money month" disabled={next === selected} onClick={() => select(next)}>Next</button>
    <button type="button" className="pw-button" onClick={() => select(shiftMoneyMonth(current, -1))}>Last month</button>
  </div>;
}
