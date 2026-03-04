/**
 * Bottom chat bar — conversation input with inline message history.
 */
import { useState, useRef, useEffect } from "react";
import { useStoryboardStore } from "../stores/storyboard.store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Send, Loader2, Bot, User, AlertCircle, ChevronUp, ChevronDown, KeyRound } from "lucide-react";
import { getDeepSeekApiKey } from "../api/deepseek";

export function ChatBar() {
  const [input, setInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const chatMessages = useStoryboardStore((s) => s.chatMessages);
  const isAgentWorking = useStoryboardStore((s) => s.isAgentWorking);
  const sendMessage = useStoryboardStore((s) => s.sendMessage);
  const project = useStoryboardStore((s) => s.project);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showHistory) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, showHistory]);

  const handleSend = async () => {
    if (!input.trim() || isAgentWorking) return;
    if (!getDeepSeekApiKey()) return; // guard: no key
    const msg = input.trim();
    setInput("");
    setShowHistory(true);
    await sendMessage(msg);
  };

  const hasKey = getDeepSeekApiKey().length > 0;
  const lastAssistant = [...chatMessages].reverse().find((m) => m.role === "assistant");

  return (
    <div className="border-t bg-card/50 backdrop-blur shrink-0">
      {/* Expandable message history */}
      {showHistory && chatMessages.length > 0 && (
        <ScrollArea className="max-h-40 border-b">
          <div className="px-3 py-2 space-y-1.5">
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex items-start gap-1.5 text-xs",
                  msg.role === "user" ? "justify-end" : "",
                )}
              >
                {msg.role !== "user" && (
                  <span className="shrink-0 mt-0.5">
                    {msg.role === "assistant" ? (
                      <Bot className="h-3 w-3 text-primary" />
                    ) : (
                      <AlertCircle className="h-3 w-3 text-muted-foreground" />
                    )}
                  </span>
                )}
                <span
                  className={cn(
                    "rounded-lg px-2.5 py-1 max-w-[80%]",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : msg.role === "assistant"
                        ? "bg-muted"
                        : "bg-muted/50 text-muted-foreground italic",
                  )}
                >
                  {msg.content}
                </span>
                {msg.role === "user" && (
                  <User className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
      )}

      {/* Input row */}
      <div className="flex items-center gap-2 px-3 py-2">
        {chatMessages.length > 0 && (
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            {showHistory ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
        )}

        {!showHistory && lastAssistant && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[200px] shrink-0">
            {lastAssistant.content.slice(0, 50)}...
          </span>
        )}

        {!hasKey ? (
          /* No API key — show inline banner */
          <div className="flex items-center gap-2 flex-1 px-3 py-1 rounded-md bg-amber-500/10 border border-amber-500/20">
            <KeyRound className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-[10px] text-amber-700 dark:text-amber-300">
              请先配置 API Key — 点击右上角 <span className="font-semibold">「未配置」</span> 按钮
            </span>
          </div>
        ) : (
          <>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder={project ? "描述你想修改的内容..." : "描述你想创作的故事..."}
              className="text-xs h-8 flex-1"
              disabled={isAgentWorking}
            />

            <Button
              size="sm"
              className="h-8 px-3 shrink-0"
              onClick={handleSend}
              disabled={!input.trim() || isAgentWorking}
            >
              {isAgentWorking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
