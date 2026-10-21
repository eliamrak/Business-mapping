import test from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, sectionLayoutSchema, sectionLayoutsSchema, workspaceSchema } from "../../../../lib/practice/src/hub/index.ts";
import { moveSectionWidget, resizeSectionWidget, resolveSectionLayout, retainSectionWidgetPreferences, sectionLayoutSettingsPatch } from "./section-widget-layout.ts";

const items = [{ id: "a", defaultSize: "small" as const }, { id: "b" }, { id: "c", defaultSize: "wide" as const }];

test("defaults and saved preferences always render all available content once", () => {
  const defaults = resolveSectionLayout(items);
  assert.deepEqual(defaults.widgets, [{ id: "a", size: "small" }, { id: "b", size: "medium" }, { id: "c", size: "wide" }]);
  assert.deepEqual(resolveSectionLayout(items, { version: 1, widgets: [
    { id: "retired", size: "wide" }, { id: "b", size: "small" }, { id: "b", size: "wide" },
  ] }).widgets, [{ id: "b", size: "small" }, { id: "a", size: "small" }, { id: "c", size: "wide" }]);
  assert.deepEqual(resolveSectionLayout(items, { version: 2, widgets: [] } as never), defaults);
  assert.deepEqual(resolveSectionLayout(items, { version: 1, widgets: [{ id: "a", size: "giant" }] } as never), defaults);
  assert.deepEqual(resolveSectionLayout([], defaults), { version: 1, widgets: [] });
});

test("moves and resizing are bounded, immutable and retain every widget", () => {
  const layout = resolveSectionLayout(items);
  assert.deepEqual(moveSectionWidget(layout, "a", 99).widgets.map(widget => widget.id), ["b", "c", "a"]);
  assert.deepEqual(moveSectionWidget(layout, "c", -99).widgets.map(widget => widget.id), ["c", "a", "b"]);
  for (const [id, index] of [["missing", 1], ["a", 0], ["a", NaN]] as const) assert.equal(moveSectionWidget(layout, id, index), layout);
  assert.equal(resizeSectionWidget(layout, "missing", "wide"), layout);
  assert.equal(resizeSectionWidget(layout, "a", "giant" as never), layout);
  assert.equal(resizeSectionWidget(layout, "a", "wide").widgets[0].size, "wide");
  assert.equal(layout.widgets[0].size, "small");
});

test("edits retain hidden or retired preferences without consuming available widget slots", () => {
  const previous = { version: 1 as const, widgets: [{ id: "hidden", size: "wide" as const }, { id: "b", size: "small" as const }] };
  const edited = retainSectionWidgetPreferences(moveSectionWidget(resolveSectionLayout(items, previous), "b", 2), previous);
  assert.deepEqual(edited.widgets.map(widget => widget.id), ["a", "c", "b", "hidden"]);
  assert.equal(resolveSectionLayout([...items, { id: "hidden" }], edited).widgets.at(-1)?.size, "wide");
  const many = { version: 1 as const, widgets: Array.from({ length: 64 }, (_, index) => ({ id: `hidden-${index}`, size: "small" as const })) };
  const bounded = retainSectionWidgetPreferences(resolveSectionLayout(items), many);
  assert.equal(bounded.widgets.length, 64);
  assert.deepEqual(bounded.widgets.slice(0, 3), resolveSectionLayout(items).widgets);
  assert.equal(sectionLayoutSchema.safeParse(bounded).success, true);
});

test("staging and clearing one section preserves other pending layouts and settings", () => {
  const layout = resolveSectionLayout(items);
  const settings = { sectionLayouts: { summary: layout, marketing: layout }, horizonMonths: 24 };
  const patch = sectionLayoutSettingsPatch(settings, "summary", undefined);
  assert.deepEqual(patch, { sectionLayouts: { marketing: layout } });
  assert.equal(settings.sectionLayouts.summary, layout);
  const updated = { ...settings, ...sectionLayoutSettingsPatch(settings, "current-goals", layout) };
  assert.equal(updated.sectionLayouts.marketing, layout);
  assert.equal(updated.sectionLayouts["current-goals"], layout);
  assert.equal(updated.horizonMonths, 24);
  assert.deepEqual(sectionLayoutSettingsPatch({}, "summary", undefined), { sectionLayouts: {} });
});

test("optional section layouts round trip without changing existing settings", () => {
  const workspace = emptyWorkspace("2026-10-01");
  const settings = workspaceSchema.parse(workspace).settings;
  assert.equal(settings.sectionLayouts, undefined);
  workspace.settings.sectionLayouts = { summary: resolveSectionLayout(items) };
  const reopened = workspaceSchema.parse(JSON.parse(JSON.stringify(workspace)));
  assert.deepEqual(reopened.settings.sectionLayouts, workspace.settings.sectionLayouts);
  const { sectionLayouts, ...rest } = reopened.settings;
  assert.deepEqual(rest, settings);
  assert.deepEqual(sectionLayoutsSchema.parse({}), {});
});

test("schema validates version, partial section keys, bounded unique IDs and sizes", () => {
  const widgets = Array.from({ length: 64 }, (_, index) => ({ id: `widget-${index}`, size: "medium" }));
  assert.equal(sectionLayoutSchema.safeParse({ version: 1, widgets }).success, true);
  for (const layout of [
    { version: 2, widgets: [] }, { version: 1, widgets: [...widgets, { id: "extra", size: "wide" }] },
    { version: 1, widgets: [widgets[0], widgets[0]] },
    { version: 1, widgets: [{ id: " ", size: "small" }] },
    { version: 1, widgets: [{ id: "a", size: "giant" }] },
    { version: 1, widgets: [{ id: "x".repeat(161), size: "small" }] },
  ]) assert.equal(sectionLayoutSchema.safeParse(layout).success, false);
  assert.equal(sectionLayoutsSchema.safeParse({ unknown: { version: 1, widgets: [] } }).success, false);
  assert.equal(sectionLayoutsSchema.safeParse(Object.fromEntries(
    ["summary", "sessions", "clinicians", "money", "marketing", "rooms", "current-goals"].map(key => [key, { version: 1, widgets: [] }]),
  )).success, true);
});
