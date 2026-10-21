import { useId, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, GripVertical, RotateCcw, Settings2 } from "lucide-react";
import {
  moveSectionWidget, resizeSectionWidget, resolveSectionLayout, retainSectionWidgetPreferences,
  type SectionLayout, type SectionLayoutKey, type SectionWidgetSize,
} from "../../lib/section-widget-layout.ts";
import "./section-widget-grid.css";

const sectionLabels: Record<SectionLayoutKey, string> = {
  summary: "Overview", sessions: "Sessions", clinicians: "Team", money: "Money",
  marketing: "Growth", rooms: "Rooms", "current-goals": "Goals",
};

export type SectionWidgetItem = {
  id: string;
  title: string;
  content: ReactNode;
  defaultSize?: SectionWidgetSize;
};
export type SectionWidgetGridProps = {
  section: SectionLayoutKey;
  items: readonly SectionWidgetItem[];
  layout?: SectionLayout;
  onChange: (layout: SectionLayout | undefined) => void;
  /** Enable only when content does not already supply its own card. */
  styledCards?: boolean;
  disabled?: boolean;
  className?: string;
};

export function SectionWidgetGrid({ section, items, layout, onChange, styledCards = false, disabled = false, className = "" }: SectionWidgetGridProps) {
  const [editing, setEditing] = useState(false);
  const [announcement, announce] = useState("");
  const dragged = useRef<string | null>(null);
  const prefix = useId();
  const resolved = resolveSectionLayout(items, layout);
  const byId = new Map(items.map(item => [item.id, item]));
  const canEdit = editing && !disabled;
  function move(id: string, index: number) {
    const next = moveSectionWidget(resolved, id, index);
    if (next === resolved) return;
    onChange(retainSectionWidgetPreferences(next, layout));
    announce(`${byId.get(id)?.title} moved to position ${next.widgets.findIndex(widget => widget.id === id) + 1} of ${next.widgets.length}.`);
  }
  return <section className={`pw-section-widget-layout ${className}`} data-section={section} aria-label={`${sectionLabels[section]} widgets`}>
    <div className="pw-section-widget-toolbar">
      <button type="button" disabled={disabled} aria-pressed={editing} onClick={() => { setEditing(!editing); dragged.current = null; }}>
        {editing ? <Check aria-hidden="true" size={16} /> : <Settings2 aria-hidden="true" size={16} />}
        {editing ? "Done" : "Edit layout"}
      </button>
      {editing && <button type="button" disabled={disabled || layout === undefined} onClick={() => {
        dragged.current = null;
        onChange(undefined);
        announce("Default widget order and sizes restored.");
      }}><RotateCcw aria-hidden="true" size={16} />Reset layout</button>}
    </div>
    <div className="pw-section-widget-grid">
      {resolved.widgets.map((widget, index) => {
        const item = byId.get(widget.id)!;
        return <div key={item.id} className={`pw-section-widget pw-section-widget--${widget.size}${styledCards ? " pw-section-widget--card" : ""}`}
          data-widget-id={item.id} data-widget-size={widget.size}
          role="group" aria-label={item.title}
          onDragOver={event => { if (canEdit && dragged.current) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
          onDrop={event => {
            if (!canEdit || !dragged.current) return;
            event.preventDefault();
            move(dragged.current, index);
            dragged.current = null;
          }}>
          {editing && <div className="pw-section-widget-controls">
            <span className="pw-section-widget-title">{item.title}</span>
            <button type="button" disabled={disabled} draggable={canEdit} title={`Drag ${item.title}; use Alt+ArrowUp or Alt+ArrowDown to move`}
              aria-label={`Move ${item.title}`} onDragStart={event => {
                if (!canEdit) { event.preventDefault(); return; }
                dragged.current = item.id;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.id);
              }} onDragEnd={() => { dragged.current = null; }} onKeyDown={event => {
                if (!canEdit || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                event.preventDefault();
                move(item.id, index + (event.key === "ArrowUp" ? -1 : 1));
              }}><GripVertical aria-hidden="true" size={16} /></button>
            <button type="button" disabled={disabled} aria-disabled={index === 0} title={`Move ${item.title} up`} aria-label={`Move ${item.title} up`}
              onClick={() => { if (canEdit) move(item.id, index - 1); }}><ArrowUp aria-hidden="true" size={16} /></button>
            <button type="button" disabled={disabled} aria-disabled={index === resolved.widgets.length - 1} title={`Move ${item.title} down`} aria-label={`Move ${item.title} down`}
              onClick={() => { if (canEdit) move(item.id, index + 1); }}><ArrowDown aria-hidden="true" size={16} /></button>
            <label className="pw-section-widget-sr-only" htmlFor={`${prefix}-${index}-size`}>{item.title} size</label>
            <select id={`${prefix}-${index}-size`} disabled={disabled} value={widget.size} onChange={event => {
              onChange(retainSectionWidgetPreferences(resizeSectionWidget(resolved, item.id, event.target.value as SectionWidgetSize), layout));
              announce(`${item.title} size changed to ${event.target.value}.`);
            }}>
              <option value="small">Small</option><option value="medium">Medium</option><option value="wide">Wide</option>
            </select>
          </div>}
          <div className="pw-section-widget-content sw-content">{item.content}</div>
        </div>;
      })}
    </div>
    <span className="pw-section-widget-sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
  </section>;
}

export default SectionWidgetGrid;
