import { useEffect, useRef } from "react";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  useClerk,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import {
  Switch,
  Route,
  Router as WouterRouter,
  useLocation,
} from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import ClinicianPresenterPage from "@/pages/clinician-presenter";
import Practice from "@/pages/practice";
import Hub from "@/pages/hub";
import Access from "@/components/hub/access";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsPlacement: "top" as const,
    socialButtonsVariant: "blockButton" as const,
  },
  variables: {
    colorPrimary: "hsl(175 75% 35%)",
    colorForeground: "hsl(222 47% 11%)",
    colorMutedForeground: "hsl(215.4 16.3% 46.9%)",
    colorDanger: "hsl(0 84.2% 60.2%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(210 40% 98%)",
    colorInputForeground: "hsl(222 47% 11%)",
    colorNeutral: "hsl(214 32% 91%)",
    fontFamily: "Inter, system-ui, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-lg",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-slate-900",
    headerSubtitle: "text-slate-600",
    socialButtonsBlockButtonText: "text-slate-900",
    formFieldLabel: "text-slate-900",
    footerActionLink: "text-teal-700",
    footerActionText: "text-slate-600",
    dividerText: "text-slate-500",
    identityPreviewEditButton: "text-teal-700",
    formFieldSuccessText: "text-emerald-700",
    alertText: "text-red-700",
    logoBox: "h-12",
    logoImage: "h-12 w-12",
    socialButtonsBlockButton: "border-slate-200 bg-white hover:bg-slate-50",
    formButtonPrimary: "bg-teal-700 hover:bg-teal-800 text-white",
    formFieldInput:
      "border-slate-200 bg-slate-50 text-slate-900 focus:border-teal-700",
    footerAction: "border-t border-slate-200",
    dividerLine: "bg-slate-200",
    alert: "border-red-200 bg-red-50",
    otpCodeFieldInput: "border-slate-200 bg-slate-50 text-slate-900",
    formFieldRow: "text-slate-900",
    main: "bg-white",
  },
};

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function Router() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/hub/:section">
        {(params) => (
          <Access>
            <Hub section={params.section} />
          </Access>
        )}
      </Route>
      <Route path="/hub">
        <Access>
          <Hub />
        </Access>
      </Route>
      <Route path="/practice">
        <Access>
          <Practice />
        </Access>
      </Route>
      <Route path="/">
        <Access>
          <Dashboard />
        </Access>
      </Route>
      <Route path="/present/:token" component={ClinicianPresenterPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-4">
      <div>
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          signUpUrl={`${basePath}/sign-up`}
        />
      </div>
      <p className="text-sm text-slate-600">
        Need a new account?{" "}
        <a
          className="font-medium text-teal-700 underline underline-offset-4"
          href={`${basePath}/sign-up`}
        >
          Create one
        </a>
      </p>
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        previousUserId.current !== undefined &&
        previousUserId.current !== userId
      ) {
        queryClient.clear();
      }
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to access your compensation dashboard",
          },
        },
        signUp: {
          start: {
            title: "Create your account",
            subtitle: "Join your internal practice planning workspace",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider delayDuration={300}>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
