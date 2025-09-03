import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { FileText, Eye, Users, TestTube } from "lucide-react";

interface ArtifactSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
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

export function ArtifactSelectionModal({ isOpen, onClose, onConfirm }: ArtifactSelectionModalProps) {
  const [selectedArtifacts, setSelectedArtifacts] = useState<string[]>(
    artifacts.filter(a => a.defaultSelected).map(a => a.id)
  );

  const handleArtifactToggle = (artifactId: string, checked: boolean) => {
    if (checked) {
      setSelectedArtifacts(prev => [...prev, artifactId]);
    } else {
      setSelectedArtifacts(prev => prev.filter(id => id !== artifactId));
    }
  };

  const handleConfirm = () => {
    onConfirm(selectedArtifacts);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Select Artifacts to Generate</DialogTitle>
          <DialogDescription>
            Choose which artifacts you'd like me to generate for your test suite.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-3 py-4">
          {artifacts.map((artifact) => {
            const Icon = artifact.icon;
            const isSelected = selectedArtifacts.includes(artifact.id);
            
            return (
              <Card key={artifact.id} className={`p-4 transition-colors ${isSelected ? 'bg-primary/5 border-primary/20' : 'hover:bg-accent/50'}`}>
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id={artifact.id}
                    checked={isSelected}
                    disabled={artifact.disabled}
                    onCheckedChange={(checked) => handleArtifactToggle(artifact.id, !!checked)}
                    className="mt-1"
                  />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center space-x-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <label 
                        htmlFor={artifact.id} 
                        className={`text-sm font-medium cursor-pointer ${artifact.disabled ? 'text-muted-foreground' : ''}`}
                      >
                        {artifact.name}
                        {artifact.disabled && <span className="text-xs ml-2">(Default)</span>}
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {artifact.description}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        <div className="flex justify-end space-x-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Continue with Selected Artifacts
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}