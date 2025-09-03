import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileText,
  Target,
  CheckSquare,
  Edit2,
  Check,
  X,
  Plus,
  Download,
  Lock,
  Unlock,
  Link2,
  AlertTriangle,
  Maximize2,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { RelationshipIndicator } from "@/components/ui/relationship-indicator";
import { TraceabilityMatrix } from "@/components/ui/traceability-matrix";
import {
  FullScreenModal,
  FullScreenModalContent,
  FullScreenModalTrigger,
  FullScreenModalClose,
} from "@/components/ui/full-screen-modal";
import { cn } from "@/lib/utils";

interface Requirement {
  id: string;
  description: string;
  priority: "High" | "Medium" | "Low";
  status: "Parsed" | "Reviewed" | "Approved";
  relationshipStatus?: "New" | "Linked" | "Complete";
  linkedViewpoints: string[];
  linkedTestCases: string[];
  sourceDocument?: string;
  sourceSection?: string;
  extractedContent?: string;
  createdAt?: Date;
  lastModified: Date;
  changeHistory: Array<{
    timestamp: Date;
    field: string;
    oldValue: string;
    newValue: string;
  }>;
}

interface Viewpoint {
  id: string;
  area: string;
  intent: string;
  dataVariants: string;
  notes: string;
  linkedRequirements: string[];
  linkedTestCases: string[];
  lastModified: Date;
  changeHistory: Array<{
    timestamp: Date;
    field: string;
    oldValue: string;
    newValue: string;
  }>;
}

interface TestCase {
  id: string;
  title: string;
  steps: string;
  expectedResult: string;
  severity: "High" | "Medium" | "Low";
  reqIds: string[];
  viewpointIds: string[];
  tags: string[];
  locked: boolean;
  lastModified: Date;
  changeHistory: Array<{
    timestamp: Date;
    field: string;
    oldValue: string;
    newValue: string;
  }>;
}

interface ArtifactsPanelProps {
  requirements: Requirement[];
  viewpoints: Viewpoint[];
  testCases: TestCase[];
  dynamicRequirementsRows?: any[];
  dynamicTestCaseRows?: any[];
  onUpdateRequirement: (
    id: string,
    data: Partial<Requirement>,
    field?: string,
    oldValue?: string
  ) => void;
  onUpdateViewpoint: (
    id: string,
    data: Partial<Viewpoint>,
    field?: string,
    oldValue?: string
  ) => void;
  onUpdateTestCase: (
    id: string,
    data: Partial<TestCase>,
    field?: string,
    oldValue?: string
  ) => void;
  onLinkArtifacts: (
    sourceType: string,
    sourceId: string,
    targetType: string,
    targetId: string
  ) => void;
  selectedArtifact: { type: string; id: string } | null;
  onSelectArtifact: (artifact: { type: string; id: string } | null) => void;
  onExport: (format: string) => void;
  onGenerateArtifacts?: (requirementId: string) => void;
  isFullScreen?: boolean;
  loadingStates?: {
    requirements?: boolean;
    viewpoints?: boolean;
    testCases?: boolean;
  };
  agentLoading?: boolean;
}

