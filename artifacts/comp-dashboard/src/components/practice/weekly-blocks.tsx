import { Plus, X } from "lucide-react";

export type WeeklyBlock = {
  day: number;
  startHour: number;
  endHour: number;
  clinicianId?: number;
};

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const clock = (hour: number) =>
  `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;
const times = Array.from({ length: 97 }, (_, index) => index / 4);
const timeOptions = (value: number) =>
  [...new Set([...times, value])].sort((a, b) => a - b);

export default function WeeklyBlocks({
  blocks,
  onChange,
  people,
  label,
}: {
  blocks: WeeklyBlock[];
  onChange: (blocks: WeeklyBlock[]) => void;
  people?: { id: number; label: string }[];
  label: string;
}) {
  const change = (index: number, patch: Partial<WeeklyBlock>) =>
    onChange(
      blocks.map((block, i) => (i === index ? { ...block, ...patch } : block)),
    );
  return (
    <div className="pw-weekly">
      <div className="pw-weekly-title">
        <strong>{label}</strong>
        <button
          className="pw-text-button"
          type="button"
          disabled={!!people && !people.length}
          onClick={() => {
            const day =
              [1, 2, 3, 4, 5, 6, 0].find(
                (d) => !blocks.some((b) => b.day === d),
              ) ?? 1;
            onChange([
              ...blocks,
              {
                day,
                startHour: 9,
                endHour: 17,
                ...(people?.length ? { clinicianId: people[0].id } : {}),
              },
            ]);
          }}
        >
          <Plus />
          Add block
        </button>
      </div>
      {people && !people.length && (
        <p>Add a clinician before assigning room blocks.</p>
      )}
      {!blocks.length && <p>No recurring blocks entered.</p>}
      {blocks.map((block, index) => (
        <div
          className={"pw-weekly-row" + (people ? " pw-weekly-assigned" : "")}
          key={index}
        >
          <label>
            <span>Day</span>
            <select
              aria-label={`${label} block ${index + 1} day`}
              value={block.day}
              onChange={(event) =>
                change(index, { day: Number(event.target.value) })
              }
            >
              {days.map((day, i) => (
                <option key={day} value={i}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>From</span>
            <select
              aria-label={`${label} block ${index + 1} starts`}
              value={block.startHour}
              onChange={(event) =>
                change(index, { startHour: Number(event.target.value) })
              }
            >
              {timeOptions(block.startHour).map((time) => (
                <option key={time} value={time}>
                  {clock(time)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>To</span>
            <select
              aria-label={`${label} block ${index + 1} ends`}
              value={block.endHour}
              onChange={(event) =>
                change(index, { endHour: Number(event.target.value) })
              }
            >
              {timeOptions(block.endHour).map((time) => (
                <option key={time} value={time}>
                  {clock(time)}
                </option>
              ))}
            </select>
          </label>
          {people && (
            <label>
              <span>Clinician</span>
              <select
                aria-label={`${label} block ${index + 1} clinician`}
                value={block.clinicianId ?? ""}
                onChange={(event) =>
                  change(index, { clinicianId: Number(event.target.value) })
                }
              >
                {block.clinicianId &&
                  !people.some((person) => person.id === block.clinicianId) && (
                    <option value={block.clinicianId}>
                      Clinician #{block.clinicianId} (not on this team)
                    </option>
                  )}
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="pw-icon"
            type="button"
            title="Remove block"
            aria-label={`Remove ${label} block ${index + 1}`}
            onClick={() => onChange(blocks.filter((_, i) => i !== index))}
          >
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}
