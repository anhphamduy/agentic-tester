import { useState, useRef, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Send, Bot, User, Upload, Zap, Target, Plus, Lightbulb, ArrowUp, AtSign, MessageSquare, Clock, FileText, File, RotateCcw, ChevronRight, MoreHorizontal, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { ArtifactSelectionChips } from "./artifact-selection-chips";
import { NextStepChips } from "./next-step-chips";
import { Logo } from "@/components/ui/logo";
import { VersionActionChips } from "./version-action-chips";
import { VersionAction } from "@/types/version";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
  timestamp: Date;
  type?: "command" | "normal" | "artifact-selection" | "next-step" | "version-action" | "sample-confirmation" | "quality-confirmation" | "requirements-feedback" | "requirements-sample-offer" | "testcases-sample-offer" | "testing-type-choice" | "gaps-follow-up" | "version-update";
  needsImplementation?: boolean;
  implementationPlan?: string;
  versionInfo?: import("@/types/version").ArtifactVersion;
  versionNumber?: number;
  versionData?: {
    name: string;
    id: string;
    timestamp: Date;
    changes: string[];
  };
  hasModifiedArtifacts?: boolean;
}
interface ChatPanelProps {
  onSendMessage: (message: string, opts?: { silent?: boolean }) => void;
  messages: Message[];
  isLoading?: boolean;
  hasUnsavedChanges?: boolean;
  onVersionAction?: (action: VersionAction) => void;
  onViewHistory?: () => void;
  uploadedFiles?: { id: string; name: string; type: string }[];
  latestTestcasesVersion?: number;
}
const slashCommands = [{
  cmd: "/upload",
  desc: "Upload requirements document",
  icon: Upload
}, {
  cmd: "/sample",
  desc: "Generate sample test cases",
  icon: Zap
}, {
  cmd: "/viewpoints",
  desc: "Create testing viewpoints",
  icon: Target
}, {
  cmd: "/export",
  desc: "Export test cases",
  icon: Send
}];
export function ChatPanel({
  onSendMessage,
  messages,
  isLoading,
  hasUnsavedChanges = false,
  onVersionAction,
  onViewHistory,
  uploadedFiles = [],
  latestTestcasesVersion
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [showCommands, setShowCommands] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewData, setPreviewData] = useState<any | null>(null);
  
  const [showFileMention, setShowFileMention] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth"
    });
  };
  useEffect(() => {
    scrollToBottom();
  }, [messages]);
  const handleSend = () => {
    if (!input.trim()) return;
    onSendMessage(input);
    setInput("");
    setShowCommands(false);
  };
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  const adjustTextareaHeight = () => {
    if (inputRef.current) {
      inputRef.current.style.height = "56px"; // Reset to minimum height (taller default)
      const maxHeight = 120; // Maximum height in pixels
      const newHeight = Math.min(inputRef.current.scrollHeight, maxHeight);
      inputRef.current.style.height = `${newHeight}px`;
    }
  };
  useEffect(() => {
    adjustTextareaHeight();
  }, [input]);
  const handleCommandSelect = (cmd: string) => {
    setInput(cmd + " ");
    setShowCommands(false);
    inputRef.current?.focus();
  };

  const extractPreviewData = (text: string): any | null => {
    try {
      const re = /<<<PREVIEW_DATA:([\s\S]*?)>>>/;
      const match = re.exec(text || "");
      if (!match) return null;
      const json = JSON.parse(match[1]);
      if (json && typeof json === "object") return json;
    } catch {}
    return null;
  };

  // Visible messages (keep interactive types even if empty content)
  const visibleMessages = useMemo(() => {
    try {
      return (messages || []).filter(m => {
        if (m?.type === "artifact-selection" || m?.type === "next-step") return true;
        return Boolean((m?.content || "").trim());
      });
    } catch {
      return messages || [];
    }
  }, [messages]);

  // Determine the latest version number across all messages (for hiding Restore on latest)
  const latestVersionAcrossMessages = useMemo(() => {
    try {
      let max = -Infinity;
      for (const m of messages || []) {
        const text = String(m?.content || "");
        const re = /<<<VERSION_BUTTON:([\s\S]*?)>>>/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(text)) !== null) {
          try {
            const json = JSON.parse(match[1]);
            const v = typeof json?.version === "number" ? json.version : parseInt(String(json?.version ?? ""), 10);
            if (!Number.isNaN(v)) max = Math.max(max, v);
          } catch {}
        }
      }
      return Number.isFinite(max) ? max : undefined;
    } catch {
      return undefined;
    }
  }, [messages]);

  const handleNextStepSelection = (option: "test-cases" | "viewpoints") => {
    onSendMessage(`NEXT_STEP:${option}`);
  };
  const filteredCommands = slashCommands.filter(cmd => input.startsWith("/") && cmd.cmd.includes(input.toLowerCase()));
  useEffect(() => {
    setShowCommands(input.startsWith("/") && filteredCommands.length > 0);
  }, [input]);

  // Handle file selection
  const handleFileSelect = (fileName: string) => {
    const mentionText = `@${fileName}`;
    setInput(prev => prev + mentionText + " ");
    setShowFileMention(false);
    inputRef.current?.focus();
  };
  return <TooltipProvider>
      <div className="h-full flex flex-col bg-workspace-chat border-r border-border/50">
        {/* Header */}
        <div className="p-4 border-b border-border/50 bg-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Logo size="sm" iconOnly />
              <h2 className="font-semibold text-card-foreground">AI Test Case Assistant</h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onViewHistory}
              className="text-muted-foreground hover:text-foreground"
            >
              <Clock className="h-4 w-4" />
            </Button>
          </div>
        </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {visibleMessages.length === 0 && <div className="text-center text-muted-foreground py-8">
              <Logo className="mx-auto mb-4" size="lg" iconOnly />
              <p className="text-lg font-medium">Welcome to TestVista</p>
              <p className="text-sm">Start by uploading requirements or asking me to generate test cases</p>
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium">Try these commands:</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {slashCommands.slice(0, 3).map(cmd => <Badge key={cmd.cmd} variant="outline" className="cursor-pointer hover:bg-primary-light" onClick={() => handleCommandSelect(cmd.cmd)}>
                      {cmd.cmd}
                    </Badge>)}
                </div>
              </div>
            </div>}

          {visibleMessages.map((message, idx) => <div key={message.id} className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}>
              {message.role === "ai" && <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Logo size="sm" iconOnly />
                </div>}
              
              <div className={cn("max-w-[80%] rounded-lg p-3 text-sm break-words", message.role === "user" ? "bg-primary text-white" : "bg-card border border-border/50 text-card-foreground")}>
                {message.type === "artifact-selection" ? (
                  (() => {
                    const disabledByLaterUser = visibleMessages.slice(idx + 1).some(m => m.role === "user" && Boolean((m?.content || "").trim()));
                    return (
                      <div className={cn("relative", disabledByLaterUser && "opacity-60")}> 
                        <ArtifactSelectionChips
                          onConfirm={(selectedArtifacts) => {
                            if (disabledByLaterUser) return;
                            onSendMessage(`ARTIFACT_SELECTION:${selectedArtifacts.join(',')}`);
                          }}
                        />
                        {disabledByLaterUser && <div className="absolute inset-0 z-10 cursor-not-allowed"></div>}
                      </div>
                    );
                  })()
                ) : message.type === "next-step" ? (
                  (() => {
                    const disabledByLaterUser = visibleMessages.slice(idx + 1).some(m => m.role === "user" && Boolean((m?.content || "").trim()));
                    return (
                      <div className={cn("relative", disabledByLaterUser && "opacity-60")}>
                        <NextStepChips onSelect={handleNextStepSelection} />
                        {disabledByLaterUser && <div className="absolute inset-0 z-10 cursor-not-allowed"></div>}
                      </div>
                    );
                  })()
                ) : (
                  message.role === "user" ? (
                    <div className="text-white whitespace-pre-wrap break-words">
                      <ReactMarkdown>{(message.content || '').trim()}</ReactMarkdown>
                    </div>
                  ) : (
                    message.type === "quality-confirmation" ? (
                      <div>
                        <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-li:my-0 break-words">
                          <ReactMarkdown>{(message.content || '').trim()}</ReactMarkdown>
                        </div>
                        <div className="mt-3 mb-2 flex gap-2">
                          <Button
                            size="sm"
                            className="h-7 px-3 text-xs"
                            onClick={() => onSendMessage("Generate requirements first")}
                            disabled={visibleMessages.slice(idx + 1).some(m => m.role === "user" && Boolean((m?.content || "").trim()))}
                          >
                            Generate requirements
                          </Button>
                        </div>
                      </div>
                    ) : message.type === "sample-confirmation" ? (
                      (() => {
                        const raw = (message.content || '').trim();
                        const data = extractPreviewData(raw);
                        const displayText = raw.replace(/<<<PREVIEW_DATA:[\s\S]*?>>>/g, '').trim();
                        const disabledByLaterUser = visibleMessages.slice(idx + 1).some(m => m.role === "user" && Boolean((m?.content || "").trim()));

                        // Split the preview text into ordered segments around VERSION_BUTTON tokens
                        type Seg = { kind: 'text'; text: string } | { kind: 'version'; version: number; description: string };
                        const orderedSegments: Seg[] = [];
                        try {
                          const re = /<<<VERSION_BUTTON:([\s\S]*?)>>>/g;
                          let lastIndex = 0;
                          let match: RegExpExecArray | null;
                          while ((match = re.exec(displayText)) !== null) {
                            const idx = match.index;
                            const before = displayText.slice(lastIndex, idx);
                            if (before.trim()) orderedSegments.push({ kind: 'text', text: before });
                            try {
                              const json = JSON.parse(match[1]);
                              const v = typeof json?.version === 'number' ? json.version : parseInt(String(json?.version ?? ''), 10);
                              const d = String(json?.description ?? '');
                              if (!Number.isNaN(v)) orderedSegments.push({ kind: 'version', version: v, description: d });
                            } catch {}
                            lastIndex = re.lastIndex;
                          }
                          const after = displayText.slice(lastIndex);
                          if (after.trim()) orderedSegments.push({ kind: 'text', text: after });
                        } catch {
                          if (displayText.trim()) orderedSegments.push({ kind: 'text', text: displayText.trim() });
                        }

                        return (
                          <div>
                            <div className="space-y-3">
                              {orderedSegments.map((seg, i) => (
                                seg.kind === 'text' ? (
                                  <div key={i} className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-li:my-0 break-words">
                                    <ReactMarkdown>{seg.text}</ReactMarkdown>
                                  </div>
                                ) : (
                                  <div key={i} className="my-1">
                                    <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                          <div className="text-sm font-medium whitespace-pre-wrap break-words">{seg.description || 'Untitled change'}</div>
                                          <div className="mt-1 text-xs text-muted-foreground">v{seg.version}</div>
                                        </div>
                                        {!(latestVersionAcrossMessages != null && seg.version === latestVersionAcrossMessages) && (
                                          <div className="flex items-center gap-2">
                                            <button
                                              onClick={() => onVersionAction?.({ type: 'restore', versionId: String(seg.version) })}
                                              className="text-xs font-medium px-2 py-1 rounded border border-muted-foreground/20 hover:bg-muted/30 hover:text-muted-foreground focus-visible:ring-muted"
                                              disabled={disabledByLaterUser}
                                            >
                                              Restore
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )
                              ))}
                            </div>
                            {data && (
                              <div className="mt-3 mb-2">
                                <div className={cn("relative", disabledByLaterUser && "opacity-60")}> 
                                  <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium whitespace-pre-wrap break-words">Generated sample</div>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-3 text-xs"
                                        onClick={() => { if (!disabledByLaterUser) { setPreviewData(data); setShowPreviewModal(true); } }}
                                      >
                                        <Eye className="h-3.5 w-3.5 mr-1" />
                                        View
                                      </Button>
                                    </div>
                                  </div>
                                  {disabledByLaterUser && <div className="absolute inset-0 z-10 cursor-not-allowed"></div>}
                                </div>
                              </div>
                            )}
                            <div className="mt-2 mb-2 w-full flex justify-between gap-2">
                              <Button
                                size="sm"
                                className="h-7 px-3 text-xs flex-1"
                                onClick={() => onSendMessage("Looks good — continue")}
                                disabled={disabledByLaterUser}
                              >
                                Looks good — continue
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-3 text-xs text-muted-foreground border-muted-foreground/20 hover:bg-muted/30 hover:text-muted-foreground focus-visible:ring-muted flex-1"
                                onClick={() => onSendMessage("Show another sample")}
                                disabled={disabledByLaterUser}
                              >
                                Show another sample
                              </Button>
                            </div>
                          </div>
                        );
                      })()
                    ) : message.type === "testing-type-choice" ? (
                      (() => {
                        const disabledByLaterUser = visibleMessages.slice(idx + 1).some(m => m.role === "user" && Boolean((m?.content || "").trim()));
                        return (
                          <div>
                            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-li:my-0 break-words">
                              <ReactMarkdown>{(message.content || '').trim()}</ReactMarkdown>
                            </div>
                            <div className={cn(
                              "relative mt-3 mb-2 inline-flex max-w-[380px] w-full rounded-md overflow-hidden border border-border/50 divide-x divide-border/50",
                              disabledByLaterUser && "opacity-60"
                            )}>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs rounded-none flex-1"
                                onClick={() => onSendMessage("Integration testing")}
                                disabled={disabledByLaterUser}
                              >
                                Integration
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs rounded-none flex-1"
                                onClick={() => onSendMessage("Unit testing")}
                                disabled={disabledByLaterUser}
                              >
                                Unit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs rounded-none flex-1"
                                onClick={() => onSendMessage("System testing")}
                                disabled={disabledByLaterUser}
                              >
                                System
                              </Button>
                              {disabledByLaterUser && <div className="absolute inset-0 z-10 cursor-not-allowed" />}
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      (() => {
                        const content = (message.content || '').trim();
                        const hasVersionButton = content.includes('<<<VERSION_BUTTON:');
                        if (!hasVersionButton) {
                          if (message.type === 'requirements-feedback') {
                            return (
                              <div>
                                <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-li:my-0 break-words">
                                  <ReactMarkdown>{content}</ReactMarkdown>
                                </div>
                                <div className="mt-3 flex gap-2">
                                  <Button size="sm" className="h-7 px-3 text-xs mb-2" onClick={() => onSendMessage("Continue to generate test cases")} disabled={visibleMessages.slice(idx + 1).some(m => m.role === "user" && Boolean((m?.content || "").trim()))}>Continue to generate test cases</Button>
                                </div>
                              </div>
                            );
                          } else if (message.type === 'gaps-follow-up') {
                            const disabledByLaterUser = visibleMessages.slice(idx + 1).some(m => m.role === 'user' && Boolean((m?.content || '').trim()));
                            return (
                              <div>
                                <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-li:my-0 break-words">
                                  <ReactMarkdown>{content}</ReactMarkdown>
                                </div>
                                <div className={cn("mt-3 mb-2", disabledByLaterUser && "opacity-60")}> 
                                  <Button size="sm" className="h-7 px-3 text-xs mb-2" onClick={() => onSendMessage("Skip gaps and continue")} disabled={disabledByLaterUser}>Skip gaps</Button>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-li:my-0 break-words prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:max-w-full prose-pre:overflow-x-auto">
                              <ReactMarkdown>{content}</ReactMarkdown>
                            </div>
                          );
                        }
                        const segments: Array<{ kind: 'text'; text: string } | { kind: 'version'; version: number; description: string }> = [];
                        try {
                          const re = /<<<VERSION_BUTTON:([\s\S]*?)>>>/g;
                          let lastIndex = 0;
                          let match: RegExpExecArray | null;
                          while ((match = re.exec(content)) !== null) {
                            const idx = match.index;
                            const before = content.slice(lastIndex, idx);
                            if (before.trim()) segments.push({ kind: 'text', text: before });
                            try {
                              const json = JSON.parse(match[1]);
                              const v = typeof json?.version === 'number' ? json.version : parseInt(String(json?.version ?? ''), 10);
                              const d = String(json?.description ?? '');
                              if (!Number.isNaN(v)) segments.push({ kind: 'version', version: v, description: d });
                            } catch {
                              // ignore malformed placeholder
                            }
                            lastIndex = re.lastIndex;
                          }
                          const after = content.slice(lastIndex);
                          if (after.trim()) segments.push({ kind: 'text', text: after });
                        } catch {
                          // fallback to plain markdown
                          return (
                            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-li:my-0 break-words prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:max-w-full prose-pre:overflow-x-auto">
                              <ReactMarkdown>{content}</ReactMarkdown>
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-3">
                            {segments.map((seg, i) => {
                              if (seg.kind === 'text') {
                                return (
                                  <div key={i} className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-li:my-0 break-words prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:max-w-full prose-pre:overflow-x-auto">
                                    <ReactMarkdown>{seg.text.trim()}</ReactMarkdown>
                                  </div>
                                );
                              }
                              return (
                                <div key={i} className="my-2">
                                  <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium whitespace-pre-wrap break-words">{seg.description || 'Untitled change'}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">v{seg.version}</div>
                                      </div>
                                      {!(latestVersionAcrossMessages != null && seg.version === latestVersionAcrossMessages) && (
                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={() => onVersionAction?.({ type: 'restore', versionId: String(seg.version) })}
                                            className="text-xs font-medium px-2 py-1 rounded border border-muted-foreground/20 hover:bg-muted/30 hover:text-muted-foreground focus-visible:ring-muted"
                                            disabled={visibleMessages.slice(idx + 1).some(m => m.role === 'user' && Boolean((m?.content || '').trim()))}
                                          >
                                            Restore
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                            {message.type === 'requirements-feedback' && (
                              <div className="mt-1">
                                <Button size="sm" className="h-7 px-3 text-xs mb-2" onClick={() => onSendMessage("Continue to generate test cases")} disabled={visibleMessages.slice(idx + 1).some(m => m.role === "user" && Boolean((m?.content || "").trim()))}>Continue to generate test cases</Button>
                              </div>
                            )}
                          </div>
                        );
                      })()
                    )
                  )
                )}
                
                <span className="text-xs opacity-70 mt-1 block">
                  {message.timestamp.toLocaleTimeString()}
                </span>
              </div>
            </div>)}


          {isLoading && <div className="flex gap-3 justify-start">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Logo size="sm" iconOnly />
              </div>
              <div className="bg-card border border-border/50 rounded-lg p-3 text-sm">
                <div className="flex items-center gap-2">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
                  </div>
                  <span className="text-muted-foreground">AI is thinking...</span>
                </div>
              </div>
            </div>}

          {/* Version Action Chips - Now handled at workspace level */}
          
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Command Suggestions */}
      {showCommands && <div className="mx-4 mb-2">
          <Card className="p-2 border-border/50 shadow-md">
            <div className="space-y-1">
              {filteredCommands.map(cmd => <button key={cmd.cmd} onClick={() => handleCommandSelect(cmd.cmd)} className="w-full text-left p-2 rounded hover:bg-accent flex items-center gap-3 text-sm">
                  <cmd.icon className="h-4 w-4 text-primary" />
                  <div>
                    <span className="font-medium">{cmd.cmd}</span>
                    <p className="text-xs text-muted-foreground">{cmd.desc}</p>
                  </div>
                </button>)}
            </div>
          </Card>
        </div>}

      {/* Input */}
      <div className="p-3 border-t border-border/20">
        <div className="relative bg-background/50 border border-border/30 rounded-xl hover:border-border/50 transition-colors duration-200 focus-within:border-primary/50 focus-within:bg-background">
          <div className="flex flex-col p-3 gap-3">
            {/* Text input area - now on top and full width */}
            <div className="w-full">
              <Textarea ref={inputRef} value={input} onChange={e => {
                setInput(e.target.value);
                adjustTextareaHeight();
              }} onKeyPress={handleKeyPress} placeholder="Ask TestVista anything..." className="min-h-[56px] max-h-[120px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm p-0 placeholder:text-muted-foreground/60 w-full" disabled={isLoading} style={{
                height: "56px"
              }} />
            </div>

            {/* Tool buttons row - now below text input */}
            <div className="flex items-center justify-between">
               <div className="flex items-center gap-1">
                <Popover open={showFileMention} onOpenChange={setShowFileMention}>
                  <PopoverTrigger asChild>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 w-8 p-0 hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <AtSign className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Mention a Document</p>
                      </TooltipContent>
                    </Tooltip>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-2 bg-background border shadow-md z-50" align="start" side="top">
                    <div className="space-y-1">
                      <div className="text-sm font-medium px-2 py-1 text-muted-foreground">
                        Uploaded Files
                      </div>
                      {uploadedFiles.length === 0 ? (
                        <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                          No files uploaded yet
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {uploadedFiles.map((file) => (
                            <button
                              key={file.id}
                              onClick={() => handleFileSelect(file.name)}
                              className="w-full flex items-center gap-2 px-2 py-2 text-sm hover:bg-accent rounded-md transition-colors text-left"
                            >
                              {file.type.includes('pdf') ? (
                                <FileText className="h-4 w-4 text-red-500" />
                              ) : (
                                <File className="h-4 w-4 text-blue-500" />
                              )}
                              <span className="truncate">{file.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Attach Files</p>
                  </TooltipContent>
                </Tooltip>
                
              </div>

              {/* Send button - positioned on the right */}
              <Button onClick={handleSend} disabled={!input.trim() || isLoading} size="sm" className={cn("h-8 w-8 p-0 rounded-md transition-all duration-200", input.trim() && !isLoading ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm" : "bg-muted/50 text-muted-foreground cursor-not-allowed")}>
                {isLoading ? <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" /> : <ArrowUp className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* Preview Modal */}
      <PreviewTableModal open={showPreviewModal} onOpenChange={setShowPreviewModal} data={previewData} />

    </TooltipProvider>;

  // Preview Modal rendering outside main return due to TSX constraints
}

export function PreviewTableModal({ open, onOpenChange, data }: { open: boolean; onOpenChange: (v: boolean) => void; data: any }) {
  const reqs = Array.isArray(data?.requirements) ? data.requirements : [];
  const tcs = Array.isArray(data?.testcases) ? data.testcases : [];
  const flows = Array.isArray(data?.flows) ? data.flows : [];
  const vps = Array.isArray(data?.viewpoints) ? data.viewpoints : [];
  const mode = typeof data?.preview_mode === 'string' ? String(data.preview_mode) : '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Preview Sample</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          {(reqs.length > 0 && (!mode || mode === 'requirements')) && (
            <div>
              <div className="text-sm font-medium mb-2">Requirements (sample)</div>
              <div className="overflow-x-auto border border-border/50 rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left p-2">ID</th>
                      <th className="text-left p-2">Source</th>
                      <th className="text-left p-2">Text</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reqs.map((r: any, i: number) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="p-2 align-top whitespace-nowrap">{String(r?.id ?? '')}</td>
                        <td className="p-2 align-top whitespace-nowrap">{String(r?.source ?? '')}</td>
                        <td className="p-2 align-top">{String(r?.text ?? '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {(tcs.length > 0 && (!mode || mode === 'testcases')) && (
            <div>
              <div className="text-sm font-medium mb-2">Test Cases (sample)</div>
              <div className="overflow-x-auto border border-border/50 rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left p-2">Req ID</th>
                      <th className="text-left p-2">Case ID</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-left p-2">Title</th>
                      <th className="text-left p-2">Preconditions</th>
                      <th className="text-left p-2">Steps</th>
                      <th className="text-left p-2">Expected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tcs.map((c: any, i: number) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="p-2 align-top whitespace-nowrap">{String(c?.requirement_id ?? '')}</td>
                        <td className="p-2 align-top whitespace-nowrap">{String(c?.case_id ?? '')}</td>
                        <td className="p-2 align-top whitespace-nowrap">{String(c?.type ?? '')}</td>
                        <td className="p-2 align-top">{String(c?.title ?? '')}</td>
                        <td className="p-2 align-top whitespace-pre-wrap">{String(c?.preconditions ?? '')}</td>
                        <td className="p-2 align-top whitespace-pre-wrap">{String(c?.steps ?? '')}</td>
                        <td className="p-2 align-top">{String(c?.expected ?? '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {(flows.length > 0 && (!mode || mode === 'test_design')) && (
            <div>
              <div className="text-sm font-medium mb-2">Test Design Flows (sample)</div>
              <div className="overflow-x-auto border border-border/50 rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left p-2">ID</th>
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2">Description</th>
                      <th className="text-left p-2">Requirements</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flows.map((f: any, i: number) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="p-2 align-top whitespace-nowrap">{String(f?.id ?? '')}</td>
                        <td className="p-2 align-top whitespace-nowrap">{String(f?.name ?? '')}</td>
                        <td className="p-2 align-top">{String(f?.description ?? '')}</td>
                        <td className="p-2 align-top whitespace-nowrap">{String(f?.requirements ?? '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {(vps.length > 0 && (!mode || mode === 'viewpoints')) && (
            <div>
              <div className="text-sm font-medium mb-2">Viewpoints (sample)</div>
              <div className="overflow-x-auto border border-border/50 rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2">Scenario</th>
                      <th className="text-left p-2">Requirements</th>
                      <th className="text-left p-2">Flows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vps.map((v: any, i: number) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="p-2 align-top whitespace-nowrap">{String(v?.name ?? '')}</td>
                        <td className="p-2 align-top">{String(v?.scenario ?? '')}</td>
                        <td className="p-2 align-top whitespace-nowrap">{String(v?.requirements ?? '')}</td>
                        <td className="p-2 align-top whitespace-nowrap">{String(v?.flows ?? '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}