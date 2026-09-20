import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, type Clinician } from "@workspace/api-client-react";
import {
  sessionInputSchema,
  type SessionInput,
  type SessionRecord,
  type SessionWrite,
} from "@workspace/practice";
import { Save, ArrowLeft, LoaderCircle, RotateCcw, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { saveSessionRecord, sessionKey } from "@/lib/session-api";

interface Props {
  clinician: Clinician;
  record?: SessionRecord;
  range: { start: string; end: string };
  team: string;
  theme: string;
  onClose: () => void;
  onSaved: (record: SessionRecord) => void;
}
const fields = [
  ["completed", "Completed sessions", true],
  ["desired", "Desired sessions", true],
  ["cancelled", "Cancelled", false],
  ["noShow", "No-shows", false],
  ["scheduled", "Scheduled sessions", false],
  ["inPerson", "Completed in person", false],
  ["telehealth", "Completed by telehealth", false],
] as const;

export default function SessionEditor({
  clinician,
  record,
  range,
  team,
  theme,
  onClose,
  onSaved,
}: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => ({
    start: record?.start ?? range.start,
    end: record?.end ?? range.end,
    completed: record ? String(record.completed) : "",
    desired: record ? String(record.desired) : "",
    cancelled: record?.cancelled == null ? "" : String(record.cancelled),
    noShow: record?.noShow == null ? "" : String(record.noShow),
    scheduled: record?.scheduled == null ? "" : String(record.scheduled),
    inPerson: record?.inPerson == null ? "" : String(record.inPerson),
    telehealth: record?.telehealth == null ? "" : String(record.telehealth),
  }));
  const original = useRef(JSON.stringify(form));
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = JSON.stringify(form) !== original.current;
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [review, setReview] = useState<SessionInput | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState(false);
  const request = useRef<SessionWrite | null>(null);
  const save = useMutation({ mutationFn: saveSessionRecord, retry: false });

  useEffect(() => {
    formRef.current
      ?.querySelector<HTMLInputElement>('[aria-invalid="true"]')
      ?.focus();
  }, [issues]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || save.isPending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, save.isPending]);

  function finishClose() {
    if (request.current)
      void queryClient.invalidateQueries({ queryKey: sessionKey(team) });
    onClose();
  }
  function close() {
    if (save.isPending) return;
    if (dirty || request.current) setDiscardOpen(true);
    else finishClose();
  }
  function prepare(event: React.FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    for (const [key, , required] of fields)
      if (required && form[key].trim() === "")
        errors[key] = "Enter a total, including zero if none occurred.";
    const parsed = sessionInputSchema.safeParse({
      clinicianId: clinician.id,
      start: form.start,
      end: form.end,
      completed: Number(form.completed),
      desired: Number(form.desired),
      cancelled: form.cancelled.trim() === "" ? null : Number(form.cancelled),
      noShow: form.noShow.trim() === "" ? null : Number(form.noShow),
      scheduled: form.scheduled.trim() === "" ? null : Number(form.scheduled),
      inPerson: form.inPerson.trim() === "" ? null : Number(form.inPerson),
      telehealth:
        form.telehealth.trim() === "" ? null : Number(form.telehealth),
    });
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        errors[String(issue.path[0])] = issue.message;
    setIssues(errors);
    if (Object.keys(errors).length || !parsed.success) return;
    if (
      request.current &&
      JSON.stringify(request.current.entry) !== JSON.stringify(parsed.data)
    ) {
      setSaveError(
        "The previous save was not confirmed. Retry that save or close this window and reload the saved period before changing it.",
      );
      return;
    }
    setReview(parsed.data);
    setConflict(false);
  }
  async function commit() {
    if (!review || save.isPending) return;
    request.current ??= {
      requestId: crypto.randomUUID(),
      expectedRevision: record?.revision ?? null,
      entry: review,
    };
    setSaveError("");
    try {
      const saved = await save.mutateAsync(request.current);
      queryClient.setQueryData<SessionRecord[]>(sessionKey(team), (old) => [
        ...(old ?? []).filter((row) => row.id !== saved.id),
        saved,
      ]);
      void queryClient.invalidateQueries({ queryKey: sessionKey(team) });
      void queryClient.invalidateQueries({
        queryKey: ["session-history", saved.id],
      });
      onSaved(saved);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : null;
      const body =
        error instanceof ApiError
          ? (error.data as { error?: string } | null)
          : null;
      setSaveError(
        body?.error ??
          "Save not confirmed. Your numbers are still here. Retry to safely check or finish this save.",
      );
      setConflict(status === 409 || status === 404);
      if (status === 400 || status === 409 || status === 404)
        request.current = null;
    }
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          className="practice-theme practice-dialog"
          data-appearance={theme}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            close();
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {review
                ? "Review session totals"
                : record
                  ? "Correct session totals"
                  : "Record sessions"}
            </DialogTitle>
            <DialogDescription>
              {clinician.label}
              {record ? ` / Revision ${record.revision}` : " / New period"}
            </DialogDescription>
          </DialogHeader>
          {review ? (
            <div>
              <p className="pr-review-period">
                {review.start} to {review.end}
              </p>
              <dl className="pr-review">
                {fields.map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {record && record[key] !== review[key] && (
                        <del>{record[key] ?? "Not entered"}</del>
                      )}
                      {review[key] ?? "Not entered"}
                    </dd>
                  </div>
                ))}
              </dl>
              {review.completed > review.desired && (
                <p className="pr-note">
                  Completed sessions exceed the desired total. Confirm that both
                  numbers are correct.
                </p>
              )}
              {saveError && (
                <p role="alert" className="pr-error">
                  {saveError}
                </p>
              )}
              {conflict && (
                <p className="pr-note">
                  Close this entry to refresh the saved record. Your changes
                  have not overwritten it.
                </p>
              )}
              <div className="pr-dialog-actions">
                <button
                  className="pr-button"
                  onClick={() => {
                    setReview(null);
                    setSaveError("");
                  }}
                  disabled={save.isPending || !!request.current}
                >
                  <ArrowLeft />
                  Back
                </button>
                {conflict ? (
                  <button
                    className="pr-button"
                    onClick={() => {
                      void queryClient.invalidateQueries({
                        queryKey: sessionKey(team),
                      });
                      close();
                    }}
                  >
                    <RotateCcw />
                    Close and refresh
                  </button>
                ) : (
                  <button
                    className="pr-button pr-primary"
                    onClick={commit}
                    disabled={save.isPending}
                  >
                    {save.isPending ? (
                      <LoaderCircle className="pr-spin" />
                    ) : saveError ? (
                      <RotateCcw />
                    ) : (
                      <Save />
                    )}
                    {save.isPending
                      ? "Saving..."
                      : saveError
                        ? "Retry save"
                        : "Save totals"}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <form ref={formRef} onSubmit={prepare} noValidate>
              <div className="pr-form-grid">
                {(["start", "end"] as const).map((key) => (
                  <label key={key} className="pr-field">
                    {key === "start" ? "Period start" : "Period end"}
                    <input
                      type="date"
                      required
                      disabled={!!record}
                      value={form[key]}
                      aria-invalid={!!issues[key]}
                      aria-describedby={
                        issues[key] ? `error-${key}` : undefined
                      }
                      onChange={(event) =>
                        setForm({ ...form, [key]: event.target.value })
                      }
                    />
                    {issues[key] && (
                      <span id={`error-${key}`} className="pr-field-error">
                        {issues[key]}
                      </span>
                    )}
                  </label>
                ))}
                {fields.map(([key, label, required]) => (
                  <label key={key} className="pr-field">
                    {label}
                    {!required && <small>Optional</small>}
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="10000"
                      step="1"
                      required={required}
                      value={form[key]}
                      placeholder={required ? "" : "Not entered"}
                      aria-label={label}
                      aria-invalid={!!issues[key]}
                      aria-describedby={
                        issues[key] ? `error-${key}` : undefined
                      }
                      onChange={(event) =>
                        setForm({ ...form, [key]: event.target.value })
                      }
                    />
                    {issues[key] && (
                      <span id={`error-${key}`} className="pr-field-error">
                        {issues[key]}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              {record && (
                <p className="pr-note">
                  Corrections keep the original values in history.
                </p>
              )}
              {saveError && (
                <p role="alert" className="pr-error">
                  {saveError}
                </p>
              )}
              <div className="pr-dialog-actions">
                <span className="pr-save-state">
                  {dirty
                    ? "Unsaved changes"
                    : record
                      ? "Saved record"
                      : "New entry"}
                </span>
                <button className="pr-button pr-primary" type="submit">
                  <Check />
                  Review totals
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent
          className="practice-theme practice-confirm"
          data-appearance={theme}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {request.current
                ? "Leave an unconfirmed save?"
                : "Discard unsaved changes?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {request.current
                ? "The server may have saved this entry. Check the refreshed period and its history before entering these numbers again."
                : "The saved session record will not change."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {request.current ? "Return to save" : "Keep editing"}
            </AlertDialogCancel>
            <AlertDialogAction onClick={finishClose}>
              {request.current ? "Close entry" : "Discard changes"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
