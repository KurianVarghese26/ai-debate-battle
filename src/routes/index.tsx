import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Square, RotateCcw, Trash2, History, Volume2, VolumeX, Gauge, Volume1, StopCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

import { DEFAULT_MODEL, MODELS } from "@/lib/models";
import { useLocalStorage } from "@/lib/storage";
import { streamSpeech, type SpeechHandle } from "@/lib/tts";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";

export const Route = createFileRoute("/")({
  component: ArenaRoot,
});

function ArenaRoot() {
  return (
    <ThemeProvider>
      <Arena />
    </ThemeProvider>
  );
}

type SideKey = "A" | "B";
type SideConfig = { name: string; model: string; persona: string };
type Turn = { side: SideKey; text: string; model: string; name: string };
type SavedDebate = {
  id: string;
  topic: string;
  sideA: SideConfig;
  sideB: SideConfig;
  turns: Turn[];
  createdAt: number;
};

const DEFAULT_A: SideConfig = {
  name: "Aria",
  model: DEFAULT_MODEL,
  persona: "A sharp, evidence-driven optimist. Concise, witty, cites reasoning.",
};
const DEFAULT_B: SideConfig = {
  name: "Kairo",
  model: "openai/gpt-5-mini",
  persona: "A skeptical contrarian. Blunt, dry humor, pokes holes in every claim.",
};

const READ_LANGS: { code: string; label: string }[] = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-IN", label: "English (IN)" },
  { code: "ml-IN", label: "Malayalam" },
  { code: "hi-IN", label: "Hindi" },
  { code: "ta-IN", label: "Tamil" },
  { code: "te-IN", label: "Telugu" },
  { code: "es-ES", label: "Spanish" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "it-IT", label: "Italian" },
  { code: "pt-BR", label: "Portuguese" },
  { code: "ja-JP", label: "Japanese" },
  { code: "ko-KR", label: "Korean" },
  { code: "zh-CN", label: "Chinese" },
  { code: "ar-SA", label: "Arabic" },
  { code: "ru-RU", label: "Russian" },
];

const READ_STOP_EVENT = "duel-of-minds-stop-reading";

function buildSystem(self: SideConfig, other: SideConfig, topic: string) {
  return `You are ${self.name}, one of two AI debaters in a live back-and-forth.

Your character/personality: ${self.persona}

You are debating ${other.name} (personality: ${other.persona}).

The topic / content under discussion:
"""
${topic}
"""

Rules:
- Stay strictly in character.
- Keep each turn short: 2–5 sentences, punchy.
- Directly engage with the OTHER debater's last point when there is one.
- Do NOT prefix your reply with your name or any label. Just speak.
- No stage directions, no asterisks, no meta commentary.`;
}

