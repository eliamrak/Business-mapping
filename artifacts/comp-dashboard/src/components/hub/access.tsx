import type { ReactNode } from "react";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { LockKeyhole, LogIn, UserPlus } from "lucide-react";
import { ApiError, customFetch } from "@workspace/api-client-react";
import "@/pages/practice.css";
import Entry from "./entry";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Access({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => customFetch<{ actor: string; role: string }>("/api/auth/me"),
    enabled: isLoaded && !!isSignedIn,
    retry: false,
  });

  if (!isLoaded) {
    return (
      <main className="practice-theme hub-login" data-appearance="light">
        <div>
          <LockKeyhole />
          <h1>EMCounseling</h1>
          <p>Connecting to secure sign-in...</p>
        </div>
      </main>
    );
  }

  if (isSignedIn && me.isPending) {
    return (
      <main className="practice-theme hub-login" data-appearance="light">
        <div>
          <LockKeyhole />
          <h1>EMCounseling</h1>
          <p>Checking your workspace access...</p>
        </div>
      </main>
    );
  }

  if (isSignedIn && me.isError) {
    const accessDenied = me.error instanceof ApiError && me.error.status === 403;
    return (
      <main className="practice-theme hub-login" data-appearance="light">
        <div>
          <LockKeyhole />
          <h1>EMCounseling</h1>
          <p role="alert">
            {accessDenied
              ? "Your account is not authorized for this workspace."
              : "The app could not verify your workspace access. Refresh and try again."}
          </p>
        </div>
      </main>
    );
  }

  if (isSignedIn && me.data?.role === "data_entry") return <Entry />;
  if (isSignedIn) return <>{children}</>;

  return (
    <main className="practice-theme hub-login" data-appearance="light">
      <div>
        <LockKeyhole />
        <h1>EMCounseling</h1>
        <p>Compensation strategy and practice planning for your team.</p>
        <a className="pr-button pr-primary" href={`${basePath}/sign-in`}>
          <LogIn />
          Sign in with Google
        </a>
        <a className="pr-button" href={`${basePath}/sign-up`}>
          <UserPlus />
          Create an account
        </a>
        <p className="hub-muted">
          Access is limited to invited internal users.
        </p>
      </div>
    </main>
  );
}