import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, GitBranch, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { VersionAction, ArtifactVersion } from "@/types/version";
import { Logo } from "@/components/ui/logo";

interface VersionActionChipsProps {
  latestVersion?: ArtifactVersion;
  onAction: (action: VersionAction) => void;
  className?: string;
}

export function VersionActionChips({ 
  latestVersion, 
  onAction, 
  className 
}: VersionActionChipsProps) {
  if (!latestVersion) return null;

  return (
    <div className={cn("flex gap-3 justify-start animate-in fade-in-0 slide-in-from-bottom-2", className)}>
      {/* AI Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
        <Logo iconOnly size="sm" className="w-5 h-5" />
      </div>

      {/* Message Content */}
      <div className="flex-1 max-w-[80%]">
        <div className="bg-muted/50 border rounded-lg p-3 space-y-3">
          {/* Version Info */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="h-6">
              <GitBranch className="h-3 w-3 mr-1" />
              Version {latestVersion.versionNumber}
            </Badge>
            <span className="text-sm font-medium">{latestVersion.description}</span>
          </div>
          
          {/* Metadata */}
          <div className="text-xs text-muted-foreground">
            by {latestVersion.author} • just now
          </div>
          
          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onAction({ type: "view-history" })}
              className="h-7 px-3 text-xs"
            >
              <Eye className="h-3 w-3 mr-1" />
              View History
            </Button>
            
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction({ 
                type: "restore", 
                versionId: (latestVersion.versionNumber - 1).toString() 
              })}
              className="h-7 px-3 text-xs"
              disabled={latestVersion.versionNumber <= 1}
            >
              <Undo2 className="h-3 w-3 mr-1" />
              Revert to v{latestVersion.versionNumber - 1}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}