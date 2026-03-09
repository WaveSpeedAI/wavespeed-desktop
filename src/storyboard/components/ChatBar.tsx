/**
 * ChatBar — full-height chat panel with streaming message display.
 * Replaces the old bottom-bar chat with a proper conversational UI.
 */
import { useState, useRef, useEffect } from "react";
import { useStoryboardStore } from "../stores/storyboard.store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Send,
  Loader2,
  User,
  AlertCircle,
  KeyRound,
  Sparkles,
} from "lucide-react";
import { getDeepSeekApiKey } from "../api/deepseek";

export function ChatBar() {
  const [input, setInput] = useState("");
  const chatMessages = useStoryboardStore((s) => s.chatMessages);
  const isAgentWorking = useStoryboardStore((s) => s.isAgentWorking);
  const sendMessage = useStoryboardStore((s) => s.sendMessage);
  const project = useStoryboardStore((s) => s.project);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages or streaming updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [input]);

  const handleSend = async () => {
    if (!input.trim() || isAgentWorking) return;
    if (!getDeepSeekApiKey()) return;
    const msg = input.trim();
    setInput("");
    await sendMessage(msg);
  };

  const hasKey = getDeepSeekApiKey().length > 0;
  const isEmpty = chatMessages.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4">
          {isEmpty && (
            <EmptyState onQuickStart={(text) => {
              if (!hasKey || isAgentWorking) return;
              setInput("");
              sendMessage(text);
            }} />
          )}

          {chatMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t bg-card/80 backdrop-blur p-3 shrink-0">
        {!hasKey ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <KeyRound className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-xs text-amber-700 dark:text-amber-300">
              请先配置 API Key — 点击右上角「LLM」按钮
            </span>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={project ? "描述你想修改的内容..." : "描述你想创作的视频故事..."}
              className={cn(
                "flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm",
                "placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30",
                "min-h-[40px] max-h-[120px]",
              )}
              disabled={isAgentWorking}
              rows={1}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isAgentWorking}
              className={cn(
                "shrink-0 h-10 w-10 rounded-lg flex items-center justify-center transition-all",
                input.trim() && !isAgentWorking
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                  : "bg-muted text-muted-foreground/40 cursor-not-allowed",
              )}
            >
              {isAgentWorking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Message Bubble ────────────────────────────────────── */

function MessageBubble({ message }: { message: ReturnType<typeof useStoryboardStore.getState>["chatMessages"][0] }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div className={cn("flex gap-2.5", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className={cn(
          "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5",
          isSystem ? "bg-muted" : "bg-primary/10",
        )}>
          {isSystem ? (
            <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          )}
        </div>
      )}

      <div className={cn(
        "rounded-xl px-3.5 py-2.5 max-w-[85%] text-sm leading-relaxed",
        isUser
          ? "bg-primary text-primary-foreground rounded-br-sm"
          : isSystem
            ? "bg-muted/50 text-muted-foreground italic rounded-bl-sm"
            : "bg-card border rounded-bl-sm shadow-sm",
      )}>
        <div className="whitespace-pre-wrap break-words">
          {message.content}
          {message.isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-primary animate-pulse ml-0.5 align-middle rounded-sm" />
          )}
        </div>
      </div>

      {isUser && (
        <div className="shrink-0 w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center mt-0.5">
          <User className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
    </div>
  );
}

/* ── Empty State ───────────────────────────────────────── */

function EmptyState({ onQuickStart }: { onQuickStart: (text: string) => void }) {
  const examples = [
    { emoji: "🎬", text: "一个赛博朋克城市的追逐戏" },
    { emoji: "🌊", text: "海边日落的浪漫故事" },
    { emoji: "⚔️", text: "火影忍者佩恩大战黑崎一护，14秒" },
  ];

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="w-16 h-16 rounded-2xl bg-primary/5 border border-primary/20 flex items-center justify-center mb-5">
        <Sparkles className="h-7 w-7 text-primary/40" />
      </div>
      <h2 className="text-base font-semibold mb-1.5">开始创作你的故事</h2>
      <p className="text-sm text-muted-foreground text-center mb-6 max-w-xs leading-relaxed">
        描述你想要的视频，AI 会自动生成角色、场景和分镜
      </p>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        {examples.map((ex) => (
          <button
            key={ex.text}
            onClick={() => onQuickStart(ex.text)}
            className={cn(
              "flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-left",
              "bg-card/50 hover:bg-card hover:border-primary/30 hover:shadow-sm",
              "transition-all text-sm text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="text-base">{ex.emoji}</span>
            <span className="truncate">{ex.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
