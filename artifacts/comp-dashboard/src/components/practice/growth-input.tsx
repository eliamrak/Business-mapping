import {
  useEffect,
  useState,
  type InputHTMLAttributes,
  type ChangeEvent,
} from "react";
/** Commit numeric/month edits on blur or Enter, so recalculation cannot interrupt typing. */
export function GrowthInput({
  value,
  onChange,
  onBlur,
  onKeyDown,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  return (
    <input
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        if (String(draft) !== String(value ?? "")) {
          const next =
            e.relatedTarget instanceof HTMLInputElement
              ? e.relatedTarget
              : e.currentTarget;
          window.dispatchEvent(
            new CustomEvent("practice-growth-edit-focus", {
              detail: {
                aria: next.getAttribute("aria-label"),
                label: next.closest("label")?.textContent?.trim(),
              },
            }),
          );
          onChange?.(e as unknown as ChangeEvent<HTMLInputElement>);
        }
        setDraft(value ?? "");
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
