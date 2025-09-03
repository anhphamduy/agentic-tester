import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, Users, CheckSquare, FileText, Target, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface RelationshipIndicatorProps {
  artifactType: "requirement" | "viewpoint" | "testcase";
  artifactId: string;
  linkedRequirements?: string[];
  linkedViewpoints?: string[];
  linkedTestCases?: string[];
  reqIds?: string[];
  viewpointIds?: string[];
  onShowRelationships?: (type: string, id: string) => void;
  showOrphaned?: boolean;
}

export function RelationshipIndicator({
  artifactType,
  artifactId,
  linkedRequirements = [],
  linkedViewpoints = [],
  linkedTestCases = [],
  reqIds = [],
  viewpointIds = [],
  onShowRelationships,
  showOrphaned = true
}: RelationshipIndicatorProps) {
  const hasLinks = linkedRequirements.length > 0 || linkedViewpoints.length > 0 || 
                   linkedTestCases.length > 0 || reqIds.length > 0 || viewpointIds.length > 0;
  
  const totalLinks = linkedRequirements.length + linkedViewpoints.length + 
                     linkedTestCases.length + reqIds.length + viewpointIds.length;

  const getIndicatorColor = () => {
    if (!hasLinks && showOrphaned) return "bg-warning/20 border-warning text-warning-foreground";
    if (totalLinks >= 3) return "bg-success/20 border-success text-success-foreground";
    if (totalLinks >= 1) return "bg-primary/20 border-primary text-primary-foreground";
    return "bg-muted/20 border-muted text-muted-foreground";
  };

  const getIcon = () => {
    if (!hasLinks && showOrphaned) return <AlertTriangle className="h-3 w-3" />;
    if (hasLinks) return <CheckCircle2 className="h-3 w-3" />;
    return <Link className="h-3 w-3" />;
  };

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 px-2 border",
                getIndicatorColor()
              )}
              onClick={() => onShowRelationships?.(artifactType, artifactId)}
            >
              {getIcon()}
              <span className="text-xs ml-1">{totalLinks}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="space-y-2">
              <div className="font-medium">Relationships for {artifactId}</div>
              {!hasLinks && showOrphaned && (
                <div className="text-warning text-xs">⚠️ Orphaned - No relationships</div>
              )}
              {linkedRequirements.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <FileText className="h-3 w-3" />
                  <span>Requirements: {linkedRequirements.join(", ")}</span>
                </div>
              )}
              {linkedViewpoints.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <Target className="h-3 w-3" />
                  <span>Viewpoints: {linkedViewpoints.join(", ")}</span>
                </div>
              )}
              {(linkedTestCases.length > 0 || reqIds.length > 0) && (
                <div className="flex items-center gap-2 text-xs">
                  <CheckSquare className="h-3 w-3" />
                  <span>Test Cases: {[...linkedTestCases, ...reqIds].join(", ")}</span>
                </div>
              )}
              {viewpointIds.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <Target className="h-3 w-3" />
                  <span>Viewpoints: {viewpointIds.join(", ")}</span>
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
        
        {/* Quick link badges */}
        <div className="flex gap-1">
          {linkedRequirements.length > 0 && (
            <Badge variant="outline" className="h-5 px-1 text-xs">
              <FileText className="h-2 w-2 mr-1" />
              {linkedRequirements.length}
            </Badge>
          )}
          {(linkedViewpoints.length > 0 || viewpointIds.length > 0) && (
            <Badge variant="outline" className="h-5 px-1 text-xs">
              <Target className="h-2 w-2 mr-1" />
              {linkedViewpoints.length + viewpointIds.length}
            </Badge>
          )}
          {(linkedTestCases.length > 0 || reqIds.length > 0) && (
            <Badge variant="outline" className="h-5 px-1 text-xs">
              <CheckSquare className="h-2 w-2 mr-1" />
              {linkedTestCases.length + reqIds.length}
            </Badge>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}