import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArtifactVersion, VersionAction } from "@/types/version";
import { 
  Clock, 
  User, 
  GitBranch, 
  RotateCcw, 
  Eye, 
  Save,
  Search,
  ChevronRight,
  AlertTriangle
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

interface VersionHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versions: ArtifactVersion[];
  currentVersion: number;
  onAction: (action: VersionAction) => void;
  artifactType?: "requirement" | "viewpoint" | "testcase";
  artifactId?: string;
}

export function VersionHistoryModal({
  open,
  onOpenChange,
  versions,
  currentVersion,
  onAction,
  artifactType,
  artifactId
}: VersionHistoryModalProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<ArtifactVersion | null>(null);
  
  // Filter versions based on artifact type/id if specified
  const filteredVersions = versions.filter(version => {
    const matchesSearch = !searchTerm || 
      version.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      version.changesSummary.some(change => 
        change.toLowerCase().includes(searchTerm.toLowerCase())
      );
    
    const matchesArtifact = !artifactType || !artifactId || 
      (version.artifactType === artifactType && version.artifactId === artifactId);
    
    return matchesSearch && matchesArtifact;
  }).sort((a, b) => b.versionNumber - a.versionNumber);

  const handleRestore = (version: ArtifactVersion) => {
    onAction({ 
      type: "restore", 
      versionId: version.id,
      artifactType: version.artifactType,
      artifactId: version.artifactId
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Version History
            {artifactType && artifactId && (
              <Badge variant="secondary" className="ml-2">
                {artifactType.toUpperCase()} {artifactId}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search versions by description or changes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[500px]">
            {/* Version List */}
            <div className="space-y-2">
              <h3 className="font-medium text-sm text-muted-foreground">Versions ({filteredVersions.length})</h3>
              <ScrollArea className="h-[460px]">
                <div className="space-y-2 pr-4">
                  {filteredVersions.map((version) => (
                    <Card 
                      key={version.id}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-muted/50",
                        selectedVersion?.id === version.id && "border-primary bg-muted/50",
                        version.versionNumber === currentVersion && "border-l-4 border-l-primary"
                      )}
                      onClick={() => setSelectedVersion(version)}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant={version.isAutoSave ? "secondary" : "default"}>
                              v{version.versionNumber}
                            </Badge>
                            {version.versionNumber === currentVersion && (
                              <Badge variant="outline" className="text-xs">CURRENT</Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(version.timestamp, { addSuffix: true })}
                          </span>
                        </div>
                        <CardTitle className="text-sm font-medium">{version.description}</CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                          <User className="h-3 w-3" />
                          <span>{version.author}</span>
                          <Separator orientation="vertical" className="h-3" />
                          <Badge variant="outline" className="text-xs">
                            {version.artifactType.toUpperCase()}
                          </Badge>
                          <span>{version.artifactId}</span>
                        </div>
                        {version.changesSummary.length > 0 && (
                          <div className="space-y-1">
                            {version.changesSummary.slice(0, 2).map((change, index) => (
                              <div key={index} className="text-xs text-muted-foreground flex items-center gap-1">
                                <ChevronRight className="h-3 w-3" />
                                <span>{change}</span>
                              </div>
                            ))}
                            {version.changesSummary.length > 2 && (
                              <div className="text-xs text-muted-foreground">
                                +{version.changesSummary.length - 2} more changes
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Version Details */}
            <div className="space-y-2">
              <h3 className="font-medium text-sm text-muted-foreground">Details</h3>
              <div className="h-[460px] border rounded-lg">
                {selectedVersion ? (
                  <div className="p-4 h-full flex flex-col">
                    <div className="space-y-4 flex-1">
                      <div>
                        <h4 className="font-medium mb-2">Version {selectedVersion.versionNumber}</h4>
                        <p className="text-sm text-muted-foreground">{selectedVersion.description}</p>
                      </div>

                      <Separator />

                      <div className="space-y-2">
                        <h5 className="font-medium text-sm">Changes Summary</h5>
                        <div className="space-y-1">
                          {selectedVersion.changesSummary.map((change, index) => (
                            <div key={index} className="text-sm flex items-start gap-2">
                              <ChevronRight className="h-4 w-4 mt-0.5 text-muted-foreground" />
                              <span>{change}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <Separator />

                      <div className="text-xs text-muted-foreground space-y-1">
                        <div className="flex justify-between">
                          <span>Created:</span>
                          <span>{selectedVersion.timestamp.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Author:</span>
                          <span>{selectedVersion.author}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Type:</span>
                          <span>{selectedVersion.isAutoSave ? "Auto-save" : "Manual save"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="border-t pt-4 space-y-2">
                      {selectedVersion.versionNumber !== currentVersion && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5" />
                            <div>
                              <p className="font-medium text-yellow-800">Restore Warning</p>
                              <p className="text-yellow-700 text-xs mt-1">
                                This will replace the current version. Any unsaved changes will be lost.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRestore(selectedVersion)}
                          disabled={selectedVersion.versionNumber === currentVersion}
                          className="flex-1"
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Restore Version
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            // TODO: Implement version comparison
                          }}
                          className="flex-1"
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Compare
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>Select a version to view details</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}