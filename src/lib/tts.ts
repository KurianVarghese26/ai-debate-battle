// Streaming TTS player. Requests SSE PCM from /api/speech and schedules
// audio chunks on an AudioContext so playback starts as soon as the first
// bytes arrive (Gemini-style low latency).

export type SpeechHandle = {
  stop: () => void;
  done: Promise<void>;
};

type StartOpts = {
  text: string;
  lang: string;
  speed?: number;
  ctx: AudioContext;
  signal?: AbortSignal;
};

export async function streamSpeech(opts: StartOpts): Promise<SpeechHandle> {
  const { text, lang, speed = 1, ctx, signal } = opts;

  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch { /* ignore */ }
  }

  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener("abort", onOuterAbort);

  const scheduled: AudioBufferSourceNode[] = [];
  let playhead = 0;
  let pending = new Uint8Array(0);
  let stopped = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => { resolveDone = r; });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    for (const src of scheduled) {
      try { src.stop(); } catch { /* ignore */ }
    }
    scheduled.length = 0;
    signal?.removeEventListener("abort", onOuterAbort);
    resolveDone();
  };

  const schedulePcm = (incoming: Uint8Array) => {
    if (stopped) return;
    const bytes = new Uint8Array(pending.length + incoming.length);
    bytes.set(pending);
    bytes.set(incoming, pending.length);
    const usable = bytes.length - (bytes.length % 2);
    pending = bytes.slice(usable);
    if (usable === 0) return;
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, usable / 2);
    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) floats[i] = samples[i] / 32768;
    const buffer = ctx.createBuffer(1, floats.length, 24000);
    buffer.copyToChannel(floats, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const start = playhead === 0
      ? ctx.currentTime + 0.05
      : Math.max(playhead, ctx.currentTime);
    src.start(start);
    playhead = start + buffer.duration;
    scheduled.push(src);
    src.onended = () => {
      const i = scheduled.indexOf(src);
      if (i >= 0) scheduled.splice(i, 1);
    };
  };

  (async () => {
    try {
      const res = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang, speed, stream: true }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `Text-to-speech failed (${res.status})`);
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let sseBuf = "";
      while (!stopped) {
        const { value, done: rdone } = await reader.read();
        if (rdone) break;
        sseBuf += value;
        let idx;
        while ((idx = sseBuf.indexOf("\n\n")) !== -1) {
          const rawEvent = sseBuf.slice(0, idx);
          sseBuf = sseBuf.slice(idx + 2);
          const dataLines = rawEvent
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim());
          if (!dataLines.length) continue;
          const data = dataLines.join("");
          if (data === "[DONE]") continue;
          let payload: { type?: string; audio?: string };
          try { payload = JSON.parse(data); } catch { continue; }
          if (payload.type === "speech.audio.delta" && payload.audio) {
            const binary = atob(payload.audio);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            schedulePcm(bytes);
          }
        }
      }

      // Wait for the last scheduled chunk to finish before resolving.
      const wait = Math.max(0, playhead - ctx.currentTime);
      setTimeout(() => {
        if (!stopped) {
          stopped = true;
          signal?.removeEventListener("abort", onOuterAbort);
          resolveDone();
        }
      }, wait * 1000 + 50);
    } catch (err) {
      if (!stopped) {
        stopped = true;
        signal?.removeEventListener("abort", onOuterAbort);
        resolveDone();
      }
      if ((err as Error).name !== "AbortError") throw err;
    }
  })().catch((err) => {
    console.error("streamSpeech error", err);
  });

  return { stop, done };
}
