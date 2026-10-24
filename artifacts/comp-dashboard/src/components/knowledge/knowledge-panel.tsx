import { useId, useState } from "react";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, customFetch } from "@workspace/api-client-react";
import { knowledgeResponseSchema, type KnowledgeDocument, type knowledgeCategories } from "@workspace/practice/knowledge";
import "./knowledge-panel.css";

const tabs: Array<{ id: typeof knowledgeCategories[number]; label: string; empty: string }> = [
  { id: "operations", label: "Operations & SOPs", empty: "No approved SOPs yet. A current Practice SOP still needs to be selected." },
  { id: "archetypes", label: "Archetypes & Ideal Clients", empty: "Approved audience and ideal-client resources will appear here." },
  { id: "voice", label: "Copy & Brand Voice", empty: "Approved writing and brand references will appear here." },
  { id: "resources", label: "Resources & Visual Maps", empty: "The marriage map and private conflict-cycle resource are planned sources. Their content has not been imported." },
];
export function KnowledgeView({ documents, loading = false, error, retry }: {
  documents: KnowledgeDocument[]; loading?: boolean; error?: string; retry?: () => void;
}) {
  const [category, setCategory] = useState(tabs[0].id);
  const [selected, setSelected] = useState<string | null>(null);
  const id = useId();
  const visible = documents.filter(document => document.category === category);
  const current = visible.find(document => document.id === selected) ?? visible[0];
  const active = tabs.find(tab => tab.id === category)!;
  return <section className="pw-knowledge" aria-labelledby={`${id}-title`}>
    <header className="pw-knowledge-heading"><div><span className="pw-knowledge-eyebrow">Practice library</span><h2 id={`${id}-title`}>Knowledge</h2><p>A shared reference for how the practice works, who it serves, and how it communicates.</p></div><span className="pw-knowledge-private">Private · owner only</span></header>
    <aside className="pw-knowledge-status" aria-label="Knowledge connection status"><strong>Read-only foundation</strong><span>Google sync is not connected. Only explicitly approved resource versions appear here; drafts stay hidden.</span></aside>
    <div role="tablist" aria-label="Knowledge categories" className="pw-knowledge-tabs">{tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`${id}-${tab.id}`} aria-selected={category === tab.id} tabIndex={category === tab.id ? 0 : -1} aria-controls={`${id}-panel`} onClick={() => { setCategory(tab.id); setSelected(null); }} onKeyDown={event => {
      let next: number | undefined;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); setCategory(tabs[next].id); setSelected(null); document.getElementById(`${id}-${tabs[next].id}`)?.focus(); }
    }}>{tab.label}</button>)}</div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${category}`} tabIndex={0}>
      {loading ? <p role="status" className="pw-knowledge-empty">Loading approved resources…</p> : error ? <div role="alert" className="pw-knowledge-empty"><h3>Knowledge is not available yet</h3><p>{error}</p>{retry && <button type="button" onClick={retry}>Try again</button>}</div> : !current ? <div className="pw-knowledge-empty"><span className="pw-knowledge-empty-mark" aria-hidden="true">＋</span><h3>{active.label}</h3><p>{active.empty}</p><p>Nothing is published automatically. Source approval and read-only connection setup are still pending.</p></div> : <div className="pw-knowledge-content">
        <nav aria-label="Approved resources">{visible.map(document => <button key={document.id} type="button" aria-current={current.id === document.id ? "true" : undefined} onClick={() => setSelected(document.id)}>{document.title}<span>Version {document.version}</span></button>)}</nav>
        <article aria-label={current.title}><header><span className="pw-knowledge-eyebrow">Approved reference · version {current.version}</span><h3>{current.title}</h3><p>Approved {new Date(current.approvedAt).toLocaleDateString("en-US", { timeZone: "UTC" })}</p></header>
          {current.content.blocks.map((block, index) => block.kind === "heading" ? <h4 key={index}>{block.text}</h4> : <p key={index}>{block.text}</p>)}
          <footer>Read-only snapshot. Changes to the source do not publish here until a new version is approved.</footer>
        </article>
      </div>}
    </div>
    <footer className="pw-knowledge-footer">Practice metrics remain in their existing reports. This library does not query client, financial, or HR records.</footer>
  </section>;
}
export default function KnowledgePanel() {
  const { userId } = useAuth();
  const query = useQuery({ queryKey: ["knowledge", "approved", userId], enabled: !!userId, queryFn: async () => knowledgeResponseSchema.parse(await customFetch("/api/knowledge")), retry: false, staleTime: 0, gcTime: 0 });
  const unavailable = query.error instanceof ApiError && query.error.status === 403
    ? "Owner access is required. No resources have been loaded."
    : "The private Knowledge store has not been configured or cannot be reached. No resources have been loaded.";
  return <KnowledgeView documents={query.isError ? [] : query.data?.resources ?? []} loading={query.isPending} error={query.isError ? unavailable : undefined} retry={() => { void query.refetch(); }} />;
}
