import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Send, Bot, User, Upload, Zap, Target, Plus, Lightbulb, ArrowUp, AtSign, MessageSquare, Clock, FileText, File } from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { ArtifactSelectionChips } from "./artifact-selection-chips";
import { NextStepChips } from "./next-step-chips";
import { Logo } from "@/components/ui/logo";
import { VersionActionChips } from "./version-action-chips";
import { VersionAction } from "@/types/version";
interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
  timestamp: Date;
  type?: "command" | "normal" | "artifact-selection" | "next-step" | "version-action" | "sample-confirmation" | "quality-confirmation" | "requirements-feedback" | "requirements-sample-offer" | "testcases-sample-offer";
  needsImplementation?: boolean;
  implementationPlan?: string;
  versionInfo?: import("@/types/version").ArtifactVersion;
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
  uploadedFiles = []
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [showCommands, setShowCommands] = useState(false);
  
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
          {(() => {
            // Hide empty placeholder messages (e.g., pending AI response) while still
            // showing special interactive message types like selection chips
            const visibleMessages = (messages || []).filter(m => {
              if (m?.type === "artifact-selection" || m?.type === "next-step") return true;
              return Boolean((m?.content || "").trim());
            });
            return visibleMessages.length === 0;
          })() && <div className="text-center text-muted-foreground py-8">
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

          {(messages || []).filter(message => {
            if (message?.type === "artifact-selection" || message?.type === "next-step") return true;
            return Boolean((message?.content || "").trim());
          }).map((message, idx) => <div key={message.id} className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}>
              {message.role === "ai" && <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Logo size="sm" iconOnly />
                </div>}
              
              <div className={cn("max-w-[80%] rounded-lg p-3 text-sm break-words", message.role === "user" ? "bg-primary text-white" : "bg-card border border-border/50 text-card-foreground")}>
                {message.type === "artifact-selection" ? (
                  <ArtifactSelectionChips
                    onConfirm={(selectedArtifacts) => {
                      onSendMessage(`ARTIFACT_SELECTION:${selectedArtifacts.join(',')}`);
                    }}
                  />
                ) : message.type === "next-step" ? (
                  <NextStepChips onSelect={handleNextStepSelection} />
                ) : (
                  message.role === "user" ? (
                    <div className="text-white whitespace-pre-wrap break-words">
                      <ReactMarkdown>{(message.content || '').trim()}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-li:my-0 break-words prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:max-w-full prose-pre:overflow-x-auto">
                      <ReactMarkdown>{(message.content || '').trim()}</ReactMarkdown>
                    </div>
                  )
                )}
                
                {/* Sample confirmation CTA */}
                {message.role === "ai" && message.type === "sample-confirmation" && (
                  <div className="mt-3 mb-3 pt-3 border-t border-border/20 flex items-center justify-between gap-2">
                    <div className="flex gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className="text-xs"
                        onClick={() => onSendMessage("Yes please")}
                        disabled={idx < messages.length - 1}
                      >
                        Confirm & Generate Full Test Cases
                      </Button>
                    </div>
                  </div>
                )}

                {/* Quality confirmation CTA: two choices */}
                {message.role === "ai" && message.type === 'quality-confirmation' && (
                  <div className="mt-3 mb-3 pt-3 border-t border-border/20 flex items-center justify-between gap-2">
                    <div className="flex gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className="text-xs"
                        onClick={() => onSendMessage("Yes please")}
                        disabled={idx < messages.length - 1}
                      >
                        Extract requirements first
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => onSendMessage("Generate directly")}
                        disabled={idx < messages.length - 1}
                      >
                        Generate directly
                      </Button>
                    </div>
                  </div>
                )}

                {/* Requirements feedback CTA: proceed to test cases */}
                {message.role === "ai" && message.type === 'requirements-feedback' && (
                  <div className="mt-3 mb-3 pt-3 border-t border-border/20 flex items-center justify-between gap-2">
                    <div className="flex gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className="text-xs"
                        onClick={() => onSendMessage("CONTINUE")}
                        disabled={idx < messages.length - 1}
                      >
                        Proceed to Test Cases
                      </Button>
                    </div>
                  </div>
                )}

                {/* Requirements sample offer CTA */}
                {message.role === "ai" && message.type === 'requirements-sample-offer' && (
                  <div className="mt-3 mb-3 pt-3 border-t border-border/20 flex items-center justify-between gap-2">
                    <div className="flex gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className="text-xs"
                        onClick={() => onSendMessage("Generate Requirements Sample")}
                        disabled={idx < messages.length - 1}
                      >
                        Generate Requirements Sample
                      </Button>
                    </div>
                  </div>
                )}

                {/* Test cases sample offer CTA */}
                {message.role === "ai" && message.type === 'testcases-sample-offer' && (
                  <div className="mt-3 mb-3 pt-3 border-t border-border/20 flex items-center justify-between gap-2">
                    <div className="flex gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className="text-xs"
                        onClick={() => onSendMessage("Generate Test Cases Sample")}
                        disabled={idx < messages.length - 1}
                      >
                        Generate Test Cases Sample
                      </Button>
                    </div>
                  </div>
                )}

                {/* Implementation permission chip */}
                {message.role === "ai" && message.needsImplementation && (
                  <div className="mt-3 pt-3 border-t border-border/20">
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-primary/5 border-primary/20 hover:bg-primary/10 text-primary text-xs"
                      onClick={() => onSendMessage(`IMPLEMENT_PLAN:${message.id}`)}
                    >
                      Implement the plan
                    </Button>
                  </div>
                )}
                
                {/* Version Action Chips for messages with version data */}
                {message.role === "ai" && message.type === "version-action" && message.versionInfo && onVersionAction && (
                  <div className="mt-3 pt-3 border-t border-border/20">
                    <VersionActionChips
                      latestVersion={message.versionInfo}
                      onAction={onVersionAction}
                    />
                  </div>
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

    </TooltipProvider>;
}