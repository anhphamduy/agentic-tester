import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import { supabase } from "./supabase_client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import MySpace from "./pages/MySpace";
import ProjectManagement from "./pages/ProjectManagement";
import ProjectFolders from "./pages/ProjectFolders";
import CreateSuite from "./pages/CreateSuite";
import TestSuites from "./pages/TestSuites";
import SuiteWorkspace from "./pages/SuiteWorkspace";
import ReferenceFiles from "./pages/ReferenceFiles";
import Standards from "./pages/Standards";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => {
  useEffect(() => {
    const ensureLogin = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          await supabase.auth.signInWithPassword({
            email: "testaccount@example.com",
            password: "testaccount",
          });
        }
      } catch (error) {
        // Swallow errors in auto-login for now; app can still render
        console.error("Auto-login failed", error);
      }
    };
    void ensureLogin();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/my-space" element={<MySpace />} />
            <Route path="/projects" element={<ProjectManagement />} />
            <Route path="/project/:projectId/folders" element={<ProjectFolders />} />
            <Route path="/create-suite" element={<CreateSuite />} />
            <Route path="/suites" element={<TestSuites />} />
            <Route path="/suite/:id" element={<SuiteWorkspace />} />
            <Route path="/reference-files" element={<ReferenceFiles />} />
            <Route path="/standards" element={<Standards />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
