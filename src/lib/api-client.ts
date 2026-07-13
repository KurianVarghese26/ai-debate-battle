import type { ApiProvider } from "./models";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

interface StreamOptions {
  provider: ApiProvider;
  apiKey: string;
  model: string;
  system?: string;
  messages: ChatMsg[];
  onChunk: (text: string) => void;
  signal: AbortSignal;
}

export async function streamChatCompletion(opts: StreamOptions): Promise<string> {
  const { provider, apiKey, model, system, messages, onChunk, signal } = opts;

  let url = "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (provider === "gemini") {
    url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else if (provider === "openai") {
    url = "https://api.openai.com/v1/chat/completions";
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else if (provider === "openrouter") {
    url = "https://openrouter.ai/api/v1/chat/completions";
    headers["Authorization"] = `Bearer ${apiKey}`;
    // OpenRouter requires these headers for rankings
    headers["HTTP-Referer"] = typeof window !== "undefined" ? window.location.origin : "https://github.com/KurianVarghese26/ai-debate-battle";
    headers["X-Title"] = "AI Debate Battle Arena";
  } else {
    throw new Error(`Unsupported direct provider: ${provider}`);
  }

  const finalMessages: ChatMsg[] = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: finalMessages,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    let errText = "";
    try {
      errText = await response.text();
    } catch {
      // ignore
    }
    throw new Error(errText || `API error (${response.status}: ${response.statusText})`);
  }

  if (!response.body) {
    throw new Error("Response body is not readable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    
    // Split by newlines to process SSE events
    const lines = buffer.split("\n");
    // Keep the last incomplete line in the buffer
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === "[DONE]") continue;

      try {
        const json = JSON.parse(dataStr);
        const chunk = json.choices?.[0]?.delta?.content || "";
        if (chunk) {
          fullText += chunk;
          onChunk(fullText);
        }
      } catch {
        // Ignore JSON parse errors for partial or malformed lines
      }
    }
  }

  return fullText;
}
