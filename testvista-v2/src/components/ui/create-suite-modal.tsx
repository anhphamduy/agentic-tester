import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderOpen } from "lucide-react";

interface CreateSuiteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateSuite: (suiteName: string, folderId?: string) => void;
  selectedFolderId?: string;
  selectedFolderName?: string;
}

export function CreateSuiteModal({ 
  isOpen, 
  onClose, 
  onCreateSuite, 
  selectedFolderId,
  selectedFolderName 
}: CreateSuiteModalProps) {
  const [suiteName, setSuiteName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suiteName.trim()) return;

    setIsCreating(true);
    try {
      await onCreateSuite(suiteName.trim(), selectedFolderId);
      setSuiteName("");
      onClose();
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setSuiteName("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Test Suite</DialogTitle>
            <DialogDescription>
              Enter a name for your new test suite to get started.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="suite-name">Suite Name</Label>
              <Input
                id="suite-name"
                placeholder="e.g., User Authentication Tests"
                value={suiteName}
                onChange={(e) => setSuiteName(e.target.value)}
                autoFocus
                className="focus:border-primary/50"
              />
            </div>

            {selectedFolderName && (
              <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-md">
                <FolderOpen className="h-4 w-4 text-primary" />
                <span className="text-sm text-muted-foreground">
                  Will be added to: <span className="font-medium text-foreground">{selectedFolderName}</span>
                </span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={!suiteName.trim() || isCreating}
              className="gap-2"
            >
              {isCreating ? "Creating..." : "Create Suite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}