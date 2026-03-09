/**
 * DeepSeek Chat API client with streaming support.
 * Uses SSE (Server-Sent Events) for real-time token delivery.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekResponse {
  id: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

let apiKey = "";
let apiBaseUrl = "https://api.deepseek.com";
let apiModel = "deepseek-chat";

export function setDeepSeekApiKey(key: string) {
  apiKey = key;
}

export function getDeepSeekApiKey(): string {
  return apiKey;
}

export function setDeepSeekBaseUrl(url: string) {
  apiBaseUrl = url.replace(/\/+$/, ""); // strip trailing slash
}

export function getDeepSeekBaseUrl(): string {
  return apiBaseUrl;
}

export function setDeepSeekModel(model: string) {
  apiModel = model;
}

export function getDeepSeekModel(): string {
  return apiModel;
}

function getCompletionsUrl(): string {
  return `${apiBaseUrl}/chat/completions`;
}

/**
 * Streaming chat completion — yields tokens as they arrive.
 */
export async function* streamChatCompletion(
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    max_tokens?: number;
    model?: string;
  },
): AsyncGenerator<string, string, undefined> {
  if (!apiKey) throw new Error("DeepSeek API key not set");

  const res = await fetch(getCompletionsUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options?.model ?? apiModel,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.max_tokens ?? 8192,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    throw new Error(`DeepSeek API error ${res.status}: ${errText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          yield delta;
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  return fullContent;
}

/**
 * Non-streaming chat completion (for simple calls).
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    max_tokens?: number;
    model?: string;
  },
): Promise<string> {
  if (!apiKey) throw new Error("DeepSeek API key not set");

  const res = await fetch(getCompletionsUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options?.model ?? apiModel,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.max_tokens ?? 4096,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    throw new Error(`DeepSeek API error ${res.status}: ${errText}`);
  }

  const data: DeepSeekResponse = await res.json();
  return data.choices[0]?.message?.content ?? "";
}

/**
 * Parse JSON from LLM response, handling markdown code blocks and common LLM quirks.
 * Attempts multiple repair strategies for malformed JSON.
 */
export function parseJsonResponse<T>(raw: string): T {
  let cleaned = raw.trim();

  // Strip markdown code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  // Strip leading prose before first { or [
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");
  const jsonStart = firstBrace >= 0 && firstBracket >= 0
    ? Math.min(firstBrace, firstBracket)
    : Math.max(firstBrace, firstBracket);
  if (jsonStart > 0) {
    cleaned = cleaned.slice(jsonStart);
  }

  // Strip trailing prose after last } or ]
  const lastBrace = cleaned.lastIndexOf("}");
  const lastBracket = cleaned.lastIndexOf("]");
  const jsonEnd = Math.max(lastBrace, lastBracket);
  if (jsonEnd >= 0 && jsonEnd < cleaned.length - 1) {
    cleaned = cleaned.slice(0, jsonEnd + 1);
  }

  // Attempt 1: direct parse
  try {
    return JSON.parse(cleaned) as T;
  } catch (_e) {
    // continue to repair
  }

  // Attempt 2: fix truncated strings — close any unterminated string, then close brackets
  try {
    let repaired = cleaned;

    // If the string seems truncated mid-value, trim back to last complete entry
    const inString = (repaired.split('"').length - 1) % 2 !== 0;
    if (inString) {
      // Odd number of quotes = unterminated string
      // Find the last unmatched quote and close it
      const lastQuote = repaired.lastIndexOf('"');
      repaired = repaired.slice(0, lastQuote + 1);
    }

    // Close any open brackets/braces
    const opens: string[] = [];
    let inStr = false;
    let escape = false;
    for (const ch of repaired) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") opens.push("}");
      else if (ch === "[") opens.push("]");
      else if (ch === "}" || ch === "]") opens.pop();
    }

    // Remove trailing comma before closing
    repaired = repaired.replace(/,\s*$/, "");

    // Append missing closers
    while (opens.length > 0) {
      repaired += opens.pop();
    }

    return JSON.parse(repaired) as T;
  } catch (_e2) {
    // continue to next attempt
  }

  // Attempt 3: aggressive — extract first complete JSON object
  try {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }
  } catch (_e3) {
    // fall through
  }

  // All attempts failed — throw with context
  throw new Error(
    `Failed to parse JSON from LLM response. First 200 chars: ${cleaned.slice(0, 200)}...`,
  );
}
