import { useState, type ComponentProps, type ReactNode } from "react";
import { ProviderGrowthPanel } from "./provider-growth-panel";

type Props = ComponentProps<typeof ProviderGrowthPanel> & {
  practice: ReactNode;
  pending?: boolean;
  selectedId?: number | null;
  onSelect?: (id: number | null) => void;
};
/** A single selected outlook; source-entry editors remain explicitly practice-wide. */
export function GrowthScopeView({
  practice,
  pending,
  selectedId: controlled,
  onSelect,
  ...providerProps
}: Props) {
  const [localId, setLocalId] = useState<number | null>(null);
  const selectedId = controlled === undefined ? localId : controlled;
  const setSelectedId = onSelect ?? setLocalId;
  const selected = providerProps.model.rows.find(
    (row) => row.id === selectedId,
  );
  return (
    <>
      <div
        className="pw-contributor-tabs pw-growth-scope"
        role="group"
        aria-label="Growth scope"
      >
        <button
          type="button"
          aria-pressed={!selected}
          onClick={() => setSelectedId(null)}
        >
          Whole Practice
        </button>
        {providerProps.model.rows.map((row) => (
          <button
            type="button"
            key={row.id}
            aria-pressed={selected?.id === row.id}
            onClick={() => setSelectedId(row.id)}
          >
            {row.label}
          </button>
        ))}
      </div>
      {pending || !selected ? (
        practice
      ) : (
        <ProviderGrowthPanel
          {...providerProps}
          selectedProviderId={selected.id}
        />
      )}
    </>
  );
}
