import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { LockKeyhole, LogIn } from "lucide-react";
import { customFetch, ApiError } from "@workspace/api-client-react";
import "@/pages/practice.css";
import Entry from "./entry";
export default function Access({ children }: { children: ReactNode }) {
  const status = useQuery({
    queryKey: ["auth-status"],
    queryFn: () =>
      customFetch<{ localPreview: boolean; configured: boolean }>(
        "/api/auth/status",
      ),
    retry: false,
    refetchInterval: 60000,
  });
  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => customFetch<{ actor: string; role: string }>("/api/auth/me"),
    enabled:
      !!status.data && !status.data.localPreview && status.data.configured,
    retry: false,
    refetchInterval: 60000,
  });
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const expired = me.error instanceof ApiError && me.error.status === 401;
  if (!expired && me.data?.role === "data_entry") return <Entry />;
  if (status.data?.localPreview || (me.data && !expired))
    return <>{children}</>;
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await customFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setPassword("");
      await me.refetch();
    } catch {
      setError("Sign-in failed. Check your email and password.");
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="practice-theme hub-login" data-appearance="light">
      <div>
        <LockKeyhole />
        <h1>EMCounseling</h1>
        {status.isPending ? (
          <p>Connecting...</p>
        ) : status.isError ? (
          <p role="alert">
            Cannot reach the app. Refresh after the server is available.
          </p>
        ) : !status.data?.configured ? (
          <p>Owner authentication must be configured before live use.</p>
        ) : (
          <form onSubmit={login}>
            <label className="pr-field">
              Email
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="pr-field">
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="pr-error">
                {error}
              </p>
            )}
            <button className="pr-button pr-primary" disabled={pending}>
              <LogIn />
              {pending ? "Signing in..." : "Sign in"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
