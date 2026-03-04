/**
 * LLM Settings — configurable API key, base URL, and model for the AI agent.
 *
 * UX flow:
 * 1. No key → TopBar shows red dot + "未配置", ChatBar is blocked
 * 2. User opens panel → fills in key → clicks save
 * 3. Save validates the key with a lightweight API call
 * 4. Success → green feedback + auto-close | Failure → red error message
 * 5. Key persisted to localStorage, restored on page load
 */
import { useState, useCallback } from "react";
import { useStoryboardStore } from "../stores/storyboard.store";
import {
  getDeepSeekApiKey,
  getDeepSeekBaseUrl,
  getDeepSeekModel,
} from "../api/deepseek";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Check,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const STORAGE_KEY_LLM = "storyboard_llm_config";

const PRESETS = [
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  { label: "自定义", baseUrl: "", model: "" },
];

type SaveState = "idle" | "validating" | "success" | "error";

/** Check if a usable API key is currently configured */
export function hasApiKey(): boolean {
  return getDeepSeekApiKey().length > 0;
}

export function LlmSettings() {
  const setLlmConfig = useStoryboardStore((s) => s.setLlmConfig);
  const [isOpen, setIsOpen] = useState(false);
  const [apiKey, setApiKey] = useState(getDeepSeekApiKey());
  const [baseUrl, setBaseUrl] = useState(getDeepSeekBaseUrl());
  const [model, setModel] = useState(getDeepSeekModel());
  const [showKey, setShowKey] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const configured = hasApiKey();

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) {
      setSaveState("error");
      setErrorMsg("请输入 API Key");
      return;
    }

    setSaveState("validating");
    setErrorMsg("");

    // Apply config immediately so the validation call uses it
    setLlmConfig({ apiKey: apiKey.trim(), baseUrl, model });

    try {
      // Lightweight validation: send a tiny request to check auth
      const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: model || "deepseek-chat",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
          stream: false,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 401 || res.status === 403) {
          throw new Error("API Key 无效或已过期");
        }
        if (res.status === 429) {
          // Rate limited but key is valid
          // fall through to success
        } else {
          throw new Error(`API 返回 ${res.status}: ${text.slice(0, 100)}`);
        }
      }

      // Persist to localStorage
      try {
        localStorage.setItem(
          STORAGE_KEY_LLM,
          JSON.stringify({ apiKey: apiKey.trim(), baseUrl, model }),
        );
      } catch { /* quota exceeded */ }

      setSaveState("success");
      // Auto-close after success
      setTimeout(() => {
        setIsOpen(false);
        setSaveState("idle");
      }, 1200);
    } catch (err: any) {
      setSaveState("error");
      setErrorMsg(err.message || "连接失败");
      // Revert config on failure
      const prev = getDeepSeekApiKey();
      if (!prev) setLlmConfig({ apiKey: "" });
    }
  }, [apiKey, baseUrl, model, setLlmConfig]);

  const handlePreset = (preset: (typeof PRESETS)[number]) => {
    if (preset.baseUrl) setBaseUrl(preset.baseUrl);
    if (preset.model) setModel(preset.model);
  };

  // Mask key for display: show first 5 and last 4 chars
  const maskedKey = apiKey.length > 12
    ? `${apiKey.slice(0, 5)}${"•".repeat(Math.min(apiKey.length - 9, 20))}${apiKey.slice(-4)}`
    : apiKey;

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-7 text-[10px] px-2 gap-1",
          !configured && "text-destructive hover:text-destructive",
        )}
        onClick={() => {
          setIsOpen(!isOpen);
          // Refresh state when opening
          if (!isOpen) {
            setApiKey(getDeepSeekApiKey());
            setBaseUrl(getDeepSeekBaseUrl());
            setModel(getDeepSeekModel());
            setSaveState("idle");
            setErrorMsg("");
          }
        }}
      >
        {!configured && (
          <CircleDot className="h-2.5 w-2.5 text-destructive fill-destructive animate-pulse" />
        )}
        <Brain className="h-3 w-3" />
        {configured ? "LLM" : "未配置"}
        {isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
      </Button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 z-50 w-80 rounded-lg border bg-popover p-3 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">LLM 配置</span>
            <span className="text-[9px] text-muted-foreground">
              OpenAI 兼容接口
            </span>
          </div>

          {/* Presets */}
          <div className="flex gap-1 flex-wrap">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => handlePreset(p)}
                className="text-[9px] px-1.5 py-0.5 rounded border border-border/50 hover:bg-muted transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Base URL */}
          <div className="space-y-1">
            <Label className="text-[10px]">API Base URL</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com"
              className="text-[10px] h-7"
            />
          </div>

          {/* Model */}
          <div className="space-y-1">
            <Label className="text-[10px]">模型名称</Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="deepseek-chat"
              className="text-[10px] h-7"
            />
          </div>

          {/* API Key with show/hide toggle */}
          <div className="space-y-1">
            <Label className="text-[10px]">API Key</Label>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  if (saveState !== "idle") setSaveState("idle");
                }}
                placeholder="sk-..."
                className="text-[10px] h-7 font-mono pr-8"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                title={showKey ? "隐藏" : "显示"}
              >
                {showKey ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
              </button>
            </div>
            {/* Show masked key below when hidden, so user knows something is there */}
            {apiKey && !showKey && (
              <p className="text-[9px] text-muted-foreground font-mono">
                {maskedKey}
              </p>
            )}
          </div>

          {/* Save button with validation states */}
          <Button
            size="sm"
            className={cn(
              "w-full h-7 text-[10px] transition-colors",
              saveState === "success" &&
                "bg-emerald-600 hover:bg-emerald-600 text-white",
              saveState === "error" &&
                "bg-destructive hover:bg-destructive text-destructive-foreground",
            )}
            onClick={handleSave}
            disabled={saveState === "validating"}
          >
            {saveState === "validating" && (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                验证连接中...
              </>
            )}
            {saveState === "success" && (
              <>
                <Check className="h-3 w-3 mr-1" />
                连接成功 ✓
              </>
            )}
            {saveState === "error" && (
              <>
                <AlertCircle className="h-3 w-3 mr-1" />
                保存并重试
              </>
            )}
            {saveState === "idle" && (
              apiKey.trim() ? "保存并验证" : "请输入 API Key"
            )}
          </Button>

          {/* Error message */}
          {saveState === "error" && errorMsg && (
            <div className="text-[9px] text-destructive bg-destructive/10 rounded px-2 py-1.5 flex items-start gap-1">
              <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Success message */}
          {saveState === "success" && (
            <div className="text-[9px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded px-2 py-1.5 flex items-center gap-1">
              <Check className="h-3 w-3 shrink-0" />
              <span>API Key 有效，配置已保存到本地</span>
            </div>
          )}

          <div className="text-[9px] text-muted-foreground leading-relaxed">
            支持所有 OpenAI 兼容接口：DeepSeek、SiliconFlow、OpenRouter、本地
            Ollama 等。配置保存在浏览器本地，不会上传。
          </div>
        </div>
      )}
    </div>
  );
}