function Arena() {
  const { theme } = useTheme();
  const [sideA, setSideA] = useLocalStorage<SideConfig>("dom.sideA", DEFAULT_A);
  const [sideB, setSideB] = useLocalStorage<SideConfig>("dom.sideB", DEFAULT_B);
  const [topic, setTopic] = useLocalStorage<string>(
    "dom.topic",
    "Is remote work better for creative teams than being in the same room?",
  );
  const [history, setHistory] = useLocalStorage<SavedDebate[]>("dom.history", []);
  const [pause, setPause] = useLocalStorage<number>("dom.pause", 1.5);
  const [autoRead, setAutoRead] = useLocalStorage<boolean>("dom.autoRead", false);
  const [readLang, setReadLang] = useLocalStorage<string>("dom.readLang", "en-US");

  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState<{ side: SideKey; text: string } | null>(null);
  const [running, setRunning] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const speechHandleRef = useRef<SpeechHandle | null>(null);
  const pauseRef = useRef(pause);
  const autoReadRef = useRef(autoRead);
  const readLangRef = useRef(readLang);
  useEffect(() => { pauseRef.current = pause; }, [pause]);
  useEffect(() => { autoReadRef.current = autoRead; }, [autoRead]);
  useEffect(() => { readLangRef.current = readLang; }, [readLang]);

  const ensureAudioCtx = useCallback(() => {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new AC({ sampleRate: 24000 });
      if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  const readTurnAloud = useCallback(async (text: string) => {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    speechHandleRef.current?.stop();
    try {
      const handle = await streamSpeech({ text, lang: readLangRef.current, ctx });
      speechHandleRef.current = handle;
      await handle.done;
      if (speechHandleRef.current === handle) speechHandleRef.current = null;
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast.error("Read-aloud failed.");
    }
  }, [ensureAudioCtx]);

  const savedRef = useRef(false);
  useEffect(() => {
    if (running) {
      savedRef.current = false;
      return;
    }
    if (savedRef.current) return;
    if (turns.length < 2) return;
    savedRef.current = true;
    const entry: SavedDebate = {
      id: crypto.randomUUID(),
      topic,
      sideA,
      sideB,
      turns,
      createdAt: Date.now(),
    };
    setHistory((prev) => [entry, ...prev].slice(0, 50));
  }, [running, turns, topic, sideA, sideB, setHistory]);

  const stickToBottomRef = useRef(true);
  const onTranscriptScroll = useCallback(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 80;
  }, []);
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [turns, streaming]);

  const runTurn = useCallback(
    async (nextSide: SideKey, priorTurns: Turn[]): Promise<Turn | null> => {
      const self = nextSide === "A" ? sideA : sideB;
      const other = nextSide === "A" ? sideB : sideA;
      const system = buildSystem(self, other, topic);

      const messages: { role: "user" | "assistant"; content: string }[] = [];
      if (priorTurns.length === 0) {
        messages.push({
          role: "user",
          content: `Open the debate. Give your first take on the topic in 2–4 sentences.`,
        });
      } else {
        for (const t of priorTurns) {
          messages.push({
            role: t.side === nextSide ? "assistant" : "user",
            content: t.text,
          });
        }
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming({ side: nextSide, text: "" });

      let full = "";
      try {
        const res = await fetch("/api/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: self.model, system, messages }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => "");
          if (res.status === 402) toast.error("AI credits exhausted. Add credits in workspace settings.");
          else if (res.status === 429) toast.error("Rate limited. Slow down and try again.");
          else toast.error(errText || `Request failed (${res.status})`);
          return null;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += dec.decode(value, { stream: true });
          setStreaming({ side: nextSide, text: full });
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // preserve partial
        } else {
          console.error(err);
          toast.error("Stream error");
        }
      } finally {
        abortRef.current = null;
        setStreaming(null);
      }

      const text = full.trim();
      if (!text) return null;
      return { side: nextSide, text, model: self.model, name: self.name };
    },
    [sideA, sideB, topic],
  );

  const start = useCallback(async () => {
    if (running) return;
    if (!topic.trim()) {
      toast.error("Add a topic first.");
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
    } catch {
      // ignore
    }
    stopRequestedRef.current = false;
    setRunning(true);
    setTurns([]);

    let priorTurns: Turn[] = [];
    let nextSide: SideKey = "A";

    while (!stopRequestedRef.current) {
      const t = await runTurn(nextSide, priorTurns);
      if (!t) break;
      priorTurns = [...priorTurns, t];
      setTurns(priorTurns);
      if (autoReadRef.current) {
        await readTurnAloud(t.text);
        if (stopRequestedRef.current) break;
      }
      nextSide = nextSide === "A" ? "B" : "A";
      const delay = Math.max(0, Math.round(pauseRef.current * 1000));
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (priorTurns.length >= 40) break;
    }

    setRunning(false);
  }, [running, runTurn, topic, readTurnAloud]);

  const stop = useCallback(() => {
    stopRequestedRef.current = true;
    abortRef.current?.abort();
    speechHandleRef.current?.stop();
    speechHandleRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stop();
    setTurns([]);
    setStreaming(null);
    savedRef.current = true;
  }, [stop]);

  const loadDebate = (d: SavedDebate) => {
    stop();
    setSideA(d.sideA);
    setSideB(d.sideB);
    setTopic(d.topic);
    setTurns(d.turns);
    savedRef.current = true;
  };

  const deleteDebate = (id: string) => {
    setHistory((prev) => prev.filter((d) => d.id !== id));
  };

  const clearHistory = () => setHistory([]);

  const liveTurns = useMemo(() => {
    if (!streaming) return turns;
    const self = streaming.side === "A" ? sideA : sideB;
    return [
      ...turns,
      { side: streaming.side, text: streaming.text, model: self.model, name: self.name },
    ];
  }, [turns, streaming, sideA, sideB]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster theme={theme} />
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md border border-border bg-card">
              <span className="font-display text-sm font-bold tracking-tight">D</span>
            </div>
            <div>
              <h1 className="font-display text-lg font-semibold leading-none tracking-tight">Duel of Minds</h1>
              <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">AI vs AI · Debate Arena</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <History className="h-4 w-4" /> History
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle className="font-display">Past debates</SheetTitle>
                </SheetHeader>
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{history.length} saved</p>
                  {history.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={clearHistory} className="text-muted-foreground">
                      Clear all
                    </Button>
                  )}
                </div>
                <ScrollArea className="mt-2 h-[calc(100vh-140px)] pr-2">
                  <div className="space-y-2">
                    {history.length === 0 && (
                      <p className="text-sm text-muted-foreground">No debates yet. Start one!</p>
                    )}
                    {history.map((d) => (
                      <div key={d.id} className="rounded-md border border-border bg-card p-3">
                        <button onClick={() => loadDebate(d)} className="block w-full text-left">
                          <p className="line-clamp-2 text-sm font-medium">{d.topic || "(no topic)"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {d.sideA.name} vs {d.sideB.name} · {d.turns.length} turns ·{" "}
                            {new Date(d.createdAt).toLocaleDateString()}
                          </p>
                        </button>
                        <div className="mt-2 flex justify-end">
                          <Button variant="ghost" size="sm" onClick={() => deleteDebate(d.id)} className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3 w-3" /> Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <section className="mb-10 max-w-3xl">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Issue No. 01</p>
          <h2 className="mt-3 font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Two minds. One topic. <span className="text-muted-foreground">A live argument.</span>
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Configure each side, drop in the subject, and watch the exchange unfold — with optional read-aloud in your language.
          </p>
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <SideCard label="Left" config={sideA} onChange={setSideA} disabled={running} />
          <SideCard label="Right" config={sideB} onChange={setSideB} disabled={running} />
        </div>

        <div className="mt-6 rounded-lg border border-border bg-card p-5">
          <Label htmlFor="topic" className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            The Motion
          </Label>
          <Textarea
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={running}
            rows={3}
            className="mt-2 resize-none border-border bg-background"
            placeholder="Paste an article, a claim, a question, or anything else…"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {!running ? (
              <Button onClick={start} className="gap-2">
                <Play className="h-4 w-4" /> Start debate
              </Button>
            ) : (
              <Button onClick={stop} variant="destructive" className="gap-2">
                <Square className="h-4 w-4" /> Stop
              </Button>
            )}
            <Button onClick={reset} variant="ghost" className="gap-2" disabled={running}>
              <RotateCcw className="h-4 w-4" /> Clear
            </Button>
            {running && (
              <span className="ml-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground opacity-40" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-foreground" />
                </span>
                In session
              </span>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-5">
              <button
                type="button"
                onClick={() => {
                  const next = !autoRead;
                  setAutoRead(next);
                  if (next) {
                    ensureAudioCtx();
                    toast.success("Read aloud enabled — new replies will be spoken.");
                  } else {
                    speechHandleRef.current?.stop();
                    speechHandleRef.current = null;
                  }
                }}
                className={`grid h-9 w-9 place-items-center rounded-md border transition-colors ${
                  autoRead
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground/70 hover:text-foreground"
                }`}
                aria-label={autoRead ? "Turn off read aloud" : "Read aloud all replies"}
                title={autoRead ? "Read aloud: on" : "Read aloud all replies"}
              >
                {autoRead ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
              <div className="flex min-w-[220px] items-center gap-2">
                <Gauge className="h-4 w-4 text-muted-foreground" />
                <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Pause</span>
                <Slider
                  value={[pause]}
                  min={0}
                  max={15}
                  step={0.5}
                  onValueChange={(v) => setPause(v[0] ?? 1.5)}
                  className="w-36"
                />
                <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{pause.toFixed(1)}s</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Voice</span>
                <Select value={readLang} onValueChange={setReadLang}>
                  <SelectTrigger className="h-9 w-[150px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {READ_LANGS.map((l) => (
                      <SelectItem key={l.code} value={l.code} className="text-xs">
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <section className="mt-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="font-display text-sm font-semibold uppercase tracking-[0.18em]">The Exchange</h3>
            <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{turns.length} {turns.length === 1 ? "turn" : "turns"}</span>
          </div>
          <div
            ref={transcriptRef}
            onScroll={onTranscriptScroll}
            className="h-[60vh] space-y-6 overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-6"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {liveTurns.length === 0 && (
              <div className="py-20 text-center text-sm text-muted-foreground">
                Configure both sides, add a topic, and press <span className="text-foreground">Start debate</span>.
              </div>
            )}
            {liveTurns.map((t, i) => (
              <TurnBubble key={i} turn={t} readLang={readLang} />
            ))}
          </div>
        </section>
      </main>
      <footer className="mx-auto max-w-6xl border-t border-border px-6 py-8 text-center text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        Powered by Lovable AI · Choose any model per side
      </footer>
    </div>
  );
}

function SideCard({
  label,
  config,
  onChange,
  disabled,
}: {
  label: string;
  config: SideConfig;
  onChange: (c: SideConfig) => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <span className="font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{label}</span>
        <span className="font-display text-xs italic text-muted-foreground">{config.name || "—"}</span>
      </div>
      <div className="mt-4 grid gap-4">
        <div>
          <Label className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Display name</Label>
          <Input
            value={config.name}
            disabled={disabled}
            onChange={(e) => onChange({ ...config, name: e.target.value })}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Model</Label>
          <Select
            value={config.model}
            disabled={disabled}
            onValueChange={(v) => onChange({ ...config, model: v })}
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  <span className="flex flex-col">
                    <span>{m.label}</span>
                    {m.hint && <span className="text-xs text-muted-foreground">{m.hint}</span>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Character</Label>
          <Textarea
            value={config.persona}
            disabled={disabled}
            onChange={(e) => onChange({ ...config, persona: e.target.value })}
            rows={3}
            className="mt-1 resize-none"
            placeholder="e.g. sarcastic economist who loves puns"
          />
        </div>
      </div>
    </div>
  );
}

function TurnBubble({ turn, readLang }: { turn: Turn; readLang: string }) {
  const isA = turn.side === "A";
  const modelLabel = MODELS.find((m) => m.id === turn.model)?.label ?? turn.model;
  const [speaking, setSpeaking] = useState(false);
  const handleRef = useRef<SpeechHandle | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const stopReading = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setSpeaking(false);
  }, []);

  useEffect(() => {
    const handler = () => stopReading();
    window.addEventListener(READ_STOP_EVENT, handler);
    return () => {
      window.removeEventListener(READ_STOP_EVENT, handler);
      stopReading();
    };
  }, [stopReading]);

  const toggleSpeak = async () => {
    if (typeof window === "undefined") return;
    if (speaking) {
      stopReading();
      return;
    }
    window.dispatchEvent(new Event(READ_STOP_EVENT));
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!ctxRef.current) ctxRef.current = new AC({ sampleRate: 24000 });
      const ctx = ctxRef.current;
      setSpeaking(true);
      const handle = await streamSpeech({ text: turn.text, lang: readLang, ctx });
      handleRef.current = handle;
      await handle.done;
      if (handleRef.current === handle) handleRef.current = null;
      setSpeaking(false);
    } catch (err) {
      setSpeaking(false);
      if ((err as Error).name !== "AbortError") {
        toast.error((err as Error).message || "Text-to-speech failed.");
      }
    }
  };

  return (
    <article className="border-l-2 border-border pl-5">
      <header className="mb-2 flex items-center gap-3">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {isA ? "Left" : "Right"}
        </span>
        <span className="h-px flex-1 bg-border" />
        <span className="font-display text-sm font-semibold tracking-tight">{turn.name}</span>
        <span className="text-[11px] text-muted-foreground">{modelLabel}</span>
        <button
          type="button"
          onClick={toggleSpeak}
          aria-label={speaking ? "Stop reading" : "Read aloud"}
          title={speaking ? "Stop reading" : "Read aloud"}
          className="grid h-7 w-7 place-items-center rounded-md border border-border bg-background text-foreground/70 transition-colors hover:text-foreground"
        >
          {speaking ? <StopCircle className="h-3.5 w-3.5" /> : <Volume1 className="h-3.5 w-3.5" />}
        </button>
      </header>
      <p className="whitespace-pre-wrap text-[15px] leading-[1.7] text-foreground">{turn.text}</p>
    </article>
  );
}
