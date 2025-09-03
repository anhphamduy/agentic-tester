import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bell, Search, Plus } from "lucide-react";

export function DashboardHeader() {
  return (
    <header className="flex items-center justify-between p-6 bg-background border-b border-border/50">
      <div className="flex items-center gap-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Manage your test folders and suites</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
      </div>
    </header>
  );
}