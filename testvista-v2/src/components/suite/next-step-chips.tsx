import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TestTube, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

interface NextStepChipsProps {
  onSelect: (option: "test-cases" | "viewpoints") => void;
}

const options = [
  {
    id: "test-cases",
    name: "Generate a few example test cases",
    description: "Create initial test cases based on the requirements",
    icon: TestTube,
  },
  {
    id: "viewpoints", 
    name: "Generate a few example viewpoints cases",
    description: "Create viewpoints to analyze the requirements from different perspectives",
    icon: Eye,
  }
];

export function NextStepChips({ onSelect }: NextStepChipsProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-foreground">What would you like me to generate next?</p>
      
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const Icon = option.icon;
          
          return (
            <Badge
              key={option.id}
              variant="outline"
              className={cn(
                "cursor-pointer transition-all duration-200 px-3 py-2 text-xs flex items-center gap-2 hover:scale-105",
                "hover:bg-accent hover:text-accent-foreground"
              )}
              onClick={() => onSelect(option.id as "test-cases" | "viewpoints")}
              title={option.description}
            >
              <Icon className="h-3 w-3" />
              {option.name}
            </Badge>
          );
        })}
      </div>

      <div className="flex justify-end">
        <span className="text-xs text-muted-foreground">Click on an option to continue</span>
      </div>
    </div>
  );
}