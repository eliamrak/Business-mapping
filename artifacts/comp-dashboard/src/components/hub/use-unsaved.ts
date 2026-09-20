import { useEffect } from "react";
export function useUnsaved(dirty: boolean) {
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        !dirty ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.button !== 0
      )
        return;
      const anchor = (event.target as HTMLElement).closest(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (
        anchor &&
        !anchor.download &&
        anchor.target !== "_blank" &&
        anchor.href !== location.href &&
        !window.confirm("Discard unsaved changes and leave this view?")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const discard = (event: Event) => {
      if (
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