export function ArtifactsPanel({
  requirements,
  viewpoints,
  testCases,
  dynamicRequirementsRows = [],
  dynamicTestCaseRows = [],
  onUpdateRequirement,
  onUpdateViewpoint,
  onUpdateTestCase,
  onLinkArtifacts,
  selectedArtifact,
  onSelectArtifact,
  onExport,
  onGenerateArtifacts,
  isFullScreen = false,
  loadingStates = {},
  agentLoading = false,
}: ArtifactsPanelProps) {
  const [activeTab, setActiveTab] = useState("requirements");
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const reqCount = dynamicRequirementsRows.length ? dynamicRequirementsRows.length : requirements.length;
  const tcCount = dynamicTestCaseRows.length ? dynamicTestCaseRows.length : testCases.length;
  const vpCount = viewpoints.length;

  const renderDynamicTable = (rows: any[], preferredOrder: string[] = []) => {
    if (!rows || rows.length === 0) return null;

    // Helper: robust stringify for cell values
    const stringify = (val: any) => {
      if (val == null) return "";
      if (
        typeof val === "string" ||
        typeof val === "number" ||
        typeof val === "boolean"
      )
        return String(val);
      try {
        const s = JSON.stringify(val);
        return s.length > 200 ? s.slice(0, 200) + "…" : s;
      } catch {
        return String(val);
      }
    };

    // If rows have a `content` field, show ONLY the parsed JSON content as columns
    const hasContentField = rows.some((r) => r && r.hasOwnProperty("content"));
    if (hasContentField) {
      const parseContent = (v: any): Record<string, any> => {
        if (v == null) return {};
        if (typeof v === "string") {
          try {
            return JSON.parse(v);
          } catch {
            // Not valid JSON string; fall back to showing it under a single column
            return { value: v };
          }
        }
        if (typeof v === "object") return v as Record<string, any>;
        return { value: v };
      };

      const contentObjects = rows.map((r) => parseContent(r?.content));
      const keySet = new Set<string>();
      contentObjects.forEach((obj) =>
        Object.keys(obj || {}).forEach((k) => keySet.add(k))
      );
      const allKeys = Array.from(keySet);
      const orderedKeys = [
        ...preferredOrder.filter((k) => allKeys.includes(k)),
        ...allKeys.filter((k) => !preferredOrder.includes(k)),
      ];

      return (
        <Table>
          <TableHeader className="sticky top-0 bg-muted/50 z-10">
            <TableRow>
              {orderedKeys.map((k) => (
                <TableHead key={k} className="whitespace-nowrap">
                  {k}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {contentObjects.map((obj, idx) => (
              <TableRow key={idx}>
                {orderedKeys.map((k) => (
                  <TableCell key={k} className="text-xs align-top">
                    {stringify(obj?.[k])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    }

    // Default: show all top-level fields across rows as columns
    const keySet = new Set<string>();
    rows.forEach((r) => Object.keys(r || {}).forEach((k) => keySet.add(k)));
    const allKeys = Array.from(keySet);
    const orderedKeys = [
      ...preferredOrder.filter((k) => allKeys.includes(k)),
      ...allKeys.filter((k) => !preferredOrder.includes(k)),
    ];

    return (
      <Table>
        <TableHeader className="sticky top-0 bg-muted/50 z-10">
          <TableRow>
            {orderedKeys.map((k) => (
              <TableHead key={k} className="whitespace-nowrap">
                {k}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, idx) => (
            <TableRow key={row?.id || idx}>
              {orderedKeys.map((k) => (
                <TableCell key={k} className="text-xs align-top">
                  {stringify(row?.[k])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  const startEdit = (cellId: string, currentValue: string) => {
    setEditingCell(cellId);
    setEditValue(currentValue);
  };

  const saveEdit = (type: string, id: string, field: string) => {
    const oldValue = getCurrentValue(type, id, field);

    if (type === "requirement") {
      onUpdateRequirement(id, { [field]: editValue }, field, oldValue);
    } else if (type === "viewpoint") {
      onUpdateViewpoint(id, { [field]: editValue }, field, oldValue);
    } else if (type === "testCase") {
      onUpdateTestCase(id, { [field]: editValue }, field, oldValue);
    }
    setEditingCell(null);
  };

  const getCurrentValue = (type: string, id: string, field: string): string => {
    if (type === "requirement") {
      const req = requirements.find((r) => r.id === id);
      return req ? (req[field as keyof Requirement] as string) : "";
    } else if (type === "viewpoint") {
      const vp = viewpoints.find((v) => v.id === id);
      return vp ? (vp[field as keyof Viewpoint] as string) : "";
    } else if (type === "testCase") {
      const tc = testCases.find((t) => t.id === id);
      return tc ? (tc[field as keyof TestCase] as string) : "";
    }
    return "";
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue("");
  };

  const EditableCell = ({
    value,
    cellId,
    type,
    id,
    field,
    multiline = false,
    placeholder = "",
  }: {
    value: string;
    cellId: string;
    type: string;
    id: string;
    field: string;
    multiline?: boolean;
    placeholder?: string;
  }) => {
    const isEditing = editingCell === cellId;

    if (isEditing) {
      return (
        <div className="flex items-center gap-2 min-w-0">
          {multiline ? (
            <Textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder={placeholder}
              className="min-h-[60px] text-xs"
              autoFocus
            />
          ) : (
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder={placeholder}
              className="text-xs"
              autoFocus
            />
          )}
          <div className="flex gap-1 flex-shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={() => saveEdit(type, id, field)}
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={cancelEdit}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div
        className="group cursor-pointer min-h-[24px] flex items-center gap-2"
        onClick={() => startEdit(cellId, value)}
      >
        <span className="flex-1 text-xs">
          {value || (placeholder ? `${placeholder}` : "")}
        </span>
        <Edit2 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    );
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "High":
        return "bg-destructive text-destructive-foreground";
      case "Medium":
        return "bg-warning text-warning-foreground";
      case "Low":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Parsed":
        return "bg-warning text-warning-foreground";
      case "Reviewed":
        return "bg-primary text-primary-foreground";
      case "Approved":
        return "bg-success text-success-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const renderArtifactsContent = () => (
    <div className="h-full flex flex-col bg-background min-h-0">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="h-full flex flex-col min-h-0"
      >
        {/* Tab Headers */}
        <div className="bg-card px-4 pt-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-card-foreground">Deliverables</h2>
            <div className="flex gap-2">
              {agentLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground mr-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Working...
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => onExport("csv")}
              >
                <Download className="h-4 w-4" />
                Export
              </Button>
              {isFullScreen && (
                <FullScreenModalClose asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </Button>
                </FullScreenModalClose>
              )}
              {!isFullScreen && (
                <FullScreenModal>
                  <FullScreenModalTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Maximize2 className="h-4 w-4" />
                      Full Screen
                    </Button>
                  </FullScreenModalTrigger>
                  <FullScreenModalContent title="Deliverables - Full Screen View">
                    <ArtifactsPanel
                      requirements={requirements}
                      viewpoints={viewpoints}
                      testCases={testCases}
                      onUpdateRequirement={onUpdateRequirement}
                      onUpdateViewpoint={onUpdateViewpoint}
                      onUpdateTestCase={onUpdateTestCase}
                      onLinkArtifacts={onLinkArtifacts}
                      selectedArtifact={selectedArtifact}
                      onSelectArtifact={onSelectArtifact}
                      onExport={onExport}
                      onGenerateArtifacts={onGenerateArtifacts}
                      isFullScreen={true}
                    />
                  </FullScreenModalContent>
                </FullScreenModal>
              )}
            </div>
          </div>

          <TabsList className="grid w-full grid-cols-3 mb-0">
            <TabsTrigger value="requirements" className="gap-2">
              <FileText className="h-4 w-4" />
              Requirements ({reqCount})
            </TabsTrigger>
            <TabsTrigger value="viewpoints" className="gap-2">
              <Target className="h-4 w-4" />
              Viewpoints ({vpCount})
            </TabsTrigger>
            <TabsTrigger value="testcases" className="gap-2">
              <CheckSquare className="h-4 w-4" />
              Test Cases ({tcCount})
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab Content */}
        <TabsContent value="requirements" className="flex-1 m-0 p-4 min-h-0">
          <Card className="h-full flex flex-col min-h-0">
            <CardContent className="p-0 flex-1 min-h-0">
              <div className="flex-1 h-full overflow-hidden border border-border/50 rounded-md">
                <div className="h-full overflow-auto">
                  {loadingStates.requirements ? (
                    <div className="p-4 space-y-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Parsing requirements...
                      </div>
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="space-y-2">
                          <Skeleton className="h-4 w-20" />
                          <Skeleton className="h-8 w-full" />
                          <Skeleton className="h-6 w-32" />
                        </div>
                      ))}
                    </div>
                  ) : dynamicRequirementsRows.length > 0 ? (
                    renderDynamicTable(dynamicRequirementsRows, [
                      "id",
                      "description",
                      "priority",
                      "status",
                    ])
                  ) : requirements.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      No requirements yet. Upload documents or generate from
                      chat to get started.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader className="sticky top-0 bg-muted/50 z-10">
                        <TableRow>
                          <TableHead className={isFullScreen ? "w-24" : "w-20"}>
                            Req ID
                          </TableHead>
                          <TableHead
                            className={isFullScreen ? "min-w-[300px]" : ""}
                          >
                            Description
                          </TableHead>
                          <TableHead className={isFullScreen ? "w-48" : "w-32"}>
                            Relationships
                          </TableHead>
                          {isFullScreen && (
                            <>
                              <TableHead className="w-48">
                                Source Document
                              </TableHead>
                              <TableHead className="w-32">
                                Source Section
                              </TableHead>
                              <TableHead className="min-w-[400px]">
                                Extracted Content
                              </TableHead>
                              <TableHead className="w-40">
                                Last Modified
                              </TableHead>
                            </>
                          )}
                          {!isFullScreen && (
                            <TableHead className="w-32">Source Info</TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {requirements.map((req) => (
                          <TableRow
                            key={req.id}
                            className={cn(
                              "hover:bg-muted/50 cursor-pointer",
                              selectedArtifact?.type === "requirement" &&
                                selectedArtifact?.id === req.id
                                ? "bg-primary/10 border-l-4 border-l-primary"
                                : ""
                            )}
                            onClick={() =>
                              onSelectArtifact({
                                type: "requirement",
                                id: req.id,
                              })
                            }
                          >
                            <TableCell className="font-mono text-xs">
                              {req.id}
                            </TableCell>
                            <TableCell
                              className={isFullScreen ? "max-w-[300px]" : ""}
                            >
                              <EditableCell
                                value={req.description}
                                cellId={`req-${req.id}-desc`}
                                type="requirement"
                                id={req.id}
                                field="description"
                                multiline
                              />
                            </TableCell>
                            <TableCell>
                              <RelationshipIndicator
                                artifactType="requirement"
                                artifactId={req.id}
                                linkedViewpoints={req.linkedViewpoints}
                                linkedTestCases={req.linkedTestCases}
                                onShowRelationships={(type, id) =>
                                  onSelectArtifact({ type, id })
                                }
                              />
                            </TableCell>
                            {isFullScreen && (
                              <>
                                <TableCell>
                                  <EditableCell
                                    value={req.sourceDocument || ""}
                                    cellId={`req-${req.id}-sourceDoc`}
                                    type="requirement"
                                    id={req.id}
                                    field="sourceDocument"
                                    placeholder="Source document name..."
                                  />
                                </TableCell>
                                <TableCell>
                                  <EditableCell
                                    value={req.sourceSection || ""}
                                    cellId={`req-${req.id}-sourceSection`}
                                    type="requirement"
                                    id={req.id}
                                    field="sourceSection"
                                    placeholder="Section reference..."
                                  />
                                </TableCell>
                                <TableCell>
                                  <EditableCell
                                    value={req.extractedContent || ""}
                                    cellId={`req-${req.id}-extractedContent`}
                                    type="requirement"
                                    id={req.id}
                                    field="extractedContent"
                                    placeholder="Original extracted content..."
                                    multiline
                                  />
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {req.lastModified.toLocaleDateString()}
                                </TableCell>
                              </>
                            )}
                            {!isFullScreen && (
                              <TableCell className="text-xs">
                                <div className="space-y-1 max-w-[150px]">
                                  {req.sourceDocument && (
                                    <div
                                      className="truncate text-muted-foreground"
                                      title={req.sourceDocument}
                                    >
                                      📄 {req.sourceDocument}
                                    </div>
                                  )}
                                  {req.sourceSection && (
                                    <div
                                      className="truncate text-muted-foreground"
                                      title={req.sourceSection}
                                    >
                                      📍 {req.sourceSection}
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="viewpoints" className="flex-1 m-0 p-4 min-h-0">
          <Card className="h-full flex flex-col min-h-0">
            <CardContent className="p-0 flex-1 min-h-0">
              <div className="flex-1 h-full overflow-hidden border border-border/50 rounded-md">
                <div className="h-full overflow-auto">
                  {loadingStates.viewpoints ? (
                    <div className="p-4 space-y-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating viewpoints...
                      </div>
                      {[...Array(2)].map((_, i) => (
                        <div key={i} className="space-y-2">
                          <Skeleton className="h-4 w-20" />
                          <Skeleton className="h-6 w-full" />
                          <Skeleton className="h-4 w-3/4" />
                        </div>
                      ))}
                    </div>
                  ) : viewpoints.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      No viewpoints yet. Generate them from requirements or
                      chat.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader className="sticky top-0 bg-muted/50 z-10">
                        <TableRow>
                          <TableHead className={isFullScreen ? "w-24" : "w-20"}>
                            VP ID
                          </TableHead>
                          <TableHead className={isFullScreen ? "w-48" : "w-32"}>
                            Feature/Area
                          </TableHead>
                          <TableHead
                            className={isFullScreen ? "min-w-[300px]" : ""}
                          >
                            Intent
                          </TableHead>
                          <TableHead className={isFullScreen ? "w-60" : "w-40"}>
                            Data Variants
                          </TableHead>
                          <TableHead className={isFullScreen ? "w-48" : "w-32"}>
                            Notes
                          </TableHead>
                          {isFullScreen && (
                            <TableHead className="w-48">
                              Relationships
                            </TableHead>
                          )}
                          {isFullScreen && (
                            <TableHead className="w-40">
                              Last Modified
                            </TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {viewpoints.map((vp) => (
                          <TableRow
                            key={vp.id}
                            className={cn(
                              "hover:bg-muted/50 cursor-pointer",
                              selectedArtifact?.type === "viewpoint" &&
                                selectedArtifact?.id === vp.id
                                ? "bg-primary/10 border-l-4 border-l-primary"
                                : ""
                            )}
                            onClick={() =>
                              onSelectArtifact({ type: "viewpoint", id: vp.id })
                            }
                          >
                            <TableCell className="font-mono text-xs">
                              {vp.id}
                            </TableCell>
                            <TableCell>
                              <EditableCell
                                value={vp.area}
                                cellId={`vp-${vp.id}-area`}
                                type="viewpoint"
                                id={vp.id}
                                field="area"
                              />
                            </TableCell>
                            <TableCell
                              className={isFullScreen ? "max-w-[300px]" : ""}
                            >
                              <EditableCell
                                value={vp.intent}
                                cellId={`vp-${vp.id}-intent`}
                                type="viewpoint"
                                id={vp.id}
                                field="intent"
                                multiline
                              />
                            </TableCell>
                            <TableCell>
                              <EditableCell
                                value={vp.dataVariants}
                                cellId={`vp-${vp.id}-variants`}
                                type="viewpoint"
                                id={vp.id}
                                field="dataVariants"
                              />
                            </TableCell>
                            <TableCell>
                              <EditableCell
                                value={vp.notes}
                                cellId={`vp-${vp.id}-notes`}
                                type="viewpoint"
                                id={vp.id}
                                field="notes"
                              />
                            </TableCell>
                            {isFullScreen && (
                              <TableCell>
                                <RelationshipIndicator
                                  artifactType="viewpoint"
                                  artifactId={vp.id}
                                  linkedViewpoints={[]}
                                  linkedTestCases={vp.linkedTestCases}
                                  onShowRelationships={(type, id) =>
                                    onSelectArtifact({ type, id })
                                  }
                                />
                              </TableCell>
                            )}
                            {isFullScreen && (
                              <TableCell className="text-xs text-muted-foreground">
                                {vp.lastModified.toLocaleDateString()}
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="testcases" className="flex-1 m-0 p-4 min-h-0">
          <Card className="h-full flex flex-col min-h-0">
            <CardContent className="p-0 flex-1 min-h-0">
              <div className="flex-1 h-full overflow-hidden border border-border/50 rounded-md">
                <div className="h-full overflow-auto">
                  {loadingStates.testCases ? (
                    <div className="p-4 space-y-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating test cases...
                      </div>
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="space-y-2">
                          <Skeleton className="h-4 w-16" />
                          <Skeleton className="h-6 w-full" />
                          <Skeleton className="h-8 w-3/4" />
                        </div>
                      ))}
                    </div>
                  ) : dynamicTestCaseRows.length > 0 ? (
                    renderDynamicTable(dynamicTestCaseRows, [
                      "id",
                      "title",
                      "steps",
                      "expected_result",
                      "severity",
                    ])
                  ) : testCases.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      No test cases yet. Generate them from requirements or
                      chat.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader className="sticky top-0 bg-muted/50 z-10">
                        <TableRow>
                          <TableHead className="w-12 min-w-12"></TableHead>
                          <TableHead className="w-16 min-w-16 sm:w-20">
                            TC ID
                          </TableHead>
                          <TableHead className="min-w-32 sm:min-w-48">
                            Title
                          </TableHead>
                          <TableHead className="hidden md:table-cell min-w-40">
                            Steps
                          </TableHead>
                          <TableHead className="hidden lg:table-cell min-w-32">
                            Expected Result
                          </TableHead>
                          <TableHead className="w-16 min-w-16 sm:w-20">
                            Severity
                          </TableHead>
                          <TableHead className="hidden sm:table-cell w-20 min-w-20">
                            Req IDs
                          </TableHead>
                          <TableHead className="hidden xl:table-cell w-24 min-w-24">
                            Tags
                          </TableHead>
                          {isFullScreen && (
                            <TableHead className="hidden lg:table-cell w-32 min-w-32">
                              Last Modified
                            </TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {testCases.map((tc) => (
                          <TableRow
                            key={tc.id}
                            className={cn(
                              "hover:bg-muted/50 cursor-pointer",
                              selectedArtifact?.type === "testcase" &&
                                selectedArtifact?.id === tc.id
                                ? "bg-primary/10 border-l-4 border-l-primary"
                                : ""
                            )}
                            onClick={() =>
                              onSelectArtifact({ type: "testcase", id: tc.id })
                            }
                          >
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onUpdateTestCase(tc.id, {
                                    locked: !tc.locked,
                                  });
                                }}
                              >
                                {tc.locked ? (
                                  <Lock className="h-3 w-3 text-warning" />
                                ) : (
                                  <Unlock className="h-3 w-3 text-muted-foreground" />
                                )}
                              </Button>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {tc.id}
                            </TableCell>
                            <TableCell
                              className={isFullScreen ? "max-w-[320px]" : ""}
                            >
                              <EditableCell
                                value={tc.title}
                                cellId={`tc-${tc.id}-title`}
                                type="testCase"
                                id={tc.id}
                                field="title"
                                multiline
                              />
                            </TableCell>
                            <TableCell className="hidden md:table-cell">
                              <EditableCell
                                value={tc.steps}
                                cellId={`tc-${tc.id}-steps`}
                                type="testCase"
                                id={tc.id}
                                field="steps"
                                multiline
                              />
                            </TableCell>
                            <TableCell className="hidden lg:table-cell">
                              <EditableCell
                                value={tc.expectedResult}
                                cellId={`tc-${tc.id}-result`}
                                type="testCase"
                                id={tc.id}
                                field="expectedResult"
                                multiline
                              />
                            </TableCell>
                            <TableCell>
                              <Badge className={getPriorityColor(tc.severity)}>
                                {tc.severity}
                              </Badge>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                              <div className="flex flex-wrap gap-1">
                                {tc.reqIds.map((reqId) => (
                                  <Badge
                                    key={reqId}
                                    variant="outline"
                                    className="text-xs"
                                  >
                                    {reqId}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="hidden xl:table-cell">
                              <div className="flex flex-wrap gap-1">
                                {tc.tags.map((tag) => (
                                  <Badge
                                    key={tag}
                                    variant="secondary"
                                    className="text-xs"
                                  >
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            {isFullScreen && (
                              <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                                {tc.lastModified.toLocaleDateString()}
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );

  return renderArtifactsContent();
}
