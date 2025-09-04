import { useState, useEffect, useRef } from "react";
import { supabase } from "@/supabase_client";
import { ChatPanel } from "@/components/suite/chat-panel";
import { ArtifactsPanel } from "@/components/suite/artifacts-panel";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, Pause, RotateCcw, Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
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
  type?: "command" | "normal" | "artifact-selection" | "next-step" | "version-action" | "sample-confirmation" | "quality-confirmation" | "version-update";
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
  const {
    toast
  } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [viewpoints, setViewpoints] = useState<Viewpoint[]>([]);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [traceabilityLinks, setTraceabilityLinks] = useState<TraceabilityLink[]>([]);
  const [dynamicRequirementsRows, setDynamicRequirementsRows] = useState<any[]>([]);
  const [dynamicTestCaseRows, setDynamicTestCaseRows] = useState<any[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [activeArtifactsTab, setActiveArtifactsTab] = useState<"requirements" | "viewpoints" | "testcases">("requirements");
  const [initialChatLoading, setInitialChatLoading] = useState(true);
  const hasLoadedChatOnce = useRef(false);
  const loadTeamEvents = async () => {
    try {
      if (!hasLoadedChatOnce.current) setInitialChatLoading(true);
      const suiteIdParam = new URLSearchParams(window.location.search).get('suiteId');
      const suiteIdVal = id || suiteIdParam || undefined;
      if (!suiteIdVal) { setInitialChatLoading(false); hasLoadedChatOnce.current = true; return; }
      const { data, error } = await supabase
        .from('team_events')
        .select('*')
        .eq('suite_id', suiteIdVal)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const result: Message[] = [];
      let currentAi: Message | null = null;
      let callIdToIndex: Record<string, number> = {};
      let aiLines: string[] = [];

      const ensureAiBlock = (ts: string) => {
        if (!currentAi) {
          currentAi = {
            id: `ai-${ts}`,
            role: 'ai',
            content: '',
            timestamp: new Date(ts),
            type: 'normal',
          };
          aiLines = [];
          callIdToIndex = {};
          result.push(currentAi);
        }
      };

      (data || []).forEach((ev: any) => {
        let obj: any;
        try { obj = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload; } catch { obj = ev.payload; }
        if (obj && obj.source === 'user') {
          // Start a new user+AI block
          result.push({ id: ev.id, role: 'user', content: typeof obj.content === 'string' ? obj.content : String(obj.content ?? ''), timestamp: new Date(ev.created_at), type: 'normal' });
          currentAi = {
            id: `ai-${ev.id}`,
            role: 'ai',
            content: '',
            timestamp: new Date(ev.created_at),
            type: 'normal',
          };
          aiLines = [];
          callIdToIndex = {};
          result.push(currentAi);
          return;
        }

        const formatted = formatTeamEvent(obj);
        if (!formatted) return;
        const meta = extractToolMeta(obj);
        ensureAiBlock(ev.created_at);
        const msgType = (formatted as any)?.messageType as ("sample-confirmation" | "quality-confirmation" | "requirements-feedback" | "version-update" | undefined);

        if (msgType) {
          if (msgType === 'version-update') {
            // Do not inject raw version text into the chat body; only tag the message
            currentAi!.type = msgType as any;
            (currentAi as any).versionNumber = (formatted as any)?.version as number | undefined;
          } else {
            // For confirmation-style messages, show only the response_to_user, clear prior noise
            aiLines = [formatted.content];
            callIdToIndex = {};
            currentAi!.type = msgType as any;
          }
        } else if (meta.isRequest && meta.callId) {
          aiLines.push(`⏳ ${formatted.content}`);
          callIdToIndex[meta.callId] = aiLines.length - 1;
        } else if (meta.isExecution && meta.callId) {
          const idx = callIdToIndex[meta.callId];
          if (typeof idx === 'number' && aiLines[idx]) aiLines[idx] = `✅ ${formatted.content}`;
          else aiLines.push(`✅ ${formatted.content}`);
        } else {
          if (formatted.content) aiLines.push(`• ${formatted.content}`);
        }
        currentAi!.content = aiLines.join('\n\n');
        currentAi!.timestamp = new Date(ev.created_at);
      });

      setMessages(result);
      setInitialChatLoading(false);
      hasLoadedChatOnce.current = true;
    } catch (e) {
      console.error('Failed to load team events', e);
      setInitialChatLoading(false);
      hasLoadedChatOnce.current = true;
    }
  };
  const [selectedArtifact, setSelectedArtifact] = useState<{
    type: string;
    id: string;
  } | null>(null);
  const [suiteStatus, setSuiteStatus] = useState<"idle" | "running" | "paused">("idle");
  // Removed chatMode - AI always asks for permission now
  const [loadingStates, setLoadingStates] = useState<{
    requirements?: boolean;
    viewpoints?: boolean;
    testCases?: boolean;
  }>({});
  
  // Mock uploaded files
  const uploadedFiles = [
    { id: "file1", name: "requirements-doc.pdf", type: "application/pdf" },
    { id: "file2", name: "user-stories.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { id: "file3", name: "test-plan.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    { id: "file4", name: "api-specification.json", type: "application/json" }
  ];
  
  // Version management state
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showSaveVersionDialog, setShowSaveVersionDialog] = useState(false);
  const [saveAsCheckpoint, setSaveAsCheckpoint] = useState(false);
  
  // Initialize version manager
  const versionManager = useVersionManager({
    requirements,
    viewpoints,
    testCases
  });

  const { id } = useParams();

  // Helper: condense noisy team_events payloads into concise chat messages
  const normalizeMarkdown = (text: string): string => {
    // Convert common escaped sequences to real characters for proper markdown rendering
    try {
      return (text || '')
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '  ')
        // Strip a trailing TERMINATE token (case-insensitive) if present at the end
        .replace(/\s*TERMINATE\s*$/i, '');
    } catch {
      return text;
    }
  };
  // Flatten test_cases rows so each individual case becomes a row in the deliverables table
  const stringifyCompact = (val: any): string => {
    if (val == null) return "";
    if (typeof val === "string") return val;
    if (Array.isArray(val)) return val.map((x) => String(x)).join("; ");
    try { return JSON.stringify(val); } catch { return String(val); }
  };
  const sortAnyById = (rows: any[]): any[] => {
    try {
      return [...(rows || [])].sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''), undefined, { numeric: true, sensitivity: 'base' }));
    } catch {
      return rows || [];
    }
  };
  const sortRequirementsByReqCode = (rows: any[]): any[] => {
    try {
      return [...(rows || [])].sort((a, b) => String(a?.req_code ?? '').localeCompare(String(b?.req_code ?? ''), undefined, { numeric: true, sensitivity: 'base' }));
    } catch {
      return rows || [];
    }
  };
  const flattenTestCaseRows = (rows: any[]): any[] => {
    try {
      const out: any[] = [];
      (rows || []).forEach((r) => {
        const content = (() => {
          const c = r?.content;
          if (typeof c === 'string') {
            try { return JSON.parse(c); } catch { return {}; }
          }
          return c || {};
        })();
        const reqId = content?.requirement_id || r?.requirement_id || r?.id || '';
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
              const n = typeof cand === 'number' ? cand : parseInt(String(cand ?? ''), 10);
              if (!Number.isNaN(n) && n > 0) return n;
            }
          } catch {}
          return 1;
        })();
        const cases = Array.isArray(content?.cases) ? content.cases : [];
        if (cases.length === 0) return;
        cases.forEach((c: any, idx: number) => {
          const caseIdRaw = c?.id;
          const caseId = caseIdRaw && String(caseIdRaw).trim()
            ? stringifyCompact(caseIdRaw)
            : `${reqId || 'TC'}-${idx + 1}`;
          out.push({
            id: caseId,
            title: stringifyCompact(c?.title),
            steps: stringifyCompact(c?.steps),
            expected_result: stringifyCompact(c?.expected),
            severity: stringifyCompact(c?.type),
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
        const rid = String(row?.requirement_id ?? '');
        if (!rid) continue;
        const v = typeof row?.version === 'number' ? row.version : parseInt(String(row?.version ?? ''), 10) || 1;
        if (latestByReq[rid] == null || v > latestByReq[rid]) latestByReq[rid] = v;
      }
      return (rows || []).filter((row) => {
        const rid = String(row?.requirement_id ?? '');
        if (!rid) return false;
        const v = typeof row?.version === 'number' ? row.version : parseInt(String(row?.version ?? ''), 10) || 1;
        return v === latestByReq[rid];
      });
    } catch {
      return rows || [];
    }
  };
  const sortTestCasesByReqThenId = (rows: any[]): any[] => {
    try {
      const toStr = (v: any) => String(v == null ? '' : v);
      return [...(rows || [])].sort((a, b) => {
        const ra = toStr(a?.requirement_id);
        const rb = toStr(b?.requirement_id);
        const cmpReq = ra.localeCompare(rb, undefined, { numeric: true, sensitivity: 'base' });
        if (cmpReq !== 0) return cmpReq;
        return toStr(a?.id).localeCompare(toStr(b?.id), undefined, { numeric: true, sensitivity: 'base' });
      });
    } catch {
      return rows || [];
    }
  };
  const formatTeamEvent = (raw: any): { role: 'ai' | 'user'; content: string; messageType?: "sample-confirmation" | "quality-confirmation" | "requirements-feedback" | "requirements-sample-offer" | "testcases-sample-offer" | "version-update"; version?: number } | null => {
    console.log(raw)
    const type = raw?.type;
    const source = raw?.source;

    // Handle bulk test case edits -> version update message
    if (type === 'testcases_edited_bulk') {
      try {
        const firstEdit = Array.isArray(raw?.edits) && raw.edits.length > 0 ? raw.edits[0] : {};
        const newVersion = (typeof raw?.new_version === 'number' ? raw.new_version : (typeof firstEdit?.new_version === 'number' ? firstEdit.new_version : (typeof raw?.new_testcases?.version === 'number' ? raw.new_testcases.version : undefined)));
        if (newVersion != null) {
          return { role: 'ai', content: String(newVersion), messageType: 'version-update', version: Number(newVersion) } as any;
        }
      } catch {}
      return null;
    }
    // Direct nested event payloads (e.g., {'event': {'type': 'ask_user', 'event_type': 'sample_confirmation', 'response_to_user': '...'}})
    if (raw?.event && typeof raw.event === 'object' && raw.event.type === 'ask_user') {
      const eventType = raw.event.event_type || raw.event.eventType || '';
      const responseText = normalizeMarkdown(String(raw.event.response_to_user ?? raw.event.responseToUser ?? '').trim());
      if (eventType === 'sample_confirmation' && responseText) {
        return { role: 'ai', content: responseText, messageType: 'sample-confirmation' };
      }
      if (eventType === 'quality_confirmation' && responseText) {
        const normalized = responseText.replace(/\bCONTINUE\b/g, 'Generate directly');
        return { role: 'ai', content: normalized, messageType: 'quality-confirmation' };
      }
      if (eventType === 'requirements_feedback' && responseText) {
        return { role: 'ai', content: responseText, messageType: 'requirements-feedback' };
      }
      if (eventType === 'requirements_sample_offer' && responseText) {
        return { role: 'ai', content: responseText, messageType: 'requirements-sample-offer' } as any;
      }
      if (eventType === 'testcases_sample_offer' && responseText) {
        return { role: 'ai', content: responseText, messageType: 'testcases-sample-offer' } as any;
      }
      if (responseText) return { role: 'ai', content: responseText };
    }

    if (type === 'HandoffMessage' || type === 'ThoughtEvent') return null;

    // Ensure plain TextMessage strings are surfaced
    if (type === 'TextMessage' && typeof raw?.content === 'string') {
      return { role: 'ai', content: normalizeMarkdown(String(raw.content)) };
    }

    if (type === 'ToolCallRequestEvent') {
      const first = Array.isArray(raw?.content) ? raw.content[0] : undefined;
      const name = first?.name as string | undefined;
      if (source === 'testcase_writer' && name === 'edit_testcases_for_req') {
        try {
          const jsonBlock = '```json\n' + JSON.stringify(raw, null, 2) + '\n```';
          return { role: 'ai', content: `AI is editing test cases\n\n${jsonBlock}` };
        } catch {
          return { role: 'ai', content: `AI is editing test cases` };
        }
      }
      if (source === 'planner' && name === 'generate_preview') {
        return { role: 'ai', content: `I'm generating a short preview...` };
      }
      if (source === 'planner' && name === 'identify_gaps') {
        let focus = '';
        try {
          const args = first?.arguments ? JSON.parse(first.arguments) : {};
          const t = typeof args?.testing_type === 'string' ? args.testing_type : '';
          if (t) focus = ` with a ${t} testing focus`;
        } catch {}
        return { role: 'ai', content: `I'm analyzing your documents to identify gaps and ambiguities${focus}...` };
      }
      if (source === 'planner' && name === 'get_requirements_info') {
        return { role: 'ai', content: `I'm checking existing requirements and answering your question...` };
      }
      if (source === 'planner' && name === 'get_testcases_info') {
        return { role: 'ai', content: `I'm checking existing test cases and answering your question...` };
      }
      if (source === 'planner' && name === 'generate_direct_testcases_on_docs') {
        return { role: 'ai', content: `I'm generating test cases directly from your documents...` };
      }
      if (source === 'testcase_writer' && name === 'generate_direct_testcases_on_docs') {
        return { role: 'ai', content: `I'm generating test cases directly from your documents...` };
      }
      if (source === 'planner' && name === 'transfer_to_fetcher') {
        return null;
      }
      if (name === 'transfer_to_planner') {
        return { role: 'ai', content: `I'm thinking...` };
      }
      if (name === 'transfer_to_requirements_extractor') {
        return { role: 'ai', content: `Transferring to requirements_extractor...` };
      }
      if (source === 'planner' && name === 'transfer_to_testcase_writer') {
        return { role: 'ai', content: `Transferring to testcase_writer to generate test cases...` };
      }
      if (source === 'fetcher' && name === 'transfer_to_requirements_extractor') {
        return { role: 'ai', content: `I'm now analyzing the requirements...` };
      }
      if (source === 'requirements_extractor' && name === 'extract_and_store_requirements') {
        return { role: 'ai', content: `I'm now extracting the requirements...` };
      }
      if (source === 'requirements_extractor' && name === 'transfer_to_testcase_writer') {
        return { role: 'ai', content: `I'm now writing test cases based on the requirements...` };
      }
      if (source === 'testcase_writer' && name === 'list_requirement_ids') {
        return { role: 'ai', content: `I'm identifying requirements to cover with test cases...` };
      }
      if (source === 'testcase_writer' && name === 'generate_and_store_testcases_for_req') {
        let reqId = '';
        try {
          const args = first?.arguments ? JSON.parse(first.arguments) : {};
          reqId = typeof args?.req_id === 'string' ? args.req_id : '';
        } catch {}
        const forText = reqId ? ` for ${reqId}` : '';
        return { role: 'ai', content: `I'm writing test cases${forText}...` };
      }
      if (source === 'fetcher' && name === 'store_docs_from_blob') {
        let docs: string[] = [];
        try {
          const args = first?.arguments ? JSON.parse(first.arguments) : {};
          if (Array.isArray(args?.doc_names)) docs = args.doc_names;
        } catch {}
        const list = docs.length ? docs.join(', ') : 'documents';
        return { role: 'ai', content: `I'm fetching and analyzing ${list}...` };
      }
    }

    if (type === 'ToolCallExecutionEvent') {
      const first = Array.isArray(raw?.content) ? raw.content[0] : undefined;
      const name = first?.name as string | undefined;
      if (source === 'planner' && name === 'generate_preview') {
        const details = normalizeMarkdown(String(first?.content ?? ''));
        return { role: 'ai', content: details || 'Preview generated.' };
      }
      if (source === 'planner' && name === 'identify_gaps') {
        const detailsRaw = String(first?.content ?? '');
        const details = normalizeMarkdown(detailsRaw).replace(/\bTERMINATE\b/g, '').trim();
        return { role: 'ai', content: details || 'No significant gaps detected.' };
      }
      if (source === 'planner' && name === 'get_requirements_info') {
        const details = normalizeMarkdown(String(first?.content ?? ''));
        return { role: 'ai', content: details || 'Answered your requirements question.' };
      }
      if (source === 'planner' && name === 'get_testcases_info') {
        const details = normalizeMarkdown(String(first?.content ?? ''));
        return { role: 'ai', content: details || 'Answered your test cases question.' };
      }
      if (source === 'planner' && name === 'generate_direct_testcases_on_docs') {
        const details = normalizeMarkdown(String(first?.content ?? ''));
        return { role: 'ai', content: details || 'Generated direct test cases.' };
      }
      if (source === 'testcase_writer' && name === 'generate_direct_testcases_on_docs') {
        const details = normalizeMarkdown(String(first?.content ?? ''));
        return { role: 'ai', content: details || 'Generated direct test cases.' };
      }
      if (source === 'planner' && name === 'transfer_to_fetcher') {
        return null;
      }
      if (name === 'transfer_to_requirements_extractor') {
        const details = normalizeMarkdown(String(first?.content ?? ''));
        return { role: 'ai', content: details || 'Transferred to requirements_extractor.' };
      }
      if (source === 'planner' && name === 'transfer_to_testcase_writer') {
        return null; // internal routing confirmation, suppress
      }
      if (name === 'transfer_to_planner') {
        const details = normalizeMarkdown(String(first?.content ?? ''));
        return { role: 'ai', content: details || 'Transferred to planner.' };
      }
      
      // Planner: ask_user -> sample_confirmation or quality_confirmation with response_to_user and CTA(s)
      if (source === 'planner' && name === 'ask_user') {
        const details = String(first?.content ?? '');
        let eventType = '';
        let responseText = '';
        // Try JSON first
        try {
          const parsed = JSON.parse(details);
          eventType = parsed?.event?.event_type || '';
          responseText = normalizeMarkdown(parsed?.event?.response_to_user || '');
        } catch {
          // Fallback parse for python-like dict
          const et = details.match(/'event_type'\s*:\s*'([^']+)'/);
          const rtSingle = details.match(/'response_to_user'\s*:\s*'([\s\S]*?)'\s*(?:,|\})/);
          const rtDouble = details.match(/'response_to_user'\s*:\s*"([\s\S]*?)"\s*(?:,|\})/);
          eventType = et?.[1] || '';
          responseText = normalizeMarkdown((rtSingle?.[1] || rtDouble?.[1] || '').trim());
        }
        if (eventType === 'sample_confirmation' && responseText) {
          return { role: 'ai', content: responseText, messageType: 'sample-confirmation' };
        }
        if (eventType === 'quality_confirmation' && responseText) {
          // Normalize CTA wording to "Yes please" / "Generate directly"
          const normalized = responseText.replace(/\bCONTINUE\b/g, 'Generate directly');
          return { role: 'ai', content: normalized, messageType: 'quality-confirmation' };
        }
        if (eventType === 'requirements_feedback' && responseText) {
          return { role: 'ai', content: responseText, messageType: 'requirements-feedback' };
        }
        if (eventType === 'requirements_sample_offer' && responseText) {
          return { role: 'ai', content: responseText, messageType: 'requirements-sample-offer' } as any;
        }
        if (eventType === 'testcases_sample_offer' && responseText) {
          return { role: 'ai', content: responseText, messageType: 'testcases-sample-offer' } as any;
        }
        if (responseText) return { role: 'ai', content: responseText };
        return null;
      }
      // Requirements extractor: ask_user -> requirements_feedback with response_to_user and CTA
      if (source === 'requirements_extractor' && name === 'ask_user') {
        const details = String(first?.content ?? '');
        let eventType = '';
        let responseText = '';
        // Try JSON first
        try {
          const parsed = JSON.parse(details);
          eventType = parsed?.event?.event_type || '';
          responseText = normalizeMarkdown(parsed?.event?.response_to_user || '');
        } catch {
          // Fallback parse for python-like dict
          const et = details.match(/'event_type'\s*:\s*'([^']+)'/);
          const rtSingle = details.match(/'response_to_user'\s*:\s*'([\s\S]*?)'\s*(?:,|\})/);
          const rtDouble = details.match(/'response_to_user'\s*:\s*"([\s\S]*?)"\s*(?:,|\})/);
          eventType = et?.[1] || '';
          responseText = normalizeMarkdown((rtSingle?.[1] || rtDouble?.[1] || '').trim());
        }
        if (eventType === 'sample_confirmation' && responseText) {
          return { role: 'ai', content: responseText, messageType: 'sample-confirmation' };
        }
        if (eventType === 'quality_confirmation' && responseText) {
          // Normalize CTA wording to "Yes please" / "Generate directly"
          const normalized = responseText.replace(/\bCONTINUE\b/g, 'Generate directly');
          return { role: 'ai', content: normalized, messageType: 'quality-confirmation' };
        }
        if (eventType === 'requirements_feedback' && responseText) {
          return { role: 'ai', content: responseText, messageType: 'requirements-feedback' };
        }
        if (responseText) return { role: 'ai', content: responseText };
        return null;
      }
      
      if (name === 'transfer_to_planner') {
        return null; // internal routing confirmation, suppress
      }
      if (name === 'transfer_to_requirements_extractor') {
        return { role: 'ai', content: `I'm now extracting requirements...` };
      }
      if (source === 'requirements_extractor' && name === 'extract_and_store_requirements') {
        return { role: 'ai', content: `Requirements extracted. Now check the Requirements tab — I'm done.` };
      }
      if (source === 'requirements_extractor' && name === 'transfer_to_testcase_writer') {
        return null; // internal routing confirmation, suppress
      }
      if (source === 'testcase_writer' && name === 'generate_and_store_testcases_for_req') {
        // Try to extract req_id from content
        let reqId = '';
        try {
          const details = String(first?.content ?? '');
          const match = details.match(/'req_id':\s*'([^']+)'/);
          if (match && match[1]) reqId = match[1];
        } catch {}
        const which = reqId ? ` for ${reqId}` : '';
        return { role: 'ai', content: `Test cases${which} are ready. Now check the Test Cases tab.` };
      }
      if (source === 'testcase_writer' && name === 'list_requirement_ids') {
        // summarize count of ids
        let count = 0;
        try {
          const details = String(first?.content ?? '');
          const parsed = JSON.parse(details.replace(/'/g, '"'));
          if (Array.isArray(parsed?.ids)) count = parsed.ids.length;
        } catch {}
        if (count > 0) return { role: 'ai', content: `Found ${count} requirements to cover.` };
        return null;
      }
      if (source === 'testcase_writer' && name === 'edit_testcases_for_req') {
        const details = String(first?.content ?? '');
        let editedCount = 0;
        let summary = '';
        let reqCodes: string[] = [];
        let newVersions: (number | string)[] = [];
        try {
          let parsed: any;
          try { parsed = JSON.parse(details); } catch { parsed = JSON.parse(details.replace(/'/g, '"')); }
          editedCount = Number(parsed?.edited_count ?? 0) || 0;
          if (Array.isArray(parsed?.results)) {
            reqCodes = parsed.results.map((r: any) => r?.req_code || r?.requirement_id).filter(Boolean);
            newVersions = parsed.results.map((r: any) => r?.new_version).filter((v: any) => v != null);
          }
          summary = typeof parsed?.summary === 'string' ? parsed.summary : '';
        } catch {}
        if (!editedCount) {
          const m = details.match(/'edited_count'\s*:\s*(\d+)/);
          editedCount = m ? Number(m[1]) : 0;
        }
        if (reqCodes.length === 0) {
          const m1 = details.match(/'req_code'\s*:\s*'([^']+)'/);
          const m2 = details.match(/'requirement_id'\s*:\s*'([^']+)'/);
          if (m1) reqCodes.push(m1[1]);
          else if (m2) reqCodes.push(m2[1]);
        }
        if (newVersions.length === 0) {
          const m = details.match(/'new_version'\s*:\s*(\d+)/);
          if (m) newVersions.push(Number(m[1]));
        }
        if (!summary) {
          const m = details.match(/'summary'\s*:\s*'([\s\S]*?)'\s*(?:,|\})/);
          if (m) summary = m[1];
        }
        const reqText = reqCodes.length ? ` for ${[...new Set(reqCodes)].join(', ')}` : '';
        const versionText = newVersions.length ? `; new version ${newVersions[newVersions.length - 1]}` : '';
        const countText = editedCount ? `${editedCount} test case${editedCount > 1 ? 's' : ''}` : 'test cases';
        const summaryText = summary ? ` ${summary}` : '';
        return { role: 'ai', content: `Edited ${countText}${reqText}${versionText}.${summaryText}` };
      }
      if (source === 'fetcher' && name === 'store_docs_from_blob') {
        const details = String(first?.content ?? '');
        let stored: string[] = [];
        let missing: string[] = [];
        try {
          const parsed = JSON.parse(details);
          stored = Array.isArray(parsed?.stored) ? parsed.stored : stored;
          missing = Array.isArray(parsed?.missing) ? parsed.missing : missing;
        } catch {
          const sMatch = details.match(/'stored': \[(.*?)\]/);
          const mMatch = details.match(/'missing': \[(.*?)\]/);
          if (sMatch && sMatch[1]) stored = sMatch[1].split(',').map(x => x.trim().replace(/^'|"|\s/g, '').replace(/'|"$/g, '')).filter(Boolean);
          if (mMatch && mMatch[1]) missing = mMatch[1].split(',').map(x => x.trim().replace(/^'|"|\s/g, '').replace(/'|"$/g, '')).filter(Boolean);
        }
        const storedText = stored.length ? `Stored: ${stored.join(', ')}` : 'Stored: none';
        const missingText = missing.length ? `Missing: ${missing.join(', ')}` : 'Missing: none';
        return { role: 'ai', content: `${storedText}. ${missingText}.` };
      }
    }

    if (type === 'ToolCallSummaryMessage') {
      // Some backends emit the important ask_user payload inside this summary as a string
      try {
        const details = String(raw?.content ?? '');
        let eventType = '';
        let responseText = '';
        // Try strict JSON first
        try {
          const parsed = JSON.parse(details);
          const ev = parsed?.event || {};
          eventType = ev?.event_type || ev?.eventType || '';
          responseText = normalizeMarkdown(ev?.response_to_user || ev?.responseToUser || '');
        } catch {
          // Fallback: python-like dict with single quotes
          const et = details.match(/'event_type'\s*:\s*'([^']+)'/);
          const rtSingle = details.match(/'response_to_user'\s*:\s*'([\s\S]*?)'\s*(?:,|\})/);
          const rtDouble = details.match(/"response_to_user"\s*:\s*"([\s\S]*?)"\s*(?:,|\})/);
          eventType = et?.[1] || '';
          responseText = normalizeMarkdown((rtSingle?.[1] || rtDouble?.[1] || '').trim());
        }
        if (eventType === 'sample_confirmation' && responseText) {
          return { role: 'ai', content: responseText, messageType: 'sample-confirmation' };
        }
        if (eventType === 'quality_confirmation' && responseText) {
          const normalized = responseText.replace(/\bCONTINUE\b/g, 'Generate directly');
          return { role: 'ai', content: normalized, messageType: 'quality-confirmation' };
        }
        if (eventType === 'requirements_feedback' && responseText) {
          return { role: 'ai', content: responseText, messageType: 'requirements-feedback' };
        }
        if (eventType === 'requirements_sample_offer' && responseText) {
          return { role: 'ai', content: responseText, messageType: 'requirements-sample-offer' } as any;
        }
        if (eventType === 'testcases_sample_offer' && responseText) {
          return { role: 'ai', content: responseText, messageType: 'testcases-sample-offer' } as any;
        }
        if (responseText) return { role: 'ai', content: responseText };
        return null;
      } catch {
        return null; // if unparsable, ignore summary
      }
    }

    if (typeof raw?.content === 'string') {
      const details = String(raw.content);
      try {
        const parsed = JSON.parse(details);
        const ev = parsed?.event || {};
        const eventType = ev?.event_type || ev?.eventType || '';
        const responseText = normalizeMarkdown(String(ev?.response_to_user ?? ev?.responseToUser ?? '').trim());
        if (responseText) {
          if (eventType === 'sample_confirmation') {
            return { role: 'ai', content: responseText, messageType: 'sample-confirmation' };
          }
          if (eventType === 'quality_confirmation') {
            const normalized = responseText.replace(/\bCONTINUE\b/g, 'Generate directly');
            return { role: 'ai', content: normalized, messageType: 'quality-confirmation' };
          }
          if (eventType === 'requirements_feedback') {
            return { role: 'ai', content: responseText, messageType: 'requirements-feedback' } as any;
          }
          return { role: 'ai', content: responseText };
        }
      } catch {}
      // Fallback regex extraction from python-like dict string
      const et = details.match(/'event_type'\s*:\s*'([^']+)'/);
      const rtSingle = details.match(/'response_to_user'\s*:\s*'([\s\S]*?)'\s*(?:,|\})/);
      const rtDouble = details.match(/"response_to_user"\s*:\s*"([\s\S]*?)"\s*(?:,|\})/);
      const eventType = et?.[1] || '';
      const responseText = normalizeMarkdown((rtSingle?.[1] || rtDouble?.[1] || '').trim());
      if (responseText) {
        if (eventType === 'sample_confirmation') {
          return { role: 'ai', content: responseText, messageType: 'sample-confirmation' };
        }
        if (eventType === 'quality_confirmation') {
          const normalized = responseText.replace(/\bCONTINUE\b/g, 'Generate directly');
          return { role: 'ai', content: normalized, messageType: 'quality-confirmation' };
        }
        if (eventType === 'requirements_feedback') {
          return { role: 'ai', content: responseText, messageType: 'requirements-feedback' } as any;
        }
        if (eventType === 'requirements_sample_offer') {
          return { role: 'ai', content: responseText, messageType: 'requirements-sample-offer' } as any;
        }
        if (eventType === 'testcases_sample_offer') {
          return { role: 'ai', content: responseText, messageType: 'testcases-sample-offer' } as any;
        }
        if (eventType === 'requirements_sample_offer') {
          return { role: 'ai', content: responseText, messageType: 'requirements-sample-offer' } as any;
        }
        if (eventType === 'testcases_sample_offer') {
          return { role: 'ai', content: responseText, messageType: 'testcases-sample-offer' } as any;
        }
        return { role: 'ai', content: responseText };
      }
      // If no response text is found, suppress showing raw JSON
      return null;
    }
    return { role: 'ai', content: typeof raw === 'string' ? raw : '```json\n' + JSON.stringify(raw, null, 2) + '\n```' };
  };
  const extractToolMeta = (raw: any): { callId?: string; isRequest?: boolean; isExecution?: boolean } => {
    const type = raw?.type;
    const first = Array.isArray(raw?.content) ? raw.content[0] : undefined;
    if (type === 'ToolCallRequestEvent') return { callId: first?.id as string | undefined, isRequest: true };
    if (type === 'ToolCallExecutionEvent') return { callId: first?.call_id as string | undefined, isExecution: true };
    return {};
  };
  // NOTE: helper inserted above; existing state declarations remain below

  // Initialize with context-aware continuation from suite creation
  useEffect(() => {
    // Load dynamic rows from Supabase for this suite
    const loadDynamic = async () => {
      try {
        setLoadingStates({ requirements: true, testCases: true });
        const suiteIdParam = new URLSearchParams(window.location.search).get('suiteId');
        const suiteIdVal = id || suiteIdParam || undefined;
        if (!suiteIdVal) return;
        const [{ data: reqs }, { data: tcs }] = await Promise.all([
          supabase.from('requirements').select('*').eq('suite_id', suiteIdVal),
          supabase.from('test_cases').select('*').eq('suite_id', suiteIdVal),
        ]);
        setDynamicRequirementsRows(sortRequirementsByReqCode(reqs || []));
        {
          const flattened = flattenTestCaseRows(tcs || []);
          const latestOnly = filterLatestTestcasesByRequirement(flattened);
          setDynamicTestCaseRows(sortTestCasesByReqThenId(latestOnly));
        }
      } catch (e) {
        console.error('Failed to fetch dynamic artifacts', e);
      } finally {
        setLoadingStates({});
      }
    };
    void loadDynamic();
    void loadTeamEvents();
  }, []);

  // Realtime subscription to team_events for this suite
  useEffect(() => {
    const suiteIdParam = new URLSearchParams(window.location.search).get('suiteId');
    const suiteIdVal = id || suiteIdParam || undefined;
    if (!suiteIdVal) return;

    const channel = supabase
      .channel(`team_events:${suiteIdVal}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'team_events', filter: `suite_id=eq.${suiteIdVal}` },
        (payload) => {
          const ev: any = payload.new;
          let obj: any;
          try { obj = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload; } catch { obj = ev.payload; }

          // Keep a single AI block per user, update it
          if (obj && obj.source === 'user') {
            const userMsg: Message = { id: ev.id, role: 'user', content: typeof obj.content === 'string' ? obj.content : String(obj.content ?? ''), timestamp: new Date(ev.created_at), type: 'normal' };
            const aiMsg: Message = { id: `ai-${ev.id}`, role: 'ai', content: '', timestamp: new Date(ev.created_at), type: 'normal' };
            (window as any).__aiAgg = { aiId: aiMsg.id, callIndex: {} };
            setMessages(prev => [...prev, userMsg, aiMsg]);
            return;
          }

          const formatted = formatTeamEvent(obj);
          if (!formatted) return;
          const meta = extractToolMeta(obj);

          setMessages(prev => {
            // Find last AI message
            let idx = -1;
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i].role === 'ai') { idx = i; break; }
            }
            if (idx === -1) {
              const aiMsg: Message = { id: `ai-${ev.id}`, role: 'ai', content: '', timestamp: new Date(ev.created_at), type: 'normal' };
              return [...prev, aiMsg];
            }
            const next = [...prev];
            const existing = next[idx];
            const lines = (existing.content || '').split('\n\n').filter(Boolean);
            const agg = ((window as any).__aiAgg ||= { aiId: existing.id, callIndex: {} });
            if (agg.aiId !== existing.id) { agg.aiId = existing.id; agg.callIndex = {}; }

            const messageType = (formatted as any)?.messageType as ("sample-confirmation" | "quality-confirmation" | "requirements-feedback" | "version-update" | undefined);
            if (messageType) {
              if (messageType === 'version-update') {
                // Do not inject raw version into the content lines; only tag the message
                next[idx] = { ...existing, type: messageType, timestamp: new Date(ev.created_at), versionNumber: (formatted as any)?.version as number | undefined } as any;
              } else {
                // Replace block with only the response_to_user
                next[idx] = { ...existing, content: formatted.content, type: messageType, timestamp: new Date(ev.created_at) } as any;
              }
              (window as any).__aiAgg = { aiId: existing.id, callIndex: {} };
              return next;
            }

            if (meta.isRequest && meta.callId) {
              lines.push(`⏳ ${formatted.content}`);
              agg.callIndex[meta.callId] = lines.length - 1;
            } else if (meta.isExecution && meta.callId) {
              const li = agg.callIndex[meta.callId];
              if (typeof li === 'number' && lines[li]) lines[li] = `✅ ${formatted.content}`;
              else lines.push(`✅ ${formatted.content}`);
            } else {
              lines.push(`• ${formatted.content}`);
            }

            next[idx] = { ...existing, content: lines.join('\n\n'), timestamp: new Date(ev.created_at) } as any;
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      try { supabase.removeChannel(channel); } catch {}
    };
  }, [id]);

  // Realtime subscriptions for requirements and test_cases
  useEffect(() => {
    const suiteIdParam = new URLSearchParams(window.location.search).get('suiteId');
    const suiteIdVal = id || suiteIdParam || undefined;
    if (!suiteIdVal) return;

    const channel = supabase
      .channel(`artifacts:${suiteIdVal}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'requirements', filter: `suite_id=eq.${suiteIdVal}` },
        async () => {
          try {
            const { data } = await supabase
              .from('requirements')
              .select('*')
              .eq('suite_id', suiteIdVal);
            setDynamicRequirementsRows(sortRequirementsByReqCode(data || []));
            // Jump to requirements tab on any realtime change
            setActiveArtifactsTab('requirements');
          } catch (e) {
            console.error('Failed to refresh requirements (realtime)', e);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'test_cases', filter: `suite_id=eq.${suiteIdVal}` },
        async () => {
          try {
            const { data } = await supabase
              .from('test_cases')
              .select('*')
              .eq('suite_id', suiteIdVal);
            {
              const flattened = flattenTestCaseRows(data || []);
              const latestOnly = filterLatestTestcasesByRequirement(flattened);
              setDynamicTestCaseRows(sortTestCasesByReqThenId(latestOnly));
            }
            // Jump to test cases tab on any realtime change
            setActiveArtifactsTab('testcases');
          } catch (e) {
            console.error('Failed to refresh test cases (realtime)', e);
          }
        }
      )
      .subscribe();

    return () => {
      try { supabase.removeChannel(channel); } catch {}
    };
  }, [id]);

  // Track latest test case version from test_suites.state
  const [latestTestcasesVersion, setLatestTestcasesVersion] = useState<number | undefined>(undefined);
  // Listen to suite status (chatting/idle) from 'test_suites' table and set spinner
  useEffect(() => {
    const suiteIdParam = new URLSearchParams(window.location.search).get('suiteId');
    const suiteIdVal = id || suiteIdParam || undefined;
    if (!suiteIdVal) return;

    const loadStatus = async () => {
      try {
        const { data } = await supabase
          .from('test_suites')
          .select('status, state')
          .eq('id', suiteIdVal)
          .maybeSingle();
        const status = (data as any)?.status as string | undefined;
        setAgentLoading(status === 'chatting' || status === 'running');
        const st = (data as any)?.state as any;
        const rawLatest = st?.agent_state?.latest_testcases_version ?? st?.latest_testcases_version;
        const parsed = typeof rawLatest === 'number' ? rawLatest : parseInt(String(rawLatest ?? ''), 10);
        if (!Number.isNaN(parsed)) {
          setLatestTestcasesVersion(parsed);
        }
      } catch {}
    };
    void loadStatus();

    const channel = supabase
      .channel(`test_suites:${suiteIdVal}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'test_suites', filter: `id=eq.${suiteIdVal}` },
        (payload) => {
          const nextStatus = (payload.new as any)?.status as string | undefined;
          setAgentLoading(nextStatus === 'chatting' || nextStatus === 'running');
          try {
            const st = (payload.new as any)?.state as any;
            const rawLatest = st?.agent_state?.latest_testcases_version ?? st?.latest_testcases_version;
            const parsed = typeof rawLatest === 'number' ? rawLatest : parseInt(String(rawLatest ?? ''), 10);
            if (!Number.isNaN(parsed)) {
              setLatestTestcasesVersion(parsed);
            }
          } catch {}
        }
      )
      .subscribe();

    return () => {
      try { supabase.removeChannel(channel); } catch {}
    };
  }, [id]);

  console.log(agentLoading)

  const handleGenerateArtifacts = async (requirementId: string) => {
    const requirement = requirements.find(req => req.id === requirementId);
    if (!requirement) return;

    setIsLoading(true);
    
    // Add AI message indicating generation started
    const generationMessage: Message = {
      id: `generation-${Date.now()}`,
      role: "ai",
      content: `🚀 **Generating Related Artifacts for ${requirementId}**\n\nAnalyzing requirement: "${requirement.description}"\n\nGenerating:\n• Testing viewpoints based on requirement scope\n• Initial test cases for validation\n• Establishing traceability links\n\nThis will take a moment...`,
      timestamp: new Date(),
      type: "normal"
    };
    setMessages(prev => [...prev, generationMessage]);

    // Simulate AI processing time
    setTimeout(() => {
      // Generate new viewpoint
      const newViewpointId = `VP-${String(viewpoints.length + 1).padStart(2, '0')}`;
      const newViewpoint: Viewpoint = {
        id: newViewpointId,
        area: requirement.description.includes('security') || requirement.description.includes('authentication') 
          ? 'Security & Authentication' 
          : requirement.description.includes('inventory') 
          ? 'Data Management' 
          : 'Functional Testing',
        intent: `Validate requirements related to: ${requirement.description}`,
        dataVariants: 'Valid/Invalid inputs, Edge cases, Boundary conditions',
        notes: `Auto-generated viewpoint for requirement ${requirementId}`,
        linkedRequirements: [requirementId],
        linkedTestCases: [],
        lastModified: new Date(),
        changeHistory: []
      };

      // Generate test cases
      const newTestCases: TestCase[] = [];
      for (let i = 0; i < 2; i++) {
        const tcId = `TC-${String(testCases.length + newTestCases.length + 1).padStart(2, '0')}`;
        newTestCases.push({
          id: tcId,
          title: `Test ${requirement.description} - Scenario ${i + 1}`,
          steps: `1. Navigate to relevant feature\n2. Execute test scenario for ${requirement.description}\n3. Verify expected behavior`,
          expectedResult: `Feature behaves as specified in ${requirementId}`,
          severity: requirement.priority as "High" | "Medium" | "Low",
          reqIds: [requirementId],
          viewpointIds: [newViewpointId],
          tags: ['auto-generated', 'functional'],
          locked: false,
          lastModified: new Date(),
          changeHistory: []
        });
      }

      // Update viewpoint with test case links
      newViewpoint.linkedTestCases = newTestCases.map(tc => tc.id);

      // Update requirement status and links
      const updatedRequirements = requirements.map(req => 
        req.id === requirementId 
          ? { 
              ...req, 
              relationshipStatus: 'Complete' as const,
              linkedViewpoints: [...req.linkedViewpoints, newViewpointId],
              linkedTestCases: [...req.linkedTestCases, ...newTestCases.map(tc => tc.id)],
              lastModified: new Date()
            }
          : req
      );

      // Update states
      setRequirements(updatedRequirements);
      setViewpoints(prev => [...prev, newViewpoint]);
      setTestCases(prev => [...prev, ...newTestCases]);

      // Mark as having unsaved changes for version management
      versionManager.markUnsavedChanges();

      // Add completion message
      const completionMessage: Message = {
        id: `completion-${Date.now()}`,
        role: "ai",
        content: `✅ **Artifacts Generated Successfully!**\n\n**Created for ${requirementId}: "${requirement.description}"**\n\n🎯 **New Viewpoint:** ${newViewpointId} - ${newViewpoint.area}\n📋 **Test Cases:** ${newTestCases.map(tc => tc.id).join(', ')}\n🔗 **Traceability:** Full coverage established\n\nRequirement status updated to "Complete". All artifacts are now linked and ready for review.`,
        timestamp: new Date(),
        type: "normal",
        hasModifiedArtifacts: true
      };
      setMessages(prev => [...prev, completionMessage]);

      // Show success toast
      toast({
        title: "Artifacts Generated",
        description: `Created viewpoint and test cases for ${requirementId}`,
      });

      setIsLoading(false);
    }, 2000);
  };

  const handleSendMessage = async (message: string, opts?: { silent?: boolean }) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: message,
      timestamp: new Date(),
      type: message.startsWith("/") ? "command" : "normal"
    };
    // Avoid double user messages: for normal chat we rely on realtime team_events
    // Only append locally for commands or when explicitly not silent
    if (!opts?.silent && userMessage.type !== "normal") {
      setMessages(prev => [...prev, userMessage]);
    }
    setIsLoading(true);
    console.log("Sending message:", message);
    // If this is a normal chat message, stream from backend API
    if (userMessage.type === "normal") {
      try {
        const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || "http://localhost:8000";
        const suiteIdParam = new URLSearchParams(window.location.search).get('suiteId');
        const suiteId = id || suiteIdParam || undefined;
        if (!suiteId) {
          throw new Error("Missing suiteId for streaming.");
        }
        const response = await fetch(`${apiBase}/run/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task: message, suite_id: suiteId })
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
            try { JSON.parse(line); } catch {}
          }
        }
      } catch (err) {
        toast({ title: "Chat error", description: (err as Error).message, variant: "destructive" });
      } finally {
        setIsLoading(false);
        // Always reload from team_events to avoid duplicate locally injected messages
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
        const planMessage = messages.find(msg => msg.id === messageId);
        
        if (planMessage && planMessage.implementationPlan) {
          aiResponse = `✅ **Implementation Started**\n\nExecuting the planned changes:\n${planMessage.implementationPlan}\n\n📝 Artifacts have been generated and updated accordingly.`;
          hasModifiedArtifacts = true;
        } else {
          aiResponse = "I couldn't find the implementation plan. Please try again.";
        }
      }
      // Handle next step selection
      else if (message.startsWith("NEXT_STEP:")) {
        const option = message.replace("NEXT_STEP:", "");
        
        if (option === "test-cases") {
          setLoadingStates({ testCases: true });
          setTimeout(() => { setLoadingStates({}); }, 1000);
          
          aiResponse = "Perfect! I'm now generating example test cases for your requirements...";
        } else if (option === "viewpoints") {
          setLoadingStates({ viewpoints: true });
          setTimeout(() => { setLoadingStates({}); }, 1000);
          
          aiResponse = "Great choice! I'm now generating viewpoints to analyze your requirements from different testing perspectives...";
        }
        
        hasModifiedArtifacts = false;
      }
      // Handle artifact selection
      else if (message.startsWith("ARTIFACT_SELECTION:")) {
        const selectedArtifacts = message.replace("ARTIFACT_SELECTION:", "").split(",");
        const artifactNames = selectedArtifacts.map(id => {
          switch(id) {
            case "requirements": return "Requirements";
            case "viewpoints": return "Testing Viewpoints";
            case "testcases": return "Test Cases";
            case "traceability": return "Traceability Matrix";
            default: return id;
          }
        }).join(", ");
        
        aiResponse = `Perfect! I'll plan to generate ${artifactNames} for your test suite. This will provide comprehensive coverage of your testing needs.\n\n📋 **Implementation Plan:**\n• Analyze existing requirements\n• Generate ${artifactNames.toLowerCase()}\n• Establish traceability links\n• Validate coverage completeness`;
        hasModifiedArtifacts = false; // AI always provides plans first, never immediate modifications
      }
      // Handle new requirement detection from chat
      else if (message.toLowerCase().includes("new requirement") || 
               message.toLowerCase().includes("add requirement") ||
               message.toLowerCase().includes("requirement:") ||
               message.toLowerCase().includes("upload") && message.toLowerCase().includes("requirement")) {
        
        // Simulate detecting new requirements from user input
        const newReqId = `R-${String(requirements.length + 1).padStart(3, '0')}`;
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
          changeHistory: []
        };

        aiResponse = `✅ **New Requirement Detected!**\n\n**${newReqId}**: "${newRequirement.description}"\n\n📋 **Implementation Plan:**\n• Add requirement to workspace with "New" status\n• Generate related testing viewpoints\n• Create foundational test cases\n• Establish traceability links\n\nThis will provide a complete foundation for testing this requirement.`;
        hasModifiedArtifacts = false;
        versionManager.markUnsavedChanges();
      }
      // Handle specific artifact generation commands
      else if (message.includes("/sample")) {
        aiResponse = "📋 **Sample Test Cases Plan**\n\nI can generate comprehensive sample test cases for your suite:\n\n**Planned Test Cases:**\n• Functional authentication tests\n• Edge case scenarios\n• Integration test scenarios\n• Error handling tests\n\nEach test case will include detailed steps, expected outcomes, and traceability links.";
        hasModifiedArtifacts = false;
      }
      else if (message.includes("/viewpoints")) {
        aiResponse = "📋 **Testing Viewpoints Plan**\n\nI can create comprehensive testing viewpoints:\n\n**Planned Viewpoints:**\n• Functional Testing Viewpoint\n• Security Testing Viewpoint\n• Performance Testing Viewpoint\n• Usability Testing Viewpoint\n\nEach viewpoint will provide targeted testing strategies for comprehensive coverage.";
        hasModifiedArtifacts = false;
      }
      else if (message.toLowerCase().includes("generating artifacts") || 
               (message.toLowerCase().includes("generate") && message.toLowerCase().includes("viewpoints")) ||
               (message.toLowerCase().includes("generate") && message.toLowerCase().includes("requirements"))) {
        aiResponse = "📋 **Comprehensive Test Suite Plan**\n\nI can create a complete test suite structure:\n\n**Planned Requirements:**\n• 8 functional requirements covering core functionality\n• 3 non-functional requirements for performance and security\n• 2 integration requirements for system compatibility\n\n**Planned Testing Viewpoints:**\n• Functional Testing Viewpoint\n• Security Testing Viewpoint\n• Performance Testing Viewpoint\n• Usability Testing Viewpoint\n• Integration Testing Viewpoint\n\nThis will provide comprehensive coverage for your testing needs.";
        hasModifiedArtifacts = false;
      }
      // Handle specific commands
      else if (message.startsWith("/sample")) {
        aiResponse = "📋 **Sample Test Cases Plan**\n\nI can generate sample test cases for authentication scenarios:\n\n**Planned Test Cases:**\n• Valid registration flows\n• Password validation scenarios\n• Email verification processes\n• Error handling cases\n\nEach test case will include detailed steps, expected results, and traceability links to requirements.";
        hasModifiedArtifacts = false;
      }
      else if (message.startsWith("/viewpoints")) {
        aiResponse = "📋 **Testing Viewpoints Plan**\n\nI can create comprehensive testing viewpoints:\n\n**Planned Viewpoints:**\n• **Functional Testing Viewpoint**: Core authentication features\n• **Security Testing Viewpoint**: Password policies and data protection\n• **Usability Testing Viewpoint**: User-friendly registration experience\n• **Performance Testing Viewpoint**: System behavior under load\n\nThese viewpoints will ensure no critical testing areas are overlooked.";
        hasModifiedArtifacts = false;
      }
      else if (message.startsWith("/export")) {
        aiResponse = "I'm preparing your test cases for export. You can choose from several formats:\n\n📄 **Excel (.xlsx)** - Structured spreadsheet with all test details\n📋 **CSV** - Simple comma-separated format for easy import\n📝 **Word (.docx)** - Formatted document ready for documentation\n🔗 **TestRail** - Direct import format for TestRail integration\n\nWhich format would you prefer?";
        hasModifiedArtifacts = false;
      }
      else if (message.startsWith("/upload")) {
        aiResponse = "I'm ready to analyze your requirements document. Please upload your file and I'll:\n\n🔍 **Extract Requirements** - Identify and parse all functional requirements\n📊 **Generate Test Cases** - Create comprehensive test cases for each requirement\n🎯 **Create Viewpoints** - Develop testing perspectives for thorough coverage\n🔗 **Build Traceability** - Link everything together for complete visibility\n\nSupported formats: PDF, Word (.docx), Excel (.xlsx), and plain text files.";
        hasModifiedArtifacts = false;
      }
      // Handle general AI responses
      else {
        const responses = [
          "I'm here to help you create comprehensive test suites. I can analyze requirements, create testing viewpoints, generate test cases, and establish traceability links. What would you like to work on?",
          "I can assist with building structured deliverables based on your requirements. Feel free to describe your testing needs or use commands like /sample, /viewpoints, or /upload.",
          "Let me know what testing artifacts you need and I'll create an implementation plan. I can generate requirements, viewpoints, test cases, and ensure proper coverage.",
          "I'm ready to help with test suite development. Describe your testing objectives and I'll plan the appropriate artifacts and traceability links.",
          "Feel free to describe your testing requirements or upload documents. I'll analyze them and propose a structured approach for comprehensive test coverage."
        ];
        aiResponse = responses[Math.floor(Math.random() * responses.length)];
        hasModifiedArtifacts = false;
      }

      // Auto-save version for AI modifications
      let command = '';
      let versionInfo: ArtifactVersion | undefined = undefined;
      
      if (message.includes('/sample')) command = '/sample';
      else if (message.includes('/viewpoints')) command = '/viewpoints';
      else if (message.includes('ARTIFACT_SELECTION')) command = 'ARTIFACT_SELECTION';
      else if (lowerMessage.includes('generating artifacts') || 
               (lowerMessage.includes('generate') && lowerMessage.includes('viewpoints')) ||
               (lowerMessage.includes('generate') && lowerMessage.includes('requirements'))) {
        command = '/viewpoints'; // Treat as viewpoints generation
        console.log('🎯 Matched artifact generation pattern, command set to:', command);
      }
      
      
      
      if (command && hasModifiedArtifacts) {
        console.log('🚀 Creating auto-save version with command:', command);
        const currentArtifacts = { requirements, viewpoints, testCases };
        versionInfo = versionManager.autoSaveVersion(currentArtifacts, command);
        console.log('📦 Version created:', versionInfo);
      }

      // Check if AI response needs implementation permission
      let needsImplementation = false;
      let implementationPlan = "";
      
      if (lowerMessage.includes('generate') || lowerMessage.includes('/sample') || lowerMessage.includes('/viewpoints')) {
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
        hasModifiedArtifacts: hasModifiedArtifacts
      };

      setMessages(prev => [...prev, aiMessage]);
      setIsLoading(false);
    }, 1500);
  };
  const handleUpdateRequirement = (id: string, data: Partial<Requirement>, field?: string, oldValue?: string) => {
    setRequirements(prev => prev.map(req => {
      if (req.id === id) {
        const updated = {
          ...req,
          ...data,
          lastModified: new Date(),
          changeHistory: field && oldValue ? [...req.changeHistory, {
            timestamp: new Date(),
            field,
            oldValue,
            newValue: data[field as keyof Requirement] as string
          }] : req.changeHistory
        };

        // Trigger impact analysis
        if (field && oldValue !== data[field as keyof Requirement]) {
          analyzeChangeImpact('requirement', id, field);
        }
        return updated;
      }
      return req;
    }));
    
    // Mark as having unsaved changes
    versionManager.markUnsavedChanges();
  };
  const handleUpdateViewpoint = (id: string, data: Partial<Viewpoint>, field?: string, oldValue?: string) => {
    setViewpoints(prev => prev.map(vp => {
      if (vp.id === id) {
        const updated = {
          ...vp,
          ...data,
          lastModified: new Date(),
          changeHistory: field && oldValue ? [...vp.changeHistory, {
            timestamp: new Date(),
            field,
            oldValue,
            newValue: data[field as keyof Viewpoint] as string
          }] : vp.changeHistory
        };

        // Trigger impact analysis
        if (field && oldValue !== data[field as keyof Viewpoint]) {
          analyzeChangeImpact('viewpoint', id, field);
        }
        return updated;
      }
      return vp;
    }));
    
    // Mark as having unsaved changes
    versionManager.markUnsavedChanges();
  };
  const handleUpdateTestCase = (id: string, data: Partial<TestCase>, field?: string, oldValue?: string) => {
    setTestCases(prev => prev.map(tc => {
      if (tc.id === id) {
        const updated = {
          ...tc,
          ...data,
          lastModified: new Date(),
          changeHistory: field && oldValue ? [...tc.changeHistory, {
            timestamp: new Date(),
            field,
            oldValue,
            newValue: data[field as keyof TestCase] as string
          }] : tc.changeHistory
        };

        // Trigger impact analysis
        if (field && oldValue !== data[field as keyof TestCase]) {
          analyzeChangeImpact('testcase', id, field);
        }
        return updated;
      }
      return tc;
    }));
    
    // Mark as having unsaved changes
    versionManager.markUnsavedChanges();
  };
  const analyzeChangeImpact = (artifactType: string, artifactId: string, field: string) => {
    // Get related artifacts based on traceability links
    let impactedArtifacts: string[] = [];
    if (artifactType === 'requirement') {
      const req = requirements.find(r => r.id === artifactId);
      if (req) {
        impactedArtifacts = [...req.linkedViewpoints, ...req.linkedTestCases];
      }
    } else if (artifactType === 'viewpoint') {
      const vp = viewpoints.find(v => v.id === artifactId);
      if (vp) {
        impactedArtifacts = [...vp.linkedRequirements, ...vp.linkedTestCases];
      }
    } else if (artifactType === 'testcase') {
      const tc = testCases.find(t => t.id === artifactId);
      if (tc) {
        impactedArtifacts = [...tc.reqIds, ...tc.viewpointIds];
      }
    }
    if (impactedArtifacts.length > 0) {
      toast({
        title: "Change Impact Detected",
        description: `Changes to ${artifactId} may affect ${impactedArtifacts.length} related artifact(s)`,
        variant: "default"
      });
    }
  };
  const handleLinkArtifacts = (sourceType: string, sourceId: string, targetType: string, targetId: string) => {
    // Create bidirectional links
    if (sourceType === 'requirement' && targetType === 'viewpoint') {
      handleUpdateRequirement(sourceId, {
        linkedViewpoints: [...(requirements.find(r => r.id === sourceId)?.linkedViewpoints || []), targetId]
      });
      handleUpdateViewpoint(targetId, {
        linkedRequirements: [...(viewpoints.find(v => v.id === targetId)?.linkedRequirements || []), sourceId]
      });
    }
    // Add more linking logic for other combinations...

    toast({
      title: "Artifacts Linked",
      description: `Successfully linked ${sourceId} to ${targetId}`
    });
  };
  const handleExport = (format: string) => {
    toast({
      title: "Export Started",
      description: `Exporting ${testCases.length} test cases in ${format.toUpperCase()} format`
    });
  };
  const toggleSuiteStatus = () => {
    if (suiteStatus === "idle" || suiteStatus === "paused") {
      setSuiteStatus("running");
      toast({
        title: "Suite Running",
        description: "AI test generation is now active"
      });
    } else {
      setSuiteStatus("paused");
      toast({
        title: "Suite Paused",
        description: "AI generation paused - you can resume anytime"
      });
    }
  };
  const resetSuite = () => {
    setSuiteStatus("idle");
    setMessages(messages.slice(0, 1)); // Keep welcome message
    toast({
      title: "Suite Reset",
      description: "Workspace reset to initial state"
    });
  };

  // Version action handlers
  const handleVersionAction = (action: VersionAction) => {
    if (action.type === 'view-history') {
      setShowVersionHistory(true);
    } else if (action.type === 'restore' && action.versionId) {
      const versionNumber = parseInt(action.versionId);
      const version = versionManager.versions.find(v => v.versionNumber === versionNumber);
      if (version) {
        versionManager.restoreVersion(version, (data) => {
          setRequirements(data.requirements);
          setViewpoints(data.viewpoints);
          setTestCases(data.testCases);
        });
        toast({
          title: "Version Restored",
          description: `Successfully restored to version ${version.versionNumber}`
        });
      }
    }
  };

  const handleSaveVersion = (description: string) => {
    const currentArtifacts = { requirements, viewpoints, testCases };
    const newVersion = versionManager.saveVersion(currentArtifacts, description);
    setShowSaveVersionDialog(false);
    toast({
      title: "Version Saved",
      description: `Version ${newVersion.versionNumber} saved successfully`
    });
  };

  const getChangedArtifacts = () => {
    // Return empty array since we're not using this for manual saves anymore
    return [];
  };
  

  // Mock data for breadcrumb navigation based on suite ID
  const getSuiteInfo = (suiteId: string) => {
    const suiteMap: Record<string, {
      projectName: string;
      projectId: string;
      folderName: string;
      suiteName: string;
    }> = {
      "s1": {
        projectName: "My Space",
        projectId: "my-space",
        folderName: "Personal Projects",
        suiteName: "E-commerce Platform Testing"
      },
      "s2": {
        projectName: "Project A",
        projectId: "p1",
        folderName: "Core Features",
        suiteName: "User Authentication Suite"
      },
      "s3": {
        projectName: "Project D",
        projectId: "sp1",
        folderName: "Core System",
        suiteName: "Payment Processing Tests"
      }
    };
    return suiteMap[suiteId || "s1"] || suiteMap["s1"];
  };
  const suiteInfo = getSuiteInfo(id || "s1");
  return <div className="h-screen flex flex-col bg-workspace-bg">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-background border-b border-border/50 h-16">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>
          <div className="flex flex-col gap-2">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink onClick={() => navigate("/projects")} className="cursor-pointer">
                    Projects
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink onClick={() => navigate(`/project/${suiteInfo.projectId}/folders`)} className="cursor-pointer">
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
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Chat */}
        <div className="relative w-1/3 min-w-[400px] max-w-[500px] h-full">
          <ChatPanel 
            messages={messages} 
            onSendMessage={handleSendMessage} 
            isLoading={isLoading}
            hasUnsavedChanges={versionManager.hasUnsavedChanges}
            onVersionAction={handleVersionAction}
            onViewHistory={() => setShowVersionHistory(true)}
            uploadedFiles={uploadedFiles}
            latestTestcasesVersion={latestTestcasesVersion}
          />
          {initialChatLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70 z-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

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
    </div>;
}

