import ClinAdmin from "@/pages/ClinAdmin";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ClinAdmin />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
