import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Save, GitBranch } from "lucide-react";

interface SaveVersionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (description: string, isCheckpoint?: boolean) => void;
  isCheckpoint?: boolean;
  changedArtifacts?: Array<{
    type: string;
    id: string;
    changes: string[];
  }>;
}

export function SaveVersionDialog({
  open,
  onOpenChange,
  onSave,
  isCheckpoint = false,
  changedArtifacts = []
}: SaveVersionDialogProps) {
  const [description, setDescription] = useState("");

  const handleSave = () => {
    if (!description.trim()) return;
    onSave(description.trim(), isCheckpoint);
    setDescription("");
    onOpenChange(false);
  };

  const handleCancel = () => {
    setDescription("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isCheckpoint ? (
              <>
                <GitBranch className="h-5 w-5" />
                Create Checkpoint
              </>
            ) : (
              <>
                <Save className="h-5 w-5" />
                Save Version
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="description">
              {isCheckpoint ? "Checkpoint Description" : "Version Description"}
            </Label>
            <Input
              id="description"
              placeholder={
                isCheckpoint 
                  ? "e.g., Before major requirements update" 
                  : "e.g., Updated test case priorities"
              }
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && description.trim()) {
                  handleSave();
                }
              }}
            />
          </div>

          {changedArtifacts.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Changed Artifacts</Label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {changedArtifacts.map((artifact, index) => (
                  <div key={index} className="p-2 bg-muted/50 rounded-md text-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">
                        {artifact.type.toUpperCase()}
                      </Badge>
                      <span className="font-medium">{artifact.id}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {artifact.changes.slice(0, 2).join(", ")}
                      {artifact.changes.length > 2 && ` +${artifact.changes.length - 2} more`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            {isCheckpoint 
              ? "Checkpoints are manual save points that help you track important milestones."
              : "This will create a new version that you can restore to later."
            }
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={!description.trim()}
          >
            {isCheckpoint ? (
              <>
                <GitBranch className="h-4 w-4 mr-2" />
                Create Checkpoint
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Version
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}