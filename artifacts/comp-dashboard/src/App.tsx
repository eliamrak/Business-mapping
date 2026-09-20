import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import ClinicianPresenterPage from "@/pages/clinician-presenter";
import Practice from "@/pages/practice";
import Hub from "@/pages/hub";
import Access from "@/components/hub/access";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/hub/:section">{params=><Access><Hub section={params.section}/></Access>}</Route>
      <Route path="/hub"><Access><Hub/></Access></Route>
      <Route path="/practice"><Access><Practice/></Access></Route>
      <Route path="/"><Access><Dashboard/></Access></Route>
      <Route path="/present/:token" component={ClinicianPresenterPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
