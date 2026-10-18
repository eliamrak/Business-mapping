import test from "node:test";
import assert from "node:assert/strict";
import { requiresUnsavedNavigationConfirm } from "../components/hub/use-unsaved.ts";

const here = "http://127.0.0.1/workspace";
function click({ anchor = null, marked = true, disabled = false, active = false, selected = false, button = true, ...event } = {} as Record<string, unknown>) {
  const control = button ? { disabled, getAttribute: (key: string) => (key === "aria-current" && active ? "page" : key === "aria-selected" && selected ? "true" : null), closest: () => marked ? {} : null } : null;
  return { button: 0, defaultPrevented: false, ctrlKey: false, metaKey: false, shiftKey: false,
    target: { closest: (query: string) => query === "button" ? control : anchor }, ...event } as unknown as MouseEvent;
}

test("dirty-view navigation covers mouse, Enter-generated and modified button clicks", () => {
  assert.equal(requiresUnsavedNavigationConfirm(click(), here), true);
  assert.equal(requiresUnsavedNavigationConfirm(click({ detail: 0 }), here), true);
  assert.equal(requiresUnsavedNavigationConfirm(click({ ctrlKey: true }), here), true);
  assert.equal(requiresUnsavedNavigationConfirm(click({ shiftKey: true }), here), true);
});
test("ordinary commands, current destinations and disabled controls do not prompt", () => {
  for (const options of [{ marked: false }, { active: true }, { selected: true }, { disabled: true }, { button: false }, { defaultPrevented: true }, { button: false, target: null }])
    assert.equal(requiresUnsavedNavigationConfirm(click(options), here), false);
  assert.equal(requiresUnsavedNavigationConfirm({ ...click(), button: 1 }, here), false);
});
test("same-tab links prompt while new tabs, downloads and same-page links remain unchanged", () => {
  const anchor = { href: here + "/other", target: "", download: "" };
  assert.equal(requiresUnsavedNavigationConfirm(click({ button: false, anchor }), here), true);
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { anchor: { ...anchor, target: "_blank" } }, { anchor: { ...anchor, download: "export.json" } }, { anchor: { ...anchor, href: here } }])
    assert.equal(requiresUnsavedNavigationConfirm(click({ button: false, anchor, ...options }), here), false);
});
