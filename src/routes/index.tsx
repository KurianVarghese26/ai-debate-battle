import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Square, RotateCcw, Trash2, History, Swords, Volume2, VolumeX, Gauge, Volume1, StopCircle } from "lucide-react";

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

export const Route = createFileRoute("/")({
  component: Arena,
});

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

function stopBrowserSpeech() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

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
  const [sideA, setSideA] = useLocalStorage<SideConfig>("dom.sideA", DEFAULT_A);
  const [sideB, setSideB] = useLocalStorage<SideConfig>("dom.sideB", DEFAULT_B);
  const [topic, setTopic] = useLocalStorage<string>(
    "dom.topic",
    "Is remote work better for creative teams than being in the same room?",
  );
  const [history, setHistory] = useLocalStorage<SavedDebate[]>("dom.history", []);
  // Pause (seconds) between replies so you have time to read.
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
    // Auto-save the debate to history once it has content and stops running.
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

      // Map turns into chat messages from `self`'s POV:
      // self's past turns => assistant, other's turns => user.
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
    // Prime AudioContext inside the user gesture — browsers block audio otherwise.
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
    } catch {
      // ignore — sound will just be off
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
      // Auto-read the reply aloud, then pause. Skip pause if reading was long.
      if (autoReadRef.current) {
        await readTurnAloud(t.text);
        if (stopRequestedRef.current) break;
      }
      nextSide = nextSide === "A" ? "B" : "A";
      const delay = Math.max(0, Math.round(pauseRef.current * 1000));
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (priorTurns.length >= 40) break; // hard safety cap
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
    savedRef.current = true; // don't auto-save empty
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
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <Toaster theme="dark" richColors />
      <header className="border-b border-white/5 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-cyan-400 text-slate-950">
              <Swords className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Duel of Minds</h1>
              <p className="text-xs text-slate-400">Two AIs. One topic. Live debate.</p>
            </div>
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="secondary" size="sm" className="gap-2">
                <History className="h-4 w-4" /> History
              </Button>
            </SheetTrigger>
            <SheetContent className="bg-slate-950 text-slate-100 border-white/10">
              <SheetHeader>
                <SheetTitle className="text-slate-100">Past debates</SheetTitle>
              </SheetHeader>
              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-slate-400">{history.length} saved</p>
                {history.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearHistory} className="text-slate-400 hover:text-slate-100">
                    Clear all
                  </Button>
                )}
              </div>
              <ScrollArea className="mt-2 h-[calc(100vh-140px)] pr-2">
                <div className="space-y-2">
                  {history.length === 0 && (
                    <p className="text-sm text-slate-500">No debates yet. Start one!</p>
                  )}
                  {history.map((d) => (
                    <div
                      key={d.id}
                      className="rounded-lg border border-white/10 bg-white/5 p-3"
                    >
                      <button
                        onClick={() => loadDebate(d)}
                        className="block w-full text-left"
                      >
                        <p className="line-clamp-2 text-sm font-medium">{d.topic || "(no topic)"}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {d.sideA.name} vs {d.sideB.name} • {d.turns.length} turns •{" "}
                          {new Date(d.createdAt).toLocaleDateString()}
                        </p>
                      </button>
                      <div className="mt-2 flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteDebate(d.id)}
                          className="h-7 gap-1 text-xs text-slate-400 hover:text-red-400"
                        >
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
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="grid gap-4 md:grid-cols-2">
          <SideCard
            accent="fuchsia"
            label="Side A"
            config={sideA}
            onChange={setSideA}
            disabled={running}
          />
          <SideCard
            accent="cyan"
            label="Side B"
            config={sideB}
            onChange={setSideB}
            disabled={running}
          />
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
          <Label htmlFor="topic" className="text-sm text-slate-300">
            Topic or content to discuss
          </Label>
          <Textarea
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={running}
            rows={3}
            className="mt-2 resize-none border-white/10 bg-slate-950/50 text-slate-100 placeholder:text-slate-500"
            placeholder="Paste an article, a claim, a question, or anything else…"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!running ? (
              <Button
                onClick={start}
                className="gap-2 bg-gradient-to-r from-fuchsia-500 to-cyan-400 text-slate-950 hover:opacity-90"
              >
                <Play className="h-4 w-4" /> Start debate
              </Button>
            ) : (
              <Button onClick={stop} variant="destructive" className="gap-2">
                <Square className="h-4 w-4" /> Stop
              </Button>
            )}
            <Button
              onClick={reset}
              variant="ghost"
              className="gap-2 text-slate-300 hover:text-slate-100"
              disabled={running}
            >
              <RotateCcw className="h-4 w-4" /> Clear
            </Button>
            {running && (
              <span className="ml-2 flex items-center gap-2 text-xs text-slate-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fuchsia-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-fuchsia-500" />
                </span>
                Debating…
              </span>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
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
                  className={`grid h-8 w-8 place-items-center rounded-md border transition-colors ${
                    autoRead
                      ? "border-fuchsia-400/50 bg-fuchsia-500/20 text-fuchsia-200"
                      : "border-white/10 bg-slate-950/50 text-slate-300 hover:text-slate-100"
                  }`}
                  aria-label={autoRead ? "Turn off read aloud" : "Read aloud all replies"}
                  title={autoRead ? "Read aloud: on" : "Read aloud all replies"}
                >
                  {autoRead ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
              </div>
              <div className="flex min-w-[220px] items-center gap-2">
                <Gauge className="h-4 w-4 text-slate-400" />
                <span className="text-xs text-slate-400">Pause</span>
                <Slider
                  value={[pause]}
                  min={0}
                  max={15}
                  step={0.5}
                  onValueChange={(v) => setPause(v[0] ?? 1.5)}
                  className="w-40"
                />
                <span className="w-12 text-right text-xs tabular-nums text-slate-400">{pause.toFixed(1)}s</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Voice</span>
                <Select value={readLang} onValueChange={setReadLang}>
                  <SelectTrigger className="h-8 w-[140px] border-white/10 bg-slate-950/50 text-xs text-slate-100">
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

        <div
          ref={transcriptRef}
          onScroll={onTranscriptScroll}
          className="mt-4 h-[60vh] space-y-3 overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-slate-950/40 p-4"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {liveTurns.length === 0 && (
            <div className="py-16 text-center text-sm text-slate-500">
              Configure both sides, add a topic, and hit <span className="text-slate-300">Start debate</span>.
            </div>
          )}
          {liveTurns.map((t, i) => (
            <TurnBubble key={i} turn={t} readLang={readLang} />
          ))}
        </div>
      </main>
      <footer className="mx-auto max-w-7xl px-4 pb-8 pt-2 text-center text-xs text-slate-500">
        Powered by Lovable AI. Choose any model per side.
      </footer>
    </div>
  );
}

function SideCard({
  label,
  accent,
  config,
  onChange,
  disabled,
}: {
  label: string;
  accent: "fuchsia" | "cyan";
  config: SideConfig;
  onChange: (c: SideConfig) => void;
  disabled: boolean;
}) {
  const ring =
    accent === "fuchsia"
      ? "from-fuchsia-500/40 to-fuchsia-500/0 border-fuchsia-500/30"
      : "from-cyan-400/40 to-cyan-400/0 border-cyan-400/30";
  const dot = accent === "fuchsia" ? "bg-fuchsia-500" : "bg-cyan-400";
  return (
    <div className={`relative rounded-xl border ${ring} bg-gradient-to-b p-4`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-xs uppercase tracking-widest text-slate-400">{label}</span>
      </div>
      <div className="mt-3 grid gap-3">
        <div>
          <Label className="text-xs text-slate-300">Display name</Label>
          <Input
            value={config.name}
            disabled={disabled}
            onChange={(e) => onChange({ ...config, name: e.target.value })}
            className="mt-1 border-white/10 bg-slate-950/50 text-slate-100"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-300">Model</Label>
          <Select
            value={config.model}
            disabled={disabled}
            onValueChange={(v) => onChange({ ...config, model: v })}
          >
            <SelectTrigger className="mt-1 border-white/10 bg-slate-950/50 text-slate-100">
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
          <Label className="text-xs text-slate-300">Character / personality</Label>
          <Textarea
            value={config.persona}
            disabled={disabled}
            onChange={(e) => onChange({ ...config, persona: e.target.value })}
            rows={3}
            className="mt-1 resize-none border-white/10 bg-slate-950/50 text-slate-100 placeholder:text-slate-500"
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
    <div className={`flex ${isA ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] rounded-2xl border px-4 py-3 text-sm leading-relaxed ${
          isA
            ? "border-fuchsia-500/30 bg-fuchsia-500/10"
            : "border-cyan-400/30 bg-cyan-400/10"
        }`}
      >
        <div className="mb-1 flex items-center gap-2 text-xs">
          <span className={`h-1.5 w-1.5 rounded-full ${isA ? "bg-fuchsia-500" : "bg-cyan-400"}`} />
          <span className="font-medium text-slate-200">{turn.name}</span>
          <span className="text-slate-500">· {modelLabel}</span>
          <button
            type="button"
            onClick={toggleSpeak}
            aria-label={speaking ? "Stop reading" : "Read aloud"}
            title={speaking ? "Stop reading" : "Read aloud"}
            className="ml-auto grid h-6 w-6 place-items-center rounded-md border border-white/10 bg-slate-950/40 text-slate-300 hover:text-slate-100"
          >
            {speaking ? <StopCircle className="h-3.5 w-3.5" /> : <Volume1 className="h-3.5 w-3.5" />}
          </button>
        </div>
        <p className="whitespace-pre-wrap text-slate-100">{turn.text}</p>
      </div>
    </div>
  );
}

