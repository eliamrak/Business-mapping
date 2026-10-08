import { customFetch } from "@workspace/api-client-react";
import type {
  SessionRecord,
  SessionWrite,
  SessionHistory,
} from "@workspace/practice";

export type SessionGoal = {
  id: number;
  clinicianId: number;
  year: number;
  sessionsPerWeek: number;
  updatedAt: string;
};

export const sessionKey = (team: string) => ["session-records", team] as const;
export const sessionGoalKey = (team: string) => ["session-goals", team] as const;
export const listSessionRecords = (team: string, signal?: AbortSignal) =>
  customFetch<SessionRecord[]>(
    `/api/session-records?goalId=${encodeURIComponent(team)}`,
    { signal },
  );
export const listSessionGoals = (team: string, signal?: AbortSignal) =>
  customFetch<SessionGoal[]>(
    `/api/session-goals?goalId=${encodeURIComponent(team)}`,
    { signal },
  );
const postSessionRecord = (command: SessionWrite, signal?: AbortSignal) =>
  customFetch<SessionRecord>("/api/session-records", {
    method: "POST",
    body: JSON.stringify(command),
    signal,
  });
export const saveSessionRecord = (command: SessionWrite) =>
  postSessionRecord(command);
export const saveSessionRecordBounded = (command: SessionWrite) =>
  postSessionRecord(command, AbortSignal.timeout(30_000));
export const saveSessionGoal = (input: {
  clinicianId: number;
  year: number;
  sessionsPerWeek: number;
}) =>
  customFetch<SessionGoal>("/api/session-goals", {
    method: "PUT",
    body: JSON.stringify(input),
  });
export const sessionHistory = (id: number, signal?: AbortSignal) =>
  customFetch<SessionHistory[]>(`/api/session-records/${id}/history`, {
    signal,
  });
