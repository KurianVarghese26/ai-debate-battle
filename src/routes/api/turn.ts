import { createFileRoute } from "@tanstack/react-router";

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };
type Body = { model?: string; system?: string; messages?: ChatMsg[] };

export const Route = createFileRoute("/api/turn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        // Same-origin gate: this endpoint only exists to power the app UI.
        // Block cross-origin callers to prevent cost-abuse from external scripts.
        const origin = request.headers.get("origin");
        const referer = request.headers.get("referer");
        const requestHost = new URL(request.url).host;
        const originHost = (() => {
          try { return origin ? new URL(origin).host : referer ? new URL(referer).host : null; }
          catch { return null; }
        })();
        if (!originHost || originHost !== requestHost) {
          return new Response("Forbidden", { status: 403 });
        }

        // Cap raw body size before parsing (defense against huge payloads).
        const MAX_BODY_BYTES = 32 * 1024; // 32 KB
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) {
          return new Response("Payload too large", { status: 413 });
        }

        let body: Body;
        try {
          body = JSON.parse(raw) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const model = body.model?.trim();
        const messages = body.messages ?? [];
        if (!model || model.length > 128 || !Array.isArray(messages) || messages.length === 0) {
          return new Response("model and messages are required", { status: 400 });
        }

        // Bound conversation size.
        const MAX_MESSAGES = 60;
        const MAX_MSG_CHARS = 4000;
        const MAX_SYSTEM_CHARS = 4000;
        if (messages.length > MAX_MESSAGES) {
          return new Response("Too many messages", { status: 400 });
        }
        for (const m of messages) {
          if (!m || typeof m.content !== "string" || typeof m.role !== "string") {
            return new Response("Invalid message", { status: 400 });
          }
          if (m.content.length > MAX_MSG_CHARS) {
            return new Response("Message too long", { status: 400 });
          }
          if (m.role !== "system" && m.role !== "user" && m.role !== "assistant") {
            return new Response("Invalid role", { status: 400 });
          }
        }
        if (body.system && body.system.length > MAX_SYSTEM_CHARS) {
          return new Response("System prompt too long", { status: 400 });
        }

        const finalMessages: ChatMsg[] = body.system
          ? [{ role: "system", content: body.system }, ...messages]
          : messages;

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": key,
          },
          body: JSON.stringify({ model, messages: finalMessages, stream: true }),
          signal: request.signal,
        });

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => "");
          return new Response(text || "Upstream error", { status: upstream.status });
        }

        // Parse SSE from upstream and emit plain text chunks to the client.
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const reader = upstream.body.getReader();

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            let buf = "";
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                let idx;
                while ((idx = buf.indexOf("\n")) !== -1) {
                  const line = buf.slice(0, idx).trim();
                  buf = buf.slice(idx + 1);
                  if (!line.startsWith("data:")) continue;
                  const data = line.slice(5).trim();
                  if (data === "[DONE]") continue;
                  try {
                    const json = JSON.parse(data);
                    const delta = json?.choices?.[0]?.delta?.content;
                    if (typeof delta === "string" && delta.length > 0) {
                      controller.enqueue(encoder.encode(delta));
                    }
                  } catch {
                    // ignore malformed chunk
                  }
                }
              }
              controller.close();
            } catch (err) {
              controller.error(err);
            }
          },
          cancel(reason) {
            return reader.cancel(reason);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      },
    },
  },
});
