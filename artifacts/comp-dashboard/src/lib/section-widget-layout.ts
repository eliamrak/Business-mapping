import type { SectionLayout, SectionLayoutKey, SectionLayouts, SectionWidgetSize } from "@workspace/practice/hub";

export type { SectionLayout, SectionLayoutKey, SectionLayouts, SectionWidgetSize };
export type SectionWidgetDefinition = { id: string; defaultSize?: SectionWidgetSize };

const sizes = new Set(["small", "medium", "wide"]);
const validSize = (size: unknown): size is SectionWidgetSize => typeof size === "string" && sizes.has(size);

/** Saved preferences order available widgets; they never define which content exists. */
export function resolveSectionLayout(items: readonly SectionWidgetDefinition[], layout?: SectionLayout): SectionLayout {
  const available = new Map(items.map(item => [item.id, item]));
  const seen = new Set<string>();
  const widgets: SectionLayout["widgets"] = [];
  if (layout?.version === 1 && Array.isArray(layout.widgets)) {
    for (const widget of layout.widgets) {
      const item = widget && available.get(widget.id);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      widgets.push({ id: item.id, size: validSize(widget.size) ? widget.size : item.defaultSize ?? "medium" });
    }
  }
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    widgets.push({ id: item.id, size: item.defaultSize ?? "medium" });
  }
  return { version: 1, widgets };
}

export function moveSectionWidget(layout: SectionLayout, id: string, targetIndex: number): SectionLayout {
  const index = layout.widgets.findIndex(widget => widget.id === id);
  if (index < 0 || !Number.isInteger(targetIndex)) return layout;
  const target = Math.max(0, Math.min(layout.widgets.length - 1, targetIndex));
  if (index === target) return layout;
  const widgets = [...layout.widgets];
  const [widget] = widgets.splice(index, 1);
  widgets.splice(target, 0, widget);
  return { version: 1, widgets };
}

export function resizeSectionWidget(layout: SectionLayout, id: string, size: SectionWidgetSize): SectionLayout {
  if (!validSize(size) || !layout.widgets.some(widget => widget.id === id && widget.size !== size)) return layout;
  return { version: 1, widgets: layout.widgets.map(widget => widget.id === id ? { ...widget, size } : widget) };
}

/** Keep preferences for temporarily hidden widgets, within the persisted schema bound. */
export function retainSectionWidgetPreferences(next: SectionLayout, previous?: SectionLayout): SectionLayout {
  const seen = new Set(next.widgets.map(widget => widget.id));
  const widgets = [...next.widgets];
  if (previous?.version === 1) for (const widget of previous.widgets) {
    if (seen.has(widget.id) || !validSize(widget.size)) continue;
    seen.add(widget.id);
    widgets.push(widget);
  }
  return { version: 1, widgets: widgets.slice(0, 64) };
}

/** Pass this patch to stageSettings so other sections retain their pending layouts. */
export function sectionLayoutSettingsPatch(
  settings: { sectionLayouts?: SectionLayouts }, section: SectionLayoutKey, layout: SectionLayout | undefined,
): { sectionLayouts: SectionLayouts } {
  const sectionLayouts = { ...settings.sectionLayouts };
  if (layout === undefined) delete sectionLayouts[section];
  else sectionLayouts[section] = layout;
  return { sectionLayouts };
}
