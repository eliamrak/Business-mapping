import { useEffect, useState, useRef } from "react";
import {
  createGrowthResultCache,
  type GrowthSourceInput,
} from "../../lib/growth-result-cache";
import { ReviewedGrowthPanel } from "./reviewed-growth-panel";
import { GrowthScopeView } from "./growth-scope-view";
import type { GrowthSettings } from "../../lib/reviewed-growth-observations";
export function GrowthWorkspaceView({
  input,
  cache,
  compact,
  sourcePending,
  sourceError,
  onChange,
}: {
  input: GrowthSourceInput;
  cache: ReturnType<typeof createGrowthResultCache>;
  compact?: boolean;
  sourcePending: boolean;
  sourceError: boolean;
  onChange: (s: GrowthSettings) => void;
}) {
  const key = JSON.stringify(input);
  const focusAfter = useRef<{ aria: string | null; label?: string } | null>(
    null,
  );
  useEffect(() => {
    const listener = (event: Event) => {
      focusAfter.current = (event as CustomEvent).detail;
    };
    window.addEventListener("practice-growth-edit-focus", listener);
    return () =>
      window.removeEventListener("practice-growth-edit-focus", listener);
  }, []);
  const [state, setState] = useState<{
    key: string;
    result?: ReturnType<typeof cache.calculate>;
    error?: boolean;
  }>({ key: "" });
  const [scope, setScope] = useState<number | null>(null);
  useEffect(() => {
    if (sourcePending || sourceError) return;
    let cancelled = false;
    const hit = cache.get(key);
    if (hit) {
      setState({ key, result: hit });
      return;
    }
    // Let the genuine pending state paint before starting the synchronous engine.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        try {
          const result = cache.calculate(input, key);
          if (!cancelled) setState({ key, result });
        } catch {
          if (!cancelled) setState({ key, error: true });
        }
      }, 0);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [key, cache, sourcePending, sourceError]);
  useEffect(() => {
    if (state.key !== key || !state.result || !focusAfter.current) return;
    const target = focusAfter.current;
    focusAfter.current = null;
    const frame = requestAnimationFrame(() => {
      const match = [
        ...document.querySelectorAll<HTMLInputElement>("input"),
      ].find((el) =>
        target.aria
          ? el.getAttribute("aria-label") === target.aria
          : !!target.label &&
            el.closest("label")?.textContent?.trim() === target.label,
      );
      match?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [state, key]);
  if (sourceError)
    return (
      <section className="pw-metric-panel" role="status">
        Growth source refresh failed. Retry before relying on this forecast.
      </section>
    );
  if (sourcePending)
    return (
      <section className="pw-metric-panel" role="status" aria-busy="true">
        Updating growth sources…
      </section>
    );
  if (state.key !== key)
    return (
      <section className="pw-metric-panel" role="status" aria-busy="true">
        <span className="pw-growth-spinner" aria-hidden="true" /> Recalculating
        Growth…
      </section>
    );
  if (!state.result)
    return (
      <section className="pw-metric-panel" role="status">
        Growth calculation unavailable. Review source inputs and try again.
      </section>
    );
  const result = state.result;
  const practice = (
    <ReviewedGrowthPanel
      compact={compact}
      model={result}
      settings={input.settings}
      scenario={input.scenario}
      onChange={onChange}
    />
  );
  return compact ? (
    practice
  ) : (
    <GrowthScopeView
      selectedId={scope}
      onSelect={setScope}
      practice={practice}
      model={result.providers}
      settings={input.settings}
      scenario={input.scenario}
      staffingCandidates={result.staffingCandidates}
      onChange={onChange}
    />
  );
}
