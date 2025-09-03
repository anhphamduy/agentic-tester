import { FolderOpen, CheckSquare, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FolderPreviewItemProps {
  folder: {
    id: string;
    name: string;
    description: string;
    suites: number;
    lastActivity: string;
  };
  projectId: string;
  onClick: () => void;
  className?: string;
}

export function FolderPreviewItem({ folder, projectId, onClick, className }: FolderPreviewItemProps) {
  return (
    <Button
      variant="ghost"
      className={cn(
        "w-full justify-start p-3 h-auto text-left hover:bg-muted/50 transition-colors group",
        className
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-3 w-full">
        <FolderOpen className="h-4 w-4 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-card-foreground group-hover:text-primary transition-colors truncate">
            {folder.name}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {folder.description}
          </p>
          <div className="flex items-center gap-4 mt-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckSquare className="h-3 w-3" />
              <span>{folder.suites} suites</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>{folder.lastActivity}</span>
            </div>
          </div>
        </div>
      </div>
    </Button>
  );
}