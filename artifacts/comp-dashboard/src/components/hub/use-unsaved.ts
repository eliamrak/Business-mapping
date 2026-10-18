import { useEffect } from "react";
export function requiresUnsavedNavigationConfirm(event: MouseEvent, currentHref: string) {
  if (event.defaultPrevented || event.button !== 0) return false;
  const target = event.target as Element | null;
  const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
  const button = target?.closest?.("button") as HTMLButtonElement | null;
  const changesView = button && !button.disabled
    && button.getAttribute("aria-current") !== "page"
    && button.getAttribute("aria-selected") !== "true"
    && button.closest("[data-unsaved-navigation]");
  const leavesPage = anchor && !event.ctrlKey && !event.metaKey && !event.shiftKey
    && !anchor.download && anchor.target !== "_blank" && anchor.href !== currentHref;
  return !!(leavesPage || changesView);
}

export function useUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        requiresUnsavedNavigationConfirm(event, location.href) &&
        !window.confirm("Discard unsaved changes and leave this view?")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const discard = (event: Event) => {
      if (
        !event.defaultPrevented &&
        dirty &&
        !window.confirm("Discard unsaved changes and reload saved values?")
      )
        event.preventDefault();
    };
    addEventListener("beforeunload", unload);
    addEventListener("emc-discard", discard);
    document.addEventListener("click", navigate, true);
    return () => {
      removeEventListener("beforeunload", unload);
      removeEventListener("emc-discard", discard);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
}
