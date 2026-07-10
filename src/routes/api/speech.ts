import { createFileRoute } from "@tanstack/react-router";

type Body = { text?: string; lang?: string; speed?: number; stream?: boolean };

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const speechHits = new Map<string, { count: number; resetAt: number }>();

const supportedLangNames: Record<string, string> = {
  "en-US": "English",
  "en-GB": "British English",
  "en-IN": "Indian English",
  "ml-IN": "Malayalam",
  "hi-IN": "Hindi",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
  "es-ES": "Spanish",
  "fr-FR": "French",
  "de-DE": "German",
  "it-IT": "Italian",
  "pt-BR": "Portuguese",
  "ja-JP": "Japanese",
  "ko-KR": "Korean",
  "zh-CN": "Chinese",
  "ar-SA": "Arabic",
  "ru-RU": "Russian",
};

function sameOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "same-origin" || fetchSite === "same-site") return true;
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const requestHost = new URL(request.url).host;
  const originHost = (() => {
    try {
      return origin ? new URL(origin).host : referer ? new URL(referer).host : null;
    } catch {
      return null;
    }
  })();
  if (!originHost) return false;
  if (originHost === requestHost) return true;

  const originProject = originHost.endsWith(".lovableproject.com")
    ? originHost.slice(0, -".lovableproject.com".length)
    : null;
  return !!originProject && requestHost.endsWith(".lovable.app") && requestHost.includes(originProject);
}

function rateLimit(request: Request) {
  const now = Date.now();
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const current = speechHits.get(ip);
  if (!current || current.resetAt <= now) {
    speechHits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_WINDOW;
}

export const Route = createFileRoute("/api/speech")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
        if (rateLimit(request)) return new Response("Too many read-aloud requests", { status: 429 });

        const raw = await request.text();
        if (raw.length > 16 * 1024) return new Response("Payload too large", { status: 413 });

        let body: Body;
        try {
          body = JSON.parse(raw) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const text = body.text?.trim();
        const lang = body.lang && supportedLangNames[body.lang] ? body.lang : "en-US";
        const speed = typeof body.speed === "number" && Number.isFinite(body.speed)
          ? Math.min(2, Math.max(0.5, body.speed))
          : 1.2;

        if (!text) return new Response("Text is required", { status: 400 });
        if (text.length > 4000) return new Response("Text too long", { status: 400 });

        const wantsStream = body.stream !== false;
        try {
          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "openai/gpt-4o-mini-tts",
              input: text,
              voice: "alloy",
              response_format: wantsStream ? "pcm" : "mp3",
              stream_format: wantsStream ? "sse" : "audio",
              speed,
              instructions: `Read this text naturally in ${supportedLangNames[lang]}. Preserve the language and pronunciation of the supplied text. Speak smoothly with a clear, energetic Gemini-style pace, natural pauses, and a warm conversational tone.`,
            }),
            signal: request.signal,
          });

          if (!upstream.ok || !upstream.body) {
            const message = await upstream.text().catch(() => "");
            return new Response(message || "Text-to-speech failed", { status: upstream.status });
          }

          return new Response(upstream.body, {
            headers: {
              "Content-Type":
                upstream.headers.get("content-type") ||
                (wantsStream ? "text/event-stream" : "audio/mpeg"),
              "Cache-Control": "no-store",
            },
          });
        } catch (error) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          console.error(error);
          return new Response("Text-to-speech failed", { status: 500 });
        }
      },
    },
  },
});