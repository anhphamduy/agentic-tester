import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TestTube, Eye, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface ArtifactSelectionChipsProps {
  onConfirm: (selectedArtifacts: string[]) => void;
}

const artifacts = [
  {
    id: "requirements",
    name: "Requirements & Test Cases",
    description: "Functional and non-functional requirements with corresponding test cases",
    icon: TestTube,
    defaultSelected: true,
    disabled: true // Always selected by default
  },
  {
    id: "viewpoints",
    name: "Viewpoints",
    description: "Different perspectives and stakeholder views on the system",
    icon: Eye,
    defaultSelected: false,
    disabled: false
  },
  {
    id: "scenarios",
    name: "Scenarios",
    description: "User journey and use case scenarios for comprehensive testing",
    icon: Users,
    defaultSelected: false,
    disabled: false
  }
];

export function ArtifactSelectionChips({ onConfirm }: ArtifactSelectionChipsProps) {
  const [selectedArtifacts, setSelectedArtifacts] = useState<string[]>(
    artifacts.filter(a => a.defaultSelected).map(a => a.id)
  );

  const handleArtifactToggle = (artifactId: string) => {
    const artifact = artifacts.find(a => a.id === artifactId);
    if (artifact?.disabled) return; // Can't toggle disabled artifacts
    
    if (selectedArtifacts.includes(artifactId)) {
      setSelectedArtifacts(prev => prev.filter(id => id !== artifactId));
    } else {
      setSelectedArtifacts(prev => [...prev, artifactId]);
    }
  };

  const handleConfirm = () => {
    onConfirm(selectedArtifacts);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-foreground">Configure your test suite artifacts:</p>
      
      <div className="flex flex-wrap gap-2">
        {artifacts.map((artifact) => {
          const Icon = artifact.icon;
          const isSelected = selectedArtifacts.includes(artifact.id);
          
          return (
            <Badge
              key={artifact.id}
              variant={isSelected ? "default" : "outline"}
              className={cn(
                "cursor-pointer transition-all duration-200 px-3 py-2 text-xs flex items-center gap-2 hover:scale-105",
                artifact.disabled && "cursor-not-allowed opacity-75",
                isSelected 
                  ? "bg-primary text-primary-foreground hover:bg-primary/90" 
                  : "hover:bg-accent hover:text-accent-foreground"
              )}
              onClick={() => handleArtifactToggle(artifact.id)}
              title={artifact.description}
            >
              <Icon className="h-3 w-3" />
              {artifact.name}
              {artifact.disabled && <span className="text-[10px] opacity-70">(Always)</span>}
            </Badge>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button 
          onClick={handleConfirm}
          size="sm"
        >
          Continue
        </Button>
      </div>
    </div>
  );
}