import { customFetch } from "@workspace/api-client-react";
import type {
  SessionRecord,
  SessionWrite,
  SessionHistory,
} from "@workspace/practice";

export const sessionKey = (team: string) => ["session-records", team] as const;
export const listSessionRecords = (team: string, signal?: AbortSignal) =>
  customFetch<SessionRecord[]>(
    `/api/session-records?goalId=${encodeURIComponent(team)}`,
    { signal },
  );
export const saveSessionRecord = (command: SessionWrite) =>
  customFetch<SessionRecord>("/api/session-records", {
    method: "POST",
    body: JSON.stringify(command),
  });
export const sessionHistory = (id: number, signal?: AbortSignal) =>
  customFetch<SessionHistory[]>(`/api/session-records/${id}/history`, {
    signal,
  });
