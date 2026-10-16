import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { RefreshCw } from "lucide-react";
import { compatibleReaderCapabilities } from "@/lib/reader-capabilities";

export function ReaderStatus() {
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState("Checking");
  useEffect(() => {
    let cancelled = false;
    setStatus("Checking");
    customFetch<unknown>("/api/practice-imports/capabilities", { method: "GET", cache: "no-store" })
      .then(value => { if (!cancelled) setStatus(compatibleReaderCapabilities(value) ? "Compatible" : "Unverified"); })
      .catch(() => { if (!cancelled) setStatus("Unavailable"); });
    return () => { cancelled = true; };
  }, [revision]);
  return <details className="pw-import-provenance" aria-label="Reader status">
    <summary>Reader status: <span role="status">{status}</span></summary>
    {status === "Compatible" && <dl>
      <dt>Protocol</dt><dd>legacy-codes-late-cancellation-v1</dd>
      <dt>Package version</dt><dd>1</dd>
      <dt>Late cancellation</dt><dd>Supported</dd>
      <dt>Code 0 duration</dt><dd>Unconfigured</dd>
      <dt>Code 0 encoding</dt><dd>0, distinct from 00000</dd>
    </dl>}
    <button type="button" className="pw-button pw-button-small" aria-label="Refresh reader status" title="Refresh reader status" disabled={status === "Checking"} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} aria-hidden="true" /></button>
  </details>;
}
