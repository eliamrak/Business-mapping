import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Menu, MoreHorizontal, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import "./mobile-workspace-controls.css";

export type MobileDestination = {
  id: string;
  label: string;
  selected?: boolean;
  onSelect: () => void;
};

export function MobileWorkspaceNavigation({ name, disabled, modes, sections, utilities, referenceHref }: {
  name: string;
  disabled: boolean;
  modes: MobileDestination[];
  sections: MobileDestination[];
  utilities: MobileDestination[];
  referenceHref?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px)");
    const close = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, []);
  const destinations = (items: MobileDestination[]) => items.map(item => <button type="button" key={item.id}
    disabled={disabled} aria-current={item.selected ? "page" : undefined}
    onClick={() => { item.onSelect(); setOpen(false); }}>{item.label}</button>);
  return <div className="pw-mobile-toolbar">
    <span className="pw-mobile-brand"><span aria-hidden="true">EMC</span><strong>{name}</strong></span>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild><button type="button" className="pw-mobile-control" aria-label="Open navigation" title="Navigation"><Menu aria-hidden="true" /></button></Dialog.Trigger>
      <Dialog.Portal>
      <Dialog.Overlay className="pw-mobile-navigation-overlay" />
      <Dialog.Content className="pw-mobile-navigation-sheet">
        <Dialog.Title>Navigation</Dialog.Title>
        <Dialog.Description className="sr-only">Practice pages and workspace settings</Dialog.Description>
        <nav aria-label="Mobile workspaces" data-unsaved-navigation>{destinations(modes)}</nav>
        <nav aria-label="Mobile practice sections" data-unsaved-navigation>{destinations(sections)}</nav>
        <nav aria-label="Mobile utilities" data-unsaved-navigation>{destinations(utilities)}
          {referenceHref && <a href={referenceHref} target="_blank" rel="noreferrer">Reference layout<span className="sr-only"> (opens in a new tab)</span></a>}
        </nav>
        <Dialog.Close className="pw-mobile-navigation-close" aria-label="Close navigation"><X aria-hidden="true" /></Dialog.Close>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}

export function MobilePageActions({ children, viewControl }: { children: ReactNode; viewControl?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return <div className="pw-page-actions-shell" onKeyDown={event => {
    if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className="pw-mobile-control pw-mobile-actions-trigger" title="Page actions"
      aria-label="Open page actions" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><MoreHorizontal aria-hidden="true" /></button>
    <div id={id} className={`pw-page-actions-content${open ? " pw-page-actions-content--open" : ""}`}>
      {viewControl && <div className="pw-mobile-view-control">{viewControl}</div>}
      {children}
    </div>
  </div>;
}

export function MobileContributorSelect({ label, names, value, onChange, compare, onCompare }: {
  label: string;
  names: string[];
  value: string;
  onChange: (name: string) => void;
  compare?: boolean;
  onCompare?: () => void;
}) {
  const id = useId();
  return <div className="pw-mobile-contributor">
    <label className="sr-only" htmlFor={id}>{label}</label>
    <select id={id} value={compare ? "__compare__" : value} onChange={event => {
      if (event.target.value === "__compare__") onCompare?.();
      else onChange(event.target.value);
    }}>
      {names.map(name => <option key={name} value={name}>{name}</option>)}
      {onCompare && <option value="__compare__">Compare clinicians</option>}
    </select>
  </div>;
}
