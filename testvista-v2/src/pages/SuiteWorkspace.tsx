import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/supabase_client";
import { ChatPanel } from "@/components/suite/chat-panel";
import { ArtifactsPanel } from "@/components/suite/artifacts-panel";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, Pause, RotateCcw, Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { VersionHistoryModal } from "@/components/suite/version-history-modal";
import { SaveVersionDialog } from "@/components/suite/save-version-dialog";
import { VersionActionChips } from "@/components/suite/version-action-chips";
import { useVersionManager } from "@/hooks/use-version-manager";
import { VersionAction, ArtifactVersion } from "@/types/version";
interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
  timestamp: Date;
  type?:
    | "command"
    | "normal"
    | "artifact-selection"
    | "next-step"
    | "version-action"
    | "sample-confirmation"
    | "quality-confirmation"
    | "requirements-feedback"
    | "version-update";
  needsImplementation?: boolean;
  implementationPlan?: string;
  versionInfo?: ArtifactVersion;
  versionNumber?: number;
  versionData?: {
    name: string;
    id: string;
    timestamp: Date;
    changes: string[];
  };
  hasModifiedArtifacts?: boolean;
}
interface TraceabilityLink {
  id: string;
  sourceType: "requirement" | "viewpoint" | "testcase";
  sourceId: string;
  targetType: "requirement" | "viewpoint" | "testcase";
  targetId: string;
  relationship: "covers" | "validates" | "implements" | "derives-from";
  strength: "strong" | "medium" | "weak";
  lastValidated: Date;
  notes?: string;
}
interface ChangeImpact {
  artifactId: string;
  artifactType: "requirement" | "viewpoint" | "testcase";
  impactLevel: "high" | "medium" | "low";
  description: string;
}
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
export default function SuiteWorkspace() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [viewpoints, setViewpoints] = useState<Viewpoint[]>([]);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [traceabilityLinks, setTraceabilityLinks] = useState<
    TraceabilityLink[]
  >([]);
  const [dynamicRequirementsRows, setDynamicRequirementsRows] = useState<any[]>(
    []
  );
  const [dynamicTestCaseRows, setDynamicTestCaseRows] = useState<any[]>([]);
  const [dynamicTestDesignRows, setDynamicTestDesignRows] = useState<any[]>([]);
  const [dynamicTestViewpointRows, setDynamicTestViewpointRows] = useState<
    any[]
  >([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [activeArtifactsTab, setActiveArtifactsTab] = useState<
    | "requirements"
    | "viewpoints"
    | "testcases"
    | "test_design"
    | "test_viewpoints"
  >("requirements");
  const [initialChatLoading, setInitialChatLoading] = useState(true);
  const hasLoadedChatOnce = useRef(false);
  // Resizable chat panel state/refs
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("suite_left_panel_width");
      const n = saved ? parseInt(String(saved), 10) : NaN;
      if (Number.isFinite(n)) return Math.min(Math.max(n, 320), 800);
    } catch {}
    return 420;
  });
  const isResizingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leftWidthRef = useRef(leftPanelWidth);
  useEffect(() => {
    leftWidthRef.current = leftPanelWidth;
  }, [leftPanelWidth]);
  const onResizeMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingRef.current || !containerRef.current) return;
    const bounds = containerRef.current.getBoundingClientRect();
    const minLeft = 320; // px
    const minRight = 360; // ensure artifacts panel keeps room
    const maxLeft = Math.max(minLeft, Math.min(800, bounds.width - minRight));
    let next = e.clientX - bounds.left;
    if (next < minLeft) next = minLeft;
    if (next > maxLeft) next = maxLeft;
    setLeftPanelWidth(next);
  }, []);
  const onResizeMouseUp = useCallback(() => {
    if (!isResizingRef.current) return;
    isResizingRef.current = false;
    try {
      localStorage.setItem("suite_left_panel_width", String(leftWidthRef.current));
    } catch {}
    window.removeEventListener("mousemove", onResizeMouseMove);
    window.removeEventListener("mouseup", onResizeMouseUp);
  }, [onResizeMouseMove]);
  // Track latest suite version from test_suites.state
  const [latestSuiteVersion, setLatestSuiteVersion] = useState<
    number | undefined
  >(undefined);
  const loadTeamEvents = async () => {
    try {
      if (!hasLoadedChatOnce.current) setInitialChatLoading(true);
      const suiteIdParam = new URLSearchParams(window.location.search).get(
        "suiteId"
      );
      const suiteIdVal = id || suiteIdParam || undefined;
      if (!suiteIdVal) {
        setInitialChatLoading(false);
        hasLoadedChatOnce.current = true;
        return;
      }
      const { data, error } = await supabase
        .from("team_events")
        .select("payload, created_at, message_id")
        .eq("suite_id", suiteIdVal)
        .order("created_at", { ascending: true });
        if (error) throw error;
      const grouped: Record<string, { createdAt: string; user: string[]; ai: string[]; aiType?: Message["type"] }> = {};
      (data || []).forEach((ev: any) => {
        let parsed: any;
        try {
          parsed = typeof ev.payload === "string" ? JSON.parse(ev.payload) : ev.payload;
        } catch {
          parsed = ev.payload;
        }
        const isUser = parsed && parsed.source === "user";
        const mid = String(ev.message_id);
        const special = isUser ? null : renderSpecialAiEvent(parsed);
        const isQualityAsk = !isUser && parsed?.type === "ask_user" && ((parsed?.event_type || parsed?.eventType) === "quality_confirmation");
        const isSampleAsk = !isUser && parsed?.type === "ask_user" && ((parsed?.event_type || parsed?.eventType) === "sample_confirmation");
        const isReqFeedback = !isUser && parsed?.type === "ask_user" && ((parsed?.event_type || parsed?.eventType) === "requirements_feedback");
        const isGapsFollowUp = !isUser && parsed?.type === "ask_user" && ((parsed?.event_type || parsed?.eventType) === "gaps_follow_up");
        const isTestingType = !isUser && parsed?.type === "ask_user" && ((parsed?.event_type || parsed?.eventType) === "testing_type_choice");
        const aiTextMessage = !isUser && String(parsed?.type || "") === "TextMessage" && typeof parsed?.content === "string"
          ? normalizeMarkdown(String(parsed?.content ?? "")).replace(/\bTERMINATE\b/gi, "").trim()
          : null;
        // Preview now returns table text only; no preview data suffix is appended
        let previewDataSuffix: string | null = null;

        const codeBlock = isUser
          ? (typeof parsed?.content === "string"
              ? parsed.content
              : String(parsed?.content ?? ""))
          : (
              (isQualityAsk || isSampleAsk || isReqFeedback || isTestingType || isGapsFollowUp) && typeof (parsed?.response_to_user || parsed?.responseToUser) === "string"
                ? (String(parsed?.response_to_user || parsed?.responseToUser))
                : (aiTextMessage ?? special ?? null)
            );
        const g = (grouped[mid] ||= { createdAt: ev.created_at, user: [], ai: [], aiType: undefined });
        // track earliest createdAt
        if (new Date(ev.created_at).getTime() < new Date(g.createdAt).getTime()) {
          g.createdAt = ev.created_at;
        }
        if (isUser) g.user.push(codeBlock as string);
        else {
          if (codeBlock) g.ai.push(codeBlock as string);
          if (isQualityAsk) g.aiType = "quality-confirmation" as const;
          else if (isSampleAsk) g.aiType = "sample-confirmation" as const;
          else if (isReqFeedback) g.aiType = "requirements-feedback" as const;
          else if (isTestingType) g.aiType = "testing-type-choice" as const;
          else if (isGapsFollowUp) g.aiType = "gaps-follow-up" as const;
        }
      });

      const result: Message[] = Object.entries(grouped)
        .sort((a, b) => new Date(a[1].createdAt).getTime() - new Date(b[1].createdAt).getTime())
        .flatMap(([mid, g]) => {
          const msgs: Message[] = [];
          if (g.user.length) {
            msgs.push({
              id: `user-${mid}`,
              role: "user",
              content: g.user.join("\n\n"),
              timestamp: new Date(g.createdAt),
              type: "normal",
            });
          }
          if (g.ai.length) {
            msgs.push({
              id: `ai-${mid}`,
              role: "ai",
              content: g.ai.join("\n\n"),
              timestamp: new Date(g.createdAt),
              type: g.aiType || "normal",
            });
          }
          return msgs;
        });

      setMessages((prev) => {
        const serverMessages = result;
        const localUserMessages = prev.filter(
          (m) => m.role === "user" && String(m.id || "").startsWith("local-")
        );
        const merged = [...serverMessages];
        localUserMessages.forEach((lm) => {
          const exists = serverMessages.some(
            (sm) =>
              sm.role === "user" &&
              normalizeMarkdown(sm.content || "").trim() ===
                normalizeMarkdown(lm.content || "").trim()
          );
          if (!exists) merged.push(lm);
        });
        return merged.sort(
          (a, b) =>
            (a.timestamp?.getTime?.() || 0) - (b.timestamp?.getTime?.() || 0)
        );
      });
      setInitialChatLoading(false);
      hasLoadedChatOnce.current = true;
    } catch (e) {
      console.error("Failed to load team events", e);
      setInitialChatLoading(false);
      hasLoadedChatOnce.current = true;
    }
  };
  const [selectedArtifact, setSelectedArtifact] = useState<{
    type: string;
    id: string;
  } | null>(null);
  const [suiteStatus, setSuiteStatus] = useState<"idle" | "running" | "paused">(
    "idle"
  );
  // Removed chatMode - AI always asks for permission now
  const [loadingStates, setLoadingStates] = useState<{
    requirements?: boolean;
    viewpoints?: boolean;
    testCases?: boolean;
  }>({});

  // Mock uploaded files
  const uploadedFiles = [
    { id: "file1", name: "requirements-doc.pdf", type: "application/pdf" },
    {
      id: "file2",
      name: "user-stories.docx",
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    {
      id: "file3",
      name: "test-plan.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    { id: "file4", name: "api-specification.json", type: "application/json" },
  ];

  // Version management state
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showSaveVersionDialog, setShowSaveVersionDialog] = useState(false);
  const [saveAsCheckpoint, setSaveAsCheckpoint] = useState(false);

  // Initialize version manager
  const versionManager = useVersionManager({
    requirements,
    viewpoints,
    testCases,
  });

  const { id } = useParams();

  // Helper: condense noisy team_events payloads into concise chat messages
  const normalizeMarkdown = (text: string): string => {
    // Convert common escaped sequences to real characters for proper markdown rendering
    try {
      return (
        (text || "")
          .replace(/\\r\\n/g, "\n")
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "  ")
          // Strip a trailing TERMINATE token (case-insensitive) if present at the end
          .replace(/\s*TERMINATE\s*$/i, "")
      );
    } catch {
      return text;
    }
  };
  // Flatten test_cases rows so each individual case becomes a row in the deliverables table
  const stringifyCompact = (val: any): string => {
    if (val == null) return "";
    if (typeof val === "string") return val;
    if (Array.isArray(val)) return val.map((x) => String(x)).join("; ");
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  };
  const sortAnyById = (rows: any[]): any[] => {
    try {
      return [...(rows || [])].sort((a, b) =>
        String(a?.id ?? "").localeCompare(String(b?.id ?? ""), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
    } catch {
      return rows || [];
    }
  };
  const sortRequirementsByReqCode = (rows: any[]): any[] => {
    try {
      return [...(rows || [])].sort((a, b) =>
        String(a?.req_code ?? "").localeCompare(
          String(b?.req_code ?? ""),
          undefined,
          { numeric: true, sensitivity: "base" }
        )
      );
    } catch {
      return rows || [];
    }
  };
  // Special rendering for certain AI tool events
  const renderSpecialAiEvent = (payload: any): string | null => {
    try {
      const type = payload?.type;
      const source = payload?.source;
      const first = Array.isArray(payload?.content) ? payload.content[0] : undefined;
      const name = first?.name as string | undefined;
      // Version announcement placeholder (handled specially in ChatPanel)
      if (type === "new_version") {
        const version = (() => {
          try {
            const v = payload?.version;
            return typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
          } catch { return undefined; }
        })();
        const description = String(payload?.description ?? "");
        const body = JSON.stringify({ version, description });
        return `<<<VERSION_BUTTON:${body}>>>`;
      }
      // Requirements extractor progress messages
      if (type === "ToolCallRequestEvent" && source === "requirements_extractor" && name === "extract_requirements") {
        return "⏳ Generating requirements...";
      }
      if (type === "ToolCallExecutionEvent" && source === "requirements_extractor" && name === "extract_requirements") {
        return "✅ Requirements generated successfully.";
      }
      if (type === "ToolCallRequestEvent" && source === "requirements_extractor" && name === "generate_test_design") {
        return "⏳ I'm generating test design...";
      }
      if (type === "ToolCallExecutionEvent" && source === "requirements_extractor" && name === "generate_test_design") {
        return "✅ Test design generated successfully.";
      }
      if (type === "ToolCallRequestEvent" && source === "requirements_extractor" && name === "generate_viewpoints") {
        return "⏳ I'm generating viewpoints...";
      }
      if (type === "ToolCallExecutionEvent" && source === "requirements_extractor" && name === "generate_viewpoints") {
        return "✅ Viewpoints generated successfully.";
      }
      // Testcase writer: integration test cases generation
      if (type === "ToolCallRequestEvent" && source === "testcase_writer" && name === "generate_integration_testcases_for_req") {
        return "⏳ I'm generating integration test cases...";
      }
      if (type === "ToolCallExecutionEvent" && source === "testcase_writer" && name === "generate_integration_testcases_for_req") {
        return "✅ Integration test cases generated.";
      }
      // Testcase writer: edit test cases flow
      if (type === "ToolCallRequestEvent" && source === "testcase_writer" && name === "edit_testcases_for_req") {
        return "⏳ I'm editing test cases...";
      }
      if (type === "ToolCallExecutionEvent" && source === "testcase_writer" && name === "edit_testcases_for_req") {
        return "✅ Edited test cases.";
      }
      if (type === "ToolCallRequestEvent" && source === "planner" && name === "transfer_to_fetcher") {
        return "⏳ I'm transferring to the fetcher...";
      }
      if (type === "ToolCallExecutionEvent" && source === "planner" && name === "transfer_to_fetcher") {
        return "✅ Transfer complete.";
      }
      if (type === "ToolCallRequestEvent" && source === "fetcher" && name === "store_docs_from_blob") {
        let docs: string[] = [];
        try {
          const args = first?.arguments ? JSON.parse(first.arguments) : {};
          if (Array.isArray(args?.doc_names)) docs = args.doc_names;
        } catch {}
        const suffix = docs.length ? `: ${docs.join(", ")}` : "";
        return `⏳ I'm fetching documents${suffix}...`;
      }
      if (type === "ToolCallExecutionEvent" && source === "fetcher" && name === "store_docs_from_blob") {
        // Parse result content and render friendly summary
        let stored: string[] = [];
        let missing: string[] = [];
        try {
          const raw = String(first?.content ?? "");
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // Try converting python-like dict to JSON
            const normalized = raw
              .replace(/'/g, '"')
              .replace(/\bNone\b/g, 'null')
              .replace(/\bTrue\b/g, 'true')
              .replace(/\bFalse\b/g, 'false');
            parsed = JSON.parse(normalized);
          }
          if (Array.isArray(parsed?.stored)) stored = parsed.stored;
          if (Array.isArray(parsed?.missing)) missing = parsed.missing;
        } catch {}
        const storedText = stored.length ? stored.join(", ") : "none";
        const missingText = missing.length ? missing.join(", ") : "none";
        return `✅ Documents fetched. Stored: ${storedText}. Missing: ${missingText}.`;
      }

      // Planner: identify_gaps loading/result
      if (type === "ToolCallRequestEvent" && source === "planner" && name === "identify_gaps") {
        return "⏳ I'm analyzing gaps in the documents...";
      }
      if (type === "ToolCallExecutionEvent" && source === "planner" && name === "identify_gaps") {
        // The execution result will be followed by a friendly ask_user(gaps_follow_up); suppress duplicate text here
        return null;
      }

      // Planner: restore_suite_version request/result
      if (type === "ToolCallRequestEvent" && source === "planner" && name === "restore_suite_version") {
        try {
          const args = first?.arguments ? JSON.parse(first.arguments) : {};
          const sv = args?.source_version;
          const svNum = typeof sv === "number" ? sv : parseInt(String(sv ?? ""), 10);
          const verText = Number.isFinite(svNum) ? ` version ${svNum}` : " a chosen version";
          return `⏳ Restoring from${verText}...`;
        } catch {
          return "⏳ Restoring from selected version...";
        }
      }
      if (type === "ToolCallExecutionEvent" && source === "planner" && name === "restore_suite_version") {
        try {
          let bodyRaw = String(first?.content ?? "");
          let parsed: any;
          try {
            parsed = JSON.parse(bodyRaw);
          } catch {
            const normalized = bodyRaw
              .replace(/'/g, '"')
              .replace(/\bNone\b/g, 'null')
              .replace(/\bTrue\b/g, 'true')
              .replace(/\bFalse\b/g, 'false');
            parsed = JSON.parse(normalized);
          }
          const nv = parsed?.new_version;
          const rf = parsed?.restored_from;
          const nvNum = typeof nv === "number" ? nv : parseInt(String(nv ?? ""), 10);
          const rfNum = typeof rf === "number" ? rf : parseInt(String(rf ?? ""), 10);
          if (Number.isFinite(nvNum) && Number.isFinite(rfNum)) {
            return `✅ Restored to version ${nvNum} (from v${rfNum}).`;
          }
          return "✅ Restore completed.";
        } catch {
          return "✅ Restore completed.";
        }
      }

      // Planner: list/get test case information (concise)
      if (type === "ToolCallRequestEvent" && source === "planner" && name === "get_testcases_info") {
        return "⏳ I'm retrieving test case information...";
      }
      if (type === "ToolCallExecutionEvent" && source === "planner" && name === "get_testcases_info") {
        return "✅ Test case information retrieved.";
      }

      // Planner: list/get requirements information (concise)
      if (type === "ToolCallRequestEvent" && source === "planner" && name === "get_requirements_info") {
        return "⏳ I'm retrieving requirements information...";
      }
      if (type === "ToolCallExecutionEvent" && source === "planner" && name === "get_requirements_info") {
        return "✅ Requirements information retrieved.";
      }

      // Generic transfer_to_* handling for all agents (planner/fetcher/requirements_extractor/testcase_writer)
      if (type === "ToolCallRequestEvent" && typeof name === "string" && name.startsWith("transfer_to_")) {
        const target = name.replace("transfer_to_", "").replace(/_/g, " ");
        return `⏳ Transferring to ${target}...`;
      }
      if (type === "ToolCallExecutionEvent" && typeof name === "string" && name.startsWith("transfer_to_")) {
        const target = name.replace("transfer_to_", "").replace(/_/g, " ");
        return `✅ Transfer to ${target} complete.`;
      }
    } catch {}
    return null;
  };
  const flattenTestCaseRows = (rows: any[]): any[] => {
    try {
      const out: any[] = [];
      (rows || []).forEach((r) => {
        const content = (() => {
          const c = r?.content;
          if (typeof c === "string") {
            try {
              return JSON.parse(c);
            } catch {
              return {};
            }
          }
          return c || {};
        })();
        const reqId =
          content?.requirement_id || r?.requirement_id || r?.id || "";
        // Try to extract a version number from common locations; default to 1 if missing
        const version = (() => {
          try {
            const candidates: any[] = [
              (r as any)?.version,
              (r as any)?.ver,
              (r as any)?.v,
              (r as any)?.testcases_version,
              (r as any)?.test_case_version,
              content?.version,
              content?.testcases?.version,
              content?.test_cases?.version,
              (r as any)?.new_version,
              (r as any)?.current_version,
            ];
            for (const cand of candidates) {
              const n =
                typeof cand === "number"
                  ? cand
                  : parseInt(String(cand ?? ""), 10);
              if (!Number.isNaN(n) && n > 0) return n;
            }
          } catch {}
          return 1;
        })();
        const cases = Array.isArray(content?.cases) ? content.cases : [];
        if (cases.length === 0) return;
        cases.forEach((c: any, idx: number) => {
          const caseIdRaw = c?.id;
          const caseId =
            caseIdRaw && String(caseIdRaw).trim()
              ? stringifyCompact(caseIdRaw)
              : `${reqId || "TC"}-${idx + 1}`;
          out.push({
            id: caseId,
            title: stringifyCompact(c?.title),
            steps: (() => {
              try {
                const s = c?.steps;
                if (Array.isArray(s)) return s.map((x: any) => String(x)).join("\n");
                if (typeof s === "string") {
                  console.log(s)

                  // Normalize any escaped newlines and convert common list separators to newlines
                  return String(s)
                    .replace(/\\r\\n/g, "\n")
                    .replace(/\\n/g, "\n")
                    .replace(/\s*;\s*/g, "\n");
                }
                return stringifyCompact(s);
              } catch {
                return stringifyCompact(c?.steps);
              }
            })(),
            expected_result: stringifyCompact(c?.expected),
            severity: stringifyCompact(c?.type),
            links: (() => {
              try {
                const caseLinks = (c as any)?.links;
                const fromCase = Array.isArray(caseLinks?.flows) ? caseLinks.flows : [];
                const fromTop = Array.isArray((content as any)?.linked_flows)
                  ? (content as any).linked_flows
                  : [];
                const merged = [...fromCase, ...fromTop].map((x: any) => String(x));
                // de-duplicate while preserving order
                const seen = new Set<string>();
                const unique = merged.filter((v) => (seen.has(v) ? false : (seen.add(v), true)));
                const flowsStr = unique.join(", ");

                const vpFromCase = Array.isArray(caseLinks?.viewpoints) ? caseLinks.viewpoints : [];
                const vpFromTop = Array.isArray((content as any)?.linked_viewpoints)
                  ? (content as any).linked_viewpoints
                  : [];
                const vpMerged = [...vpFromCase, ...vpFromTop].map((x: any) => String(x));
                const vpSeen = new Set<string>();
                const vpUnique = vpMerged.filter((v) => (vpSeen.has(v) ? false : (vpSeen.add(v), true)));
                const vpsStr = vpUnique.join(", ");

                const parts: string[] = [];
                if (reqId) parts.push(`Requirement: ${reqId}`);
                if (flowsStr) parts.push(`Flows: ${flowsStr}`);
                if (vpsStr) parts.push(`Viewpoints: ${vpsStr}`);
                return parts.join("\n");
              } catch {
                return "";
              }
            })(),
            requirement_id: reqId,
            version,
          });
        });
      });
      return out;
    } catch {
      return [];
    }
  };
  // Keep only the latest test case rows per requirement based on the highest version
  const filterLatestTestcasesByRequirement = (rows: any[]): any[] => {
    try {
      const latestByReq: Record<string, number> = {};
      for (const row of rows || []) {
        const rid = String(row?.requirement_id ?? "");
        if (!rid) continue;
        const v =
          typeof row?.version === "number"
            ? row.version
            : parseInt(String(row?.version ?? ""), 10) || 1;
        if (latestByReq[rid] == null || v > latestByReq[rid])
          latestByReq[rid] = v;
      }
      return (rows || []).filter((row) => {
        const rid = String(row?.requirement_id ?? "");
        if (!rid) return false;
        const v =
          typeof row?.version === "number"
            ? row.version
            : parseInt(String(row?.version ?? ""), 10) || 1;
        return v === latestByReq[rid];
      });
    } catch {
      return rows || [];
    }
  };
  const sortTestCasesByReqThenId = (rows: any[]): any[] => {
    try {
      const toStr = (v: any) => String(v == null ? "" : v);
      return [...(rows || [])].sort((a, b) => {
        const ra = toStr(a?.requirement_id);
        const rb = toStr(b?.requirement_id);
        const cmpReq = ra.localeCompare(rb, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (cmpReq !== 0) return cmpReq;
        return toStr(a?.id).localeCompare(toStr(b?.id), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
    } catch {
      return rows || [];
    }
  };
 
  // Initialize with context-aware continuation from suite creation
  useEffect(() => {
    void loadTeamEvents();
  }, []);

  // Load artifacts strictly for the latest suite version
  useEffect(() => {
    const loadDynamicForVersion = async () => {
      try {
        setLoadingStates({ requirements: true, testCases: true });
        const suiteIdParam = new URLSearchParams(window.location.search).get(
          "suiteId"
        );
        const suiteIdVal = id || suiteIdParam || undefined;
        if (!suiteIdVal || latestSuiteVersion == null) return;
        const version = latestSuiteVersion;
        const [{ data: reqs }, { data: tcs }, { data: tds }, { data: tvps }] =
          await Promise.all([
            supabase
              .from("requirements")
              .select("*")
              .eq("suite_id", suiteIdVal)
              .eq("version", version),
            supabase
              .from("test_cases")
              .select("*")
              .eq("suite_id", suiteIdVal)
              .eq("version", version),
            supabase
              .from("test_designs")
              .select("*")
              .eq("suite_id", suiteIdVal)
              .eq("version", version),
            supabase
              .from("viewpoints")
              .select("*")
              .eq("suite_id", suiteIdVal)
              .eq("version", version),
          ]);
        setDynamicRequirementsRows(sortRequirementsByReqCode(reqs || []));
        {
          const flattened = flattenTestCaseRows(tcs || []);
          setDynamicTestCaseRows(sortTestCasesByReqThenId(flattened));
        }
        setDynamicTestDesignRows(tds || []);
        setDynamicTestViewpointRows(tvps || []);
      } catch (e) {
        console.error("Failed to fetch dynamic artifacts for version", e);
      } finally {
        setLoadingStates({});
      }
    };
    void loadDynamicForVersion();
  }, [id, latestSuiteVersion]);

  // Realtime subscription to team_events for this suite
  useEffect(() => {
    const suiteIdParam = new URLSearchParams(window.location.search).get(
      "suiteId"
    );
    const suiteIdVal = id || suiteIdParam || undefined;
    if (!suiteIdVal) return;

    const channel = supabase
      .channel(`team_events:${suiteIdVal}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "team_events",
          filter: `suite_id=eq.${suiteIdVal}`,
        },
        (payload) => {
          const ev: any = payload.new;
          let parsed: any;
          try {
            parsed = typeof ev.payload === "string" ? JSON.parse(ev.payload) : ev.payload;
          } catch {
            parsed = ev.payload;
          }
          const isUser = parsed && parsed.source === "user";
          const mid = String(ev.message_id);
          const special = isUser ? null : renderSpecialAiEvent(parsed);
          console.log(parsed)
          // If a restore succeeded, force-refresh latest version scoped artifacts
          try {
            if (
              !isUser &&
              parsed?.type === "ToolCallExecutionEvent" &&
              Array.isArray(parsed?.content) &&
              parsed?.content[0]?.name === "restore_suite_version" &&
              parsed?.content[0]?.is_error === false
            ) {
              // Reload status to get updated latest version, then reload artifacts
              setTimeout(() => {
                try {
                  // trigger status effect by re-setting id deps indirectly
                  const suiteIdParam2 = new URLSearchParams(window.location.search).get("suiteId");
                  const suiteIdVal2 = id || suiteIdParam2 || undefined;
                  if (!suiteIdVal2) return;
                  // quick status poll
                  supabase
                    .from("test_suites")
                    .select("status, state")
                    .eq("id", suiteIdVal2)
                    .maybeSingle()
                    .then(({ data }) => {
                      try {
                        const st2: any = (data as any)?.state;
                        const raw2 = st2?.agent_state?.latest_version ?? st2?.latest_version ?? st2?.agent_state?.latest_testcases_version ?? st2?.latest_testcases_version;
                        const parsed2 = typeof raw2 === "number" ? raw2 : parseInt(String(raw2 ?? ""), 10);
                        if (!Number.isNaN(parsed2)) {
                          setLatestSuiteVersion(parsed2);
                        }
                      } catch {}
                    });
                } catch {}
              }, 100);
            }
          } catch {}
          const isQualityAsk = !isUser && parsed?.type === "ask_user" && ((parsed?.event_type || parsed?.eventType) === "quality_confirmation");
          const isSampleAsk = !isUser && parsed?.type === "ask_user" && ((parsed?.event_type || parsed?.eventType) === "sample_confirmation");
          const isTestingType = !isUser && parsed?.type === "ask_user" && ((parsed?.event_type || parsed?.eventType) === "testing_type_choice");
          const isGapsFollowUp = !isUser && parsed?.type === "ask_user" && ((parsed?.event_type || parsed?.eventType) === "gaps_follow_up");
          const isReqFeedback = !isUser && parsed?.type === "ask_user" && ((parsed?.event_type || parsed?.eventType) === "requirements_feedback");
          const aiTypeNew: Message["type"] = (
            isQualityAsk ? "quality-confirmation" :
            isSampleAsk ? "sample-confirmation" :
            isReqFeedback ? "requirements-feedback" :
            isTestingType ? "testing-type-choice" :
            isGapsFollowUp ? "gaps-follow-up" :
            "normal"
          ) as Message["type"];
          const reqFeedbackText = isReqFeedback ? String(parsed?.response_to_user || parsed?.responseToUser || "") : "";

          // Preview now returns table text only; no preview data suffix
          let previewDataSuffix: string | null = null;

          const aiTextMessage = !isUser && String(parsed?.type || "") === "TextMessage" && typeof parsed?.content === "string"
            ? normalizeMarkdown(String(parsed?.content ?? "")).replace(/\bTERMINATE\b/gi, "").trim()
            : null;
          const codeBlock = isUser
            ? (typeof parsed?.content === "string"
                ? parsed.content
                : String(parsed?.content ?? ""))
            : (
                (isQualityAsk || isSampleAsk || isReqFeedback || isTestingType || isGapsFollowUp) && typeof (parsed?.response_to_user || parsed?.responseToUser) === "string"
                  ? (String(parsed?.response_to_user || parsed?.responseToUser))
                  : (aiTextMessage ?? special ?? "")
              );

          setMessages((prev) => {
            // Find existing user/ai blocks for this message id
            const next = [...prev];
            const userIdx = next.findIndex((m) => m.id === `user-${mid}`);
            const aiIdx = next.findIndex((m) => m.id === `ai-${mid}`);
            if (isUser) {
              // Replace matching local optimistic user message if present
              const localIdx = next.findIndex(
                (m) =>
                  m.role === "user" &&
                  String(m.id || "").startsWith("local-") &&
                  normalizeMarkdown(m.content || "").trim() ===
                    normalizeMarkdown(codeBlock || "").trim()
              );
              if (localIdx >= 0) {
                next[localIdx] = {
                  id: `user-${mid}`,
                  role: "user",
                  content: codeBlock,
                  timestamp: new Date(ev.created_at),
                  type: "normal",
                } as any;
              } else if (userIdx >= 0) {
                next[userIdx] = {
                  ...next[userIdx],
                  content: next[userIdx].content
                    ? `${next[userIdx].content}\n\n${codeBlock}`
                    : codeBlock,
                } as any;
              } else {
                next.push({
                  id: `user-${mid}`,
                  role: "user",
                  content: codeBlock,
                  timestamp: new Date(ev.created_at),
                  type: "normal",
                });
              }
            } else {
              if (aiIdx >= 0) {
                next[aiIdx] = {
                  ...next[aiIdx],
                  content: (codeBlock
                    ? (next[aiIdx].content
                        ? `${next[aiIdx].content}\n\n${codeBlock}`
                        : codeBlock)
                    : next[aiIdx].content),
                  type: aiTypeNew || next[aiIdx].type
                } as any;
              } else {
                // For ask_user events, special is often null; still push if we have text content
                if (special !== null || codeBlock) {
                  next.push({
                    id: `ai-${mid}`,
                    role: "ai",
                    content: codeBlock || special || "",
                    timestamp: new Date(ev.created_at),
                    type: aiTypeNew,
                  });
                }
              }
            }
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [id]);

  // Realtime subscriptions for requirements and test_cases
  useEffect(() => {
    const suiteIdParam = new URLSearchParams(window.location.search).get(
      "suiteId"
    );
    const suiteIdVal = id || suiteIdParam || undefined;
    if (!suiteIdVal || latestSuiteVersion == null) return;
    const version = latestSuiteVersion;

    const channel = supabase
      .channel(`artifacts:${suiteIdVal}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "requirements",
          filter: `suite_id=eq.${suiteIdVal}`,
        },
        async () => {
          try {
            const { data } = await supabase
              .from("requirements")
              .select("*")
              .eq("suite_id", suiteIdVal)
              .eq("version", version);
            setDynamicRequirementsRows(sortRequirementsByReqCode(data || []));
            // Jump to requirements tab on any realtime change
            setActiveArtifactsTab("requirements");
          } catch (e) {
            console.error("Failed to refresh requirements (realtime)", e);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "test_cases",
          filter: `suite_id=eq.${suiteIdVal}`,
        },
        async () => {
          try {
            const { data } = await supabase
              .from("test_cases")
              .select("*")
              .eq("suite_id", suiteIdVal)
              .eq("version", version);
            {
              const flattened = flattenTestCaseRows(data || []);
              setDynamicTestCaseRows(sortTestCasesByReqThenId(flattened));
            }
            // Jump to test cases tab on any realtime change
            setActiveArtifactsTab("testcases");
          } catch (e) {
            console.error("Failed to refresh test cases (realtime)", e);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "test_designs",
          filter: `suite_id=eq.${suiteIdVal}`,
        },
        async () => {
          try {
            const { data } = await supabase
              .from("test_designs")
              .select("*")
              .eq("suite_id", suiteIdVal)
              .eq("version", version);
            setDynamicTestDesignRows(data || []);
            // Jump to test design tab on any realtime change
            setActiveArtifactsTab("test_design");
          } catch (e) {
            console.error("Failed to refresh test designs (realtime)", e);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "viewpoints",
          filter: `suite_id=eq.${suiteIdVal}`,
        },
        async () => {
          try {
            const { data } = await supabase
              .from("viewpoints")
              .select("*")
              .eq("suite_id", suiteIdVal)
              .eq("version", version);
            setDynamicTestViewpointRows(data || []);
            // Jump to test viewpoints tab on any realtime change
            setActiveArtifactsTab("test_viewpoints");
          } catch (e) {
            console.error("Failed to refresh viewpoints (realtime)", e);
          }
        }
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [id, latestSuiteVersion]);

  // Listen to suite status (chatting/idle) from 'test_suites' table and set spinner
  useEffect(() => {
    const suiteIdParam = new URLSearchParams(window.location.search).get(
      "suiteId"
    );
    const suiteIdVal = id || suiteIdParam || undefined;
    if (!suiteIdVal) return;

    const loadStatus = async () => {
      try {
        const { data } = await supabase
          .from("test_suites")
          .select("status, state")
          .eq("id", suiteIdVal)
          .maybeSingle();
        const status = (data as any)?.status as string | undefined;
        setAgentLoading(status === "chatting" || status === "running");
        const st = (data as any)?.state as any;
        const rawLatest =
          st?.agent_state?.latest_version ??
          st?.latest_version ??
          st?.agent_state?.latest_testcases_version ??
          st?.latest_testcases_version;
        const parsed =
          typeof rawLatest === "number"
            ? rawLatest
            : parseInt(String(rawLatest ?? ""), 10);
        if (!Number.isNaN(parsed)) {
          setLatestSuiteVersion(parsed);
        }
      } catch {}
    };
    void loadStatus();

    const channel = supabase
      .channel(`test_suites:${suiteIdVal}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "test_suites",
          filter: `id=eq.${suiteIdVal}`,
        },
        (payload) => {
          const nextStatus = (payload.new as any)?.status as string | undefined;
          setAgentLoading(
            nextStatus === "chatting" || nextStatus === "running"
          );
          try {
            const st = (payload.new as any)?.state as any;
            const rawLatest =
              st?.agent_state?.latest_version ??
              st?.latest_version ??
              st?.agent_state?.latest_testcases_version ??
              st?.latest_testcases_version;
            const parsed =
              typeof rawLatest === "number"
                ? rawLatest
                : parseInt(String(rawLatest ?? ""), 10);
            if (!Number.isNaN(parsed)) {
              setLatestSuiteVersion(parsed);
            }
          } catch {}
        }
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [id]);


  const handleGenerateArtifacts = async (requirementId: string) => {
    const requirement = requirements.find((req) => req.id === requirementId);
    if (!requirement) return;

    setIsLoading(true);

    // Add AI message indicating generation started
    const generationMessage: Message = {
      id: `generation-${Date.now()}`,
      role: "ai",
      content: `🚀 **Generating Related Artifacts for ${requirementId}**\n\nAnalyzing requirement: "${requirement.description}"\n\nGenerating:\n• Testing viewpoints based on requirement scope\n• Initial test cases for validation\n• Establishing traceability links\n\nThis will take a moment...`,
      timestamp: new Date(),
      type: "normal",
    };
    setMessages((prev) => [...prev, generationMessage]);

    // Simulate AI processing time
    setTimeout(() => {
      // Generate new viewpoint
      const newViewpointId = `VP-${String(viewpoints.length + 1).padStart(
        2,
        "0"
      )}`;
      const newViewpoint: Viewpoint = {
        id: newViewpointId,
        area:
          requirement.description.includes("security") ||
          requirement.description.includes("authentication")
            ? "Security & Authentication"
            : requirement.description.includes("inventory")
            ? "Data Management"
            : "Functional Testing",
        intent: `Validate requirements related to: ${requirement.description}`,
        dataVariants: "Valid/Invalid inputs, Edge cases, Boundary conditions",
        notes: `Auto-generated viewpoint for requirement ${requirementId}`,
        linkedRequirements: [requirementId],
        linkedTestCases: [],
        lastModified: new Date(),
        changeHistory: [],
      };

      // Generate test cases
      const newTestCases: TestCase[] = [];
      for (let i = 0; i < 2; i++) {
        const tcId = `TC-${String(
          testCases.length + newTestCases.length + 1
        ).padStart(2, "0")}`;
        newTestCases.push({
          id: tcId,
          title: `Test ${requirement.description} - Scenario ${i + 1}`,
          steps: `1. Navigate to relevant feature\n2. Execute test scenario for ${requirement.description}\n3. Verify expected behavior`,
          expectedResult: `Feature behaves as specified in ${requirementId}`,
          severity: requirement.priority as "High" | "Medium" | "Low",
          reqIds: [requirementId],
          viewpointIds: [newViewpointId],
          tags: ["auto-generated", "functional"],
          locked: false,
          lastModified: new Date(),
          changeHistory: [],
        });
      }

      // Update viewpoint with test case links
      newViewpoint.linkedTestCases = newTestCases.map((tc) => tc.id);

      // Update requirement status and links
      const updatedRequirements = requirements.map((req) =>
        req.id === requirementId
          ? {
              ...req,
              relationshipStatus: "Complete" as const,
              linkedViewpoints: [...req.linkedViewpoints, newViewpointId],
              linkedTestCases: [
                ...req.linkedTestCases,
                ...newTestCases.map((tc) => tc.id),
              ],
              lastModified: new Date(),
            }
          : req
      );

      // Update states
      setRequirements(updatedRequirements);
      setViewpoints((prev) => [...prev, newViewpoint]);
      setTestCases((prev) => [...prev, ...newTestCases]);

      // Mark as having unsaved changes for version management
      versionManager.markUnsavedChanges();

      // Add completion message
      const completionMessage: Message = {
        id: `completion-${Date.now()}`,
        role: "ai",
        content: `✅ **Artifacts Generated Successfully!**\n\n**Created for ${requirementId}: "${
          requirement.description
        }"**\n\n🎯 **New Viewpoint:** ${newViewpointId} - ${
          newViewpoint.area
        }\n📋 **Test Cases:** ${newTestCases
          .map((tc) => tc.id)
          .join(
            ", "
          )}\n🔗 **Traceability:** Full coverage established\n\nRequirement status updated to "Complete". All artifacts are now linked and ready for review.`,
        timestamp: new Date(),
        type: "normal",
        hasModifiedArtifacts: true,
      };
      setMessages((prev) => [...prev, completionMessage]);

      // Show success toast
      toast({
        title: "Artifacts Generated",
        description: `Created viewpoint and test cases for ${requirementId}`,
      });

      setIsLoading(false);
    }, 2000);
  };

  const handleSendMessage = async (
    message: string,
    opts?: { silent?: boolean }
  ) => {
    const baseId = Date.now().toString();
    const type = message.startsWith("/") ? "command" : "normal";
    const userMessage: Message = {
      id: type === "normal" ? `local-${baseId}` : baseId,
      role: "user",
      content: message,
      timestamp: new Date(),
      type,
    };
    // Optimistically append user message for better UX
    if (!opts?.silent) {
      setMessages((prev) => [...prev, userMessage]);
    }
    setIsLoading(true);
    // If this is a normal chat message, stream from backend API
    if (userMessage.type === "normal") {
      try {
        const apiBase =
          (import.meta as any).env?.VITE_API_BASE_URL ||
          "http://localhost:8000";
        const suiteIdParam = new URLSearchParams(window.location.search).get(
          "suiteId"
        );
        const suiteId = id || suiteIdParam || undefined;
        if (!suiteId) {
          throw new Error("Missing suiteId for streaming.");
        }
        const response = await fetch(`${apiBase}/run/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task: message, suite_id: suiteId }),
        });

        if (!response.body) {
          throw new Error("No response body from API");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let idx;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            // Consume lines silently; we'll reload messages from team_events
            try {
              JSON.parse(line);
            } catch {}
          }
        }
      } catch (err) {
        toast({
          title: "Chat error",
          description: (err as Error).message,
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
        // Reload from team_events, preserving any still-pending local messages
        void loadTeamEvents();
      }
      return;
    }

    // Simulate AI processing for commands and special flows
    setTimeout(() => {
      let aiResponse = "";
      let hasModifiedArtifacts = false;
      const lowerMessage = message.toLowerCase();

      // Handle implementation permission
      if (message.startsWith("IMPLEMENT_PLAN:")) {
        const messageId = message.replace("IMPLEMENT_PLAN:", "");
        const planMessage = messages.find((msg) => msg.id === messageId);

        if (planMessage && planMessage.implementationPlan) {
          aiResponse = `✅ **Implementation Started**\n\nExecuting the planned changes:\n${planMessage.implementationPlan}\n\n📝 Artifacts have been generated and updated accordingly.`;
          hasModifiedArtifacts = true;
        } else {
          aiResponse =
            "I couldn't find the implementation plan. Please try again.";
        }
      }
      // Handle next step selection
      else if (message.startsWith("NEXT_STEP:")) {
        const option = message.replace("NEXT_STEP:", "");

        if (option === "test-cases") {
          setLoadingStates({ testCases: true });
          setTimeout(() => {
            setLoadingStates({});
          }, 1000);

          aiResponse =
            "Perfect! I'm now generating example test cases for your requirements...";
        } else if (option === "viewpoints") {
          setLoadingStates({ viewpoints: true });
          setTimeout(() => {
            setLoadingStates({});
          }, 1000);

          aiResponse =
            "Great choice! I'm now generating viewpoints to analyze your requirements from different testing perspectives...";
        }

        hasModifiedArtifacts = false;
      }
      // Handle artifact selection
      else if (message.startsWith("ARTIFACT_SELECTION:")) {
        const selectedArtifacts = message
          .replace("ARTIFACT_SELECTION:", "")
          .split(",");
        const artifactNames = selectedArtifacts
          .map((id) => {
            switch (id) {
              case "requirements":
                return "Requirements";
              case "viewpoints":
                return "Testing Viewpoints";
              case "testcases":
                return "Test Cases";
              case "traceability":
                return "Traceability Matrix";
              default:
                return id;
            }
          })
          .join(", ");

        aiResponse = `Perfect! I'll plan to generate ${artifactNames} for your test suite. This will provide comprehensive coverage of your testing needs.\n\n📋 **Implementation Plan:**\n• Analyze existing requirements\n• Generate ${artifactNames.toLowerCase()}\n• Establish traceability links\n• Validate coverage completeness`;
        hasModifiedArtifacts = false; // AI always provides plans first, never immediate modifications
      }
      // Handle new requirement detection from chat
      else if (
        message.toLowerCase().includes("new requirement") ||
        message.toLowerCase().includes("add requirement") ||
        message.toLowerCase().includes("requirement:") ||
        (message.toLowerCase().includes("upload") &&
          message.toLowerCase().includes("requirement"))
      ) {
        // Simulate detecting new requirements from user input
        const newReqId = `R-${String(requirements.length + 1).padStart(
          3,
          "0"
        )}`;
        const newRequirement: Requirement = {
          id: newReqId,
          description: message.toLowerCase().includes("requirement:")
            ? message.split("requirement:")[1].trim()
            : "User-defined requirement from chat discussion",
          priority: "Medium",
          status: "Parsed",
          relationshipStatus: "New",
          linkedViewpoints: [],
          linkedTestCases: [],
          createdAt: new Date(), // Mark as just created
          lastModified: new Date(),
          changeHistory: [],
        };

        aiResponse = `✅ **New Requirement Detected!**\n\n**${newReqId}**: "${newRequirement.description}"\n\n📋 **Implementation Plan:**\n• Add requirement to workspace with "New" status\n• Generate related testing viewpoints\n• Create foundational test cases\n• Establish traceability links\n\nThis will provide a complete foundation for testing this requirement.`;
        hasModifiedArtifacts = false;
        versionManager.markUnsavedChanges();
      }
      // Handle specific artifact generation commands
      else if (message.includes("/sample")) {
        aiResponse =
          "📋 **Sample Test Cases Plan**\n\nI can generate comprehensive sample test cases for your suite:\n\n**Planned Test Cases:**\n• Functional authentication tests\n• Edge case scenarios\n• Integration test scenarios\n• Error handling tests\n\nEach test case will include detailed steps, expected outcomes, and traceability links.";
        hasModifiedArtifacts = false;
      } else if (message.includes("/viewpoints")) {
        aiResponse =
          "📋 **Testing Viewpoints Plan**\n\nI can create comprehensive testing viewpoints:\n\n**Planned Viewpoints:**\n• Functional Testing Viewpoint\n• Security Testing Viewpoint\n• Performance Testing Viewpoint\n• Usability Testing Viewpoint\n\nEach viewpoint will provide targeted testing strategies for comprehensive coverage.";
        hasModifiedArtifacts = false;
      } else if (
        message.toLowerCase().includes("generating artifacts") ||
        (message.toLowerCase().includes("generate") &&
          message.toLowerCase().includes("viewpoints")) ||
        (message.toLowerCase().includes("generate") &&
          message.toLowerCase().includes("requirements"))
      ) {
        aiResponse =
          "📋 **Comprehensive Test Suite Plan**\n\nI can create a complete test suite structure:\n\n**Planned Requirements:**\n• 8 functional requirements covering core functionality\n• 3 non-functional requirements for performance and security\n• 2 integration requirements for system compatibility\n\n**Planned Testing Viewpoints:**\n• Functional Testing Viewpoint\n• Security Testing Viewpoint\n• Performance Testing Viewpoint\n• Usability Testing Viewpoint\n• Integration Testing Viewpoint\n\nThis will provide comprehensive coverage for your testing needs.";
        hasModifiedArtifacts = false;
      }
      // Handle specific commands
      else if (message.startsWith("/sample")) {
        aiResponse =
          "📋 **Sample Test Cases Plan**\n\nI can generate sample test cases for authentication scenarios:\n\n**Planned Test Cases:**\n• Valid registration flows\n• Password validation scenarios\n• Email verification processes\n• Error handling cases\n\nEach test case will include detailed steps, expected results, and traceability links to requirements.";
        hasModifiedArtifacts = false;
      } else if (message.startsWith("/viewpoints")) {
        aiResponse =
          "📋 **Testing Viewpoints Plan**\n\nI can create comprehensive testing viewpoints:\n\n**Planned Viewpoints:**\n• **Functional Testing Viewpoint**: Core authentication features\n• **Security Testing Viewpoint**: Password policies and data protection\n• **Usability Testing Viewpoint**: User-friendly registration experience\n• **Performance Testing Viewpoint**: System behavior under load\n\nThese viewpoints will ensure no critical testing areas are overlooked.";
        hasModifiedArtifacts = false;
      } else if (message.startsWith("/export")) {
        aiResponse =
          "I'm preparing your test cases for export. You can choose from several formats:\n\n📄 **Excel (.xlsx)** - Structured spreadsheet with all test details\n📋 **CSV** - Simple comma-separated format for easy import\n📝 **Word (.docx)** - Formatted document ready for documentation\n🔗 **TestRail** - Direct import format for TestRail integration\n\nWhich format would you prefer?";
        hasModifiedArtifacts = false;
      } else if (message.startsWith("/upload")) {
        aiResponse =
          "I'm ready to analyze your requirements document. Please upload your file and I'll:\n\n🔍 **Extract Requirements** - Identify and parse all functional requirements\n📊 **Generate Test Cases** - Create comprehensive test cases for each requirement\n🎯 **Create Viewpoints** - Develop testing perspectives for thorough coverage\n🔗 **Build Traceability** - Link everything together for complete visibility\n\nSupported formats: PDF, Word (.docx), Excel (.xlsx), and plain text files.";
        hasModifiedArtifacts = false;
      }
      // Handle general AI responses
      else {
        const responses = [
          "I'm here to help you create comprehensive test suites. I can analyze requirements, create testing viewpoints, generate test cases, and establish traceability links. What would you like to work on?",
          "I can assist with building structured deliverables based on your requirements. Feel free to describe your testing needs or use commands like /sample, /viewpoints, or /upload.",
          "Let me know what testing artifacts you need and I'll create an implementation plan. I can generate requirements, viewpoints, test cases, and ensure proper coverage.",
          "I'm ready to help with test suite development. Describe your testing objectives and I'll plan the appropriate artifacts and traceability links.",
          "Feel free to describe your testing requirements or upload documents. I'll analyze them and propose a structured approach for comprehensive test coverage.",
        ];
        aiResponse = responses[Math.floor(Math.random() * responses.length)];
        hasModifiedArtifacts = false;
      }

      // Auto-save version for AI modifications
      let command = "";
      let versionInfo: ArtifactVersion | undefined = undefined;

      if (message.includes("/sample")) command = "/sample";
      else if (message.includes("/viewpoints")) command = "/viewpoints";
      else if (message.includes("ARTIFACT_SELECTION"))
        command = "ARTIFACT_SELECTION";
      else if (
        lowerMessage.includes("generating artifacts") ||
        (lowerMessage.includes("generate") &&
          lowerMessage.includes("viewpoints")) ||
        (lowerMessage.includes("generate") &&
          lowerMessage.includes("requirements"))
      ) {
        command = "/viewpoints"; // Treat as viewpoints generation
      }

      if (command && hasModifiedArtifacts) {
        const currentArtifacts = { requirements, viewpoints, testCases };
        versionInfo = versionManager.autoSaveVersion(currentArtifacts, command);
      }

      // Check if AI response needs implementation permission
      let needsImplementation = false;
      let implementationPlan = "";

      if (
        lowerMessage.includes("generate") ||
        lowerMessage.includes("/sample") ||
        lowerMessage.includes("/viewpoints")
      ) {
        needsImplementation = true;
        implementationPlan = aiResponse;
      }

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "ai",
        content: aiResponse,
        timestamp: new Date(),
        type: "normal",
        needsImplementation: needsImplementation,
        implementationPlan: implementationPlan,
        versionInfo: versionInfo,
        hasModifiedArtifacts: hasModifiedArtifacts,
      };

      setMessages((prev) => [...prev, aiMessage]);
      setIsLoading(false);
    }, 1500);
  };
  const handleUpdateRequirement = (
    id: string,
    data: Partial<Requirement>,
    field?: string,
    oldValue?: string
  ) => {
    setRequirements((prev) =>
      prev.map((req) => {
        if (req.id === id) {
          const updated = {
            ...req,
            ...data,
            lastModified: new Date(),
            changeHistory:
              field && oldValue
                ? [
                    ...req.changeHistory,
                    {
                      timestamp: new Date(),
                      field,
                      oldValue,
                      newValue: data[field as keyof Requirement] as string,
                    },
                  ]
                : req.changeHistory,
          };

          // Trigger impact analysis
          if (field && oldValue !== data[field as keyof Requirement]) {
            analyzeChangeImpact("requirement", id, field);
          }
          return updated;
        }
        return req;
      })
    );

    // Mark as having unsaved changes
    versionManager.markUnsavedChanges();
  };
  const handleUpdateViewpoint = (
    id: string,
    data: Partial<Viewpoint>,
    field?: string,
    oldValue?: string
  ) => {
    setViewpoints((prev) =>
      prev.map((vp) => {
        if (vp.id === id) {
          const updated = {
            ...vp,
            ...data,
            lastModified: new Date(),
            changeHistory:
              field && oldValue
                ? [
                    ...vp.changeHistory,
                    {
                      timestamp: new Date(),
                      field,
                      oldValue,
                      newValue: data[field as keyof Viewpoint] as string,
                    },
                  ]
                : vp.changeHistory,
          };

          // Trigger impact analysis
          if (field && oldValue !== data[field as keyof Viewpoint]) {
            analyzeChangeImpact("viewpoint", id, field);
          }
          return updated;
        }
        return vp;
      })
    );

    // Mark as having unsaved changes
    versionManager.markUnsavedChanges();
  };
  const handleUpdateTestCase = (
    id: string,
    data: Partial<TestCase>,
    field?: string,
    oldValue?: string
  ) => {
    setTestCases((prev) =>
      prev.map((tc) => {
        if (tc.id === id) {
          const updated = {
            ...tc,
            ...data,
            lastModified: new Date(),
            changeHistory:
              field && oldValue
                ? [
                    ...tc.changeHistory,
                    {
                      timestamp: new Date(),
                      field,
                      oldValue,
                      newValue: data[field as keyof TestCase] as string,
                    },
                  ]
                : tc.changeHistory,
          };

          // Trigger impact analysis
          if (field && oldValue !== data[field as keyof TestCase]) {
            analyzeChangeImpact("testcase", id, field);
          }
          return updated;
        }
        return tc;
      })
    );

    // Mark as having unsaved changes
    versionManager.markUnsavedChanges();
  };
  const analyzeChangeImpact = (
    artifactType: string,
    artifactId: string,
    field: string
  ) => {
    // Get related artifacts based on traceability links
    let impactedArtifacts: string[] = [];
    if (artifactType === "requirement") {
      const req = requirements.find((r) => r.id === artifactId);
      if (req) {
        impactedArtifacts = [...req.linkedViewpoints, ...req.linkedTestCases];
      }
    } else if (artifactType === "viewpoint") {
      const vp = viewpoints.find((v) => v.id === artifactId);
      if (vp) {
        impactedArtifacts = [...vp.linkedRequirements, ...vp.linkedTestCases];
      }
    } else if (artifactType === "testcase") {
      const tc = testCases.find((t) => t.id === artifactId);
      if (tc) {
        impactedArtifacts = [...tc.reqIds, ...tc.viewpointIds];
      }
    }
    if (impactedArtifacts.length > 0) {
      toast({
        title: "Change Impact Detected",
        description: `Changes to ${artifactId} may affect ${impactedArtifacts.length} related artifact(s)`,
        variant: "default",
      });
    }
  };
  const handleLinkArtifacts = (
    sourceType: string,
    sourceId: string,
    targetType: string,
    targetId: string
  ) => {
    // Create bidirectional links
    if (sourceType === "requirement" && targetType === "viewpoint") {
      handleUpdateRequirement(sourceId, {
        linkedViewpoints: [
          ...(requirements.find((r) => r.id === sourceId)?.linkedViewpoints ||
            []),
          targetId,
        ],
      });
      handleUpdateViewpoint(targetId, {
        linkedRequirements: [
          ...(viewpoints.find((v) => v.id === targetId)?.linkedRequirements ||
            []),
          sourceId,
        ],
      });
    }
    // Add more linking logic for other combinations...

    toast({
      title: "Artifacts Linked",
      description: `Successfully linked ${sourceId} to ${targetId}`,
    });
  };
  const handleExport = (format: string) => {
    toast({
      title: "Export Started",
      description: `Exporting ${
        testCases.length
      } test cases in ${format.toUpperCase()} format`,
    });
  };

  // Version action handlers
  const handleVersionAction = (action: VersionAction) => {
    if (action.type === "view-history") {
      setShowVersionHistory(true);
    } else if (action.type === "restore" && action.versionId) {
      const versionNumber = parseInt(action.versionId);
      const version = versionManager.versions.find(
        (v) => v.versionNumber === versionNumber
      );
      if (version) {
        versionManager.restoreVersion(version, (data) => {
          setRequirements(data.requirements);
          setViewpoints(data.viewpoints);
          setTestCases(data.testCases);
        });
        toast({
          title: "Version Restored",
          description: `Successfully restored to version ${version.versionNumber}`,
        });
        // Also instruct backend planner to restore the suite version server-side
        // so DB artifacts are cloned into a new version.
        const msg = `Please restore suite to version ${version.versionNumber}.`;
        void handleSendMessage(msg);
      }
    }
  };

  const handleSaveVersion = (description: string) => {
    const currentArtifacts = { requirements, viewpoints, testCases };
    const newVersion = versionManager.saveVersion(
      currentArtifacts,
      description
    );
    setShowSaveVersionDialog(false);
    toast({
      title: "Version Saved",
      description: `Version ${newVersion.versionNumber} saved successfully`,
    });
  };

  const getChangedArtifacts = () => {
    // Return empty array since we're not using this for manual saves anymore
    return [];
  };

  // Mock data for breadcrumb navigation based on suite ID
  const getSuiteInfo = (suiteId: string) => {
    const suiteMap: Record<
      string,
      {
        projectName: string;
        projectId: string;
        folderName: string;
        suiteName: string;
      }
    > = {
      s1: {
        projectName: "My Space",
        projectId: "my-space",
        folderName: "Personal Projects",
        suiteName: "E-commerce Platform Testing",
      },
      s2: {
        projectName: "Project A",
        projectId: "p1",
        folderName: "Core Features",
        suiteName: "User Authentication Suite",
      },
      s3: {
        projectName: "Project D",
        projectId: "sp1",
        folderName: "Core System",
        suiteName: "Payment Processing Tests",
      },
    };
    return suiteMap[suiteId || "s1"] || suiteMap["s1"];
  };
  const suiteInfo = getSuiteInfo(id || "s1");
  return (
    <div className="h-screen flex flex-col bg-workspace-bg">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-background border-b border-border/50 h-16">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>
          <div className="flex flex-col gap-2">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink
                    onClick={() => navigate("/projects")}
                    className="cursor-pointer"
                  >
                    Projects
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink
                    onClick={() =>
                      navigate(`/project/${suiteInfo.projectId}/folders`)
                    }
                    className="cursor-pointer"
                  >
                    {suiteInfo.projectName}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink className="text-muted-foreground">
                    {suiteInfo.folderName}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage className="font-medium">
                    {suiteInfo.suiteName}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </div>
      </header>

      {/* Main Content - Split Screen */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden">
        {/* Left Panel - Chat */}
        <div
          className="relative h-full min-w-[320px] max-w-[800px]"
          style={{ width: leftPanelWidth }}
        >
          <ChatPanel
            messages={messages}
            onSendMessage={handleSendMessage}
            isLoading={isLoading || agentLoading}
            hasUnsavedChanges={versionManager.hasUnsavedChanges}
            onVersionAction={handleVersionAction}
            onViewHistory={() => setShowVersionHistory(true)}
            uploadedFiles={uploadedFiles}
            latestTestcasesVersion={latestSuiteVersion}
          />
          {initialChatLoading && !agentLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70 z-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
        {/* Resize handle */}
        <div
          className="w-1 bg-border cursor-col-resize hover:bg-primary/50"
          onMouseDown={(e) => {
            e.preventDefault();
            isResizingRef.current = true;
            window.addEventListener("mousemove", onResizeMouseMove);
            window.addEventListener("mouseup", onResizeMouseUp);
          }}
        />

        {/* Right Panel - Artifacts */}
        <div className="flex-1 h-full">
          <ArtifactsPanel
            requirements={requirements}
            viewpoints={viewpoints}
            testCases={testCases}
            activeTab={activeArtifactsTab}
            onActiveTabChange={setActiveArtifactsTab}
            dynamicRequirementsRows={dynamicRequirementsRows}
            dynamicTestCaseRows={dynamicTestCaseRows}
            dynamicTestDesignRows={dynamicTestDesignRows}
            dynamicTestViewpointRows={dynamicTestViewpointRows}
            loadingStates={loadingStates}
            agentLoading={agentLoading}
            onUpdateRequirement={handleUpdateRequirement}
            onUpdateViewpoint={handleUpdateViewpoint}
            onUpdateTestCase={handleUpdateTestCase}
            onLinkArtifacts={handleLinkArtifacts}
            selectedArtifact={selectedArtifact}
            onSelectArtifact={setSelectedArtifact}
            onExport={handleExport}
            onGenerateArtifacts={handleGenerateArtifacts}
          />
        </div>
      </div>

      {/* Version History Modal */}
      <VersionHistoryModal
        open={showVersionHistory}
        onOpenChange={setShowVersionHistory}
        versions={versionManager.versions}
        currentVersion={versionManager.currentVersion}
        onAction={handleVersionAction}
      />

      {/* Save Version Dialog */}
      <SaveVersionDialog
        open={showSaveVersionDialog}
        onOpenChange={setShowSaveVersionDialog}
        onSave={handleSaveVersion}
        isCheckpoint={saveAsCheckpoint}
        changedArtifacts={getChangedArtifacts()}
      />
    </div>
  );
}
