import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Square,
  RotateCcw,
  Trash2,
  History,
  Volume2,
  VolumeX,
  Gauge,
  Volume1,
  StopCircle,
  Settings,
  Award,
  Sparkles,
  User,
  Key,
  Flame,
  Scale,
  BrainCircuit,
  CornerDownRight,
  TrendingUp,
  Cpu
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

import { DEFAULT_MODEL, PROVIDER_MODELS, PROVIDERS, MODELS, type ApiProvider } from "@/lib/models";
import { useLocalStorage } from "@/lib/storage";
import { streamSpeech, speakBrowser, type SpeechHandle } from "@/lib/tts";
import { streamChatCompletion, type ChatMsg } from "@/lib/api-client";
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
type SideConfig = { name: string; model: string; persona: string; avatar: string };
type Turn = { side: SideKey; text: string; model: string; name: string };
type SavedDebate = {
  id: string;
  topic: string;
  sideA: SideConfig;
  sideB: SideConfig;
  turns: Turn[];
  createdAt: number;
};

interface JudgeReport {
  summaryA: string;
  summaryB: string;
  strongestPointA: string;
  strongestPointB: string;
  winner: string;
  reasoning: string;
}

const DEFAULT_A: SideConfig = {
  name: "Aria",
  model: "gemini-2.0-flash",
  persona: "A sharp, evidence-driven optimist. Concise, witty, cites data and logical reasoning.",
  avatar: "🤖",
};
const DEFAULT_B: SideConfig = {
  name: "Kairo",
  model: "gemini-2.0-flash",
  persona: "A skeptical contrarian. Blunt, dry humor, pokes logical holes in every claim.",
  avatar: "🧠",
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

const PRESETS = [
  {
    title: "AI Legal Personhood",
    topic: "Should artificial intelligence be granted legal personhood and intellectual property rights?",
    sideA: {
      name: "Advocate Pro",
      avatar: "🤖",
      persona: "A futuristic tech philosopher. Eloquent, optimistic about AI synergy, cites civil rights analogies.",
    },
    sideB: {
      name: "Pragmatist Law",
      avatar: "⚖️",
      persona: "A protective humanist lawyer. Skeptical, focused on liability laws and preserving human-centric IP values.",
    },
  },
  {
    title: "Innovation: Remote vs Office",
    topic: "Is remote work superior to in-office work for fostering true creative innovation?",
    sideA: {
      name: "Flex Champion",
      avatar: "🏡",
      persona: "A modern workspace designer. Loves async communication, cites studies on deep focus and global diversity.",
    },
    sideB: {
      name: "Office Purist",
      avatar: "🏢",
      persona: "A collaborative startup founder. Believes in serendipitous chemistry and whiteboard energy of shared spaces.",
    },
  },
  {
    title: "Mars vs Planet Earth",
    topic: "Should humanity prioritize Mars colonization over solving climate change on Earth?",
    sideA: {
      name: "Novacene Star",
      avatar: "🚀",
      persona: "An enthusiastic space scientist. Inspiring, believes planetary defense guarantees human species survival.",
    },
    sideB: {
      name: "Terra Guard",
      avatar: "🌍",
      persona: "A dedicated environmentalist. Urges ground-level action, believes Mars is a dangerous, costly distraction.",
    },
  },
];

const AVATAR_OPTIONS = ["🤖", "🧠", "⚖️", "🚀", "🌍", "🔥", "🎭", "🕶️", "💼", "🦉", "🦁", "🦊", "🏡", "🏢"];

const READ_STOP_EVENT = "duel-of-minds-stop-reading";

function buildSystem(self: SideConfig, other: SideConfig, topic: string) {
  return `You are ${self.name}, one of two AI debaters in a live back-and-forth debate.
Your avatar character: ${self.avatar}
Your character/personality: ${self.persona}

You are debating ${other.name} (personality: ${other.persona}).

The topic / content under discussion:
"""
${topic}
"""

Rules:
- Stay strictly in character.
- Keep each turn short: 2–4 sentences, punchy and direct.
- Engage directly with the OTHER debater's last point (refute or query it).
- Do NOT prefix your reply with your name or any label. Just speak.
- No stage directions, no asterisks, no meta commentary.`;
}

function Arena() {
  const { theme } = useTheme();

  // API Config State
  const [apiProvider, setApiProvider] = useLocalStorage<ApiProvider>("dom.apiProvider", "lovable");
  const [geminiKey, setGeminiKey] = useLocalStorage<string>("dom.geminiKey", "");
  const [openaiKey, setOpenaiKey] = useLocalStorage<string>("dom.openaiKey", "");
  const [openrouterKey, setOpenrouterKey] = useLocalStorage<string>("dom.openrouterKey", "");

  // Debater State
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
  const [voiceType, setVoiceType] = useLocalStorage<"browser" | "ai">("dom.voiceType", "browser");

  // Arena Runtime State
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState<{ side: SideKey; text: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<SideKey | null>(null);
  const [thinkingSide, setThinkingSide] = useState<SideKey | null>(null);
  const [sentiment, setSentiment] = useState<number>(50); // 50 is perfectly balanced, <50 Aria, >50 Kairo

  // Judge State
  const [judging, setJudging] = useState(false);
  const [judgeReport, setJudgeReport] = useState<JudgeReport | null>(null);
  const [showJudgeModal, setShowJudgeModal] = useState(false);

  // Settings State
  const [showSettings, setShowSettings] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const speechHandleRef = useRef<SpeechHandle | null>(null);
  
  const pauseRef = useRef(pause);
  const autoReadRef = useRef(autoRead);
  const readLangRef = useRef(readLang);
  const voiceTypeRef = useRef(voiceType);

  useEffect(() => { pauseRef.current = pause; }, [pause]);
  useEffect(() => { autoReadRef.current = autoRead; }, [autoRead]);
  useEffect(() => { readLangRef.current = readLang; }, [readLang]);
  useEffect(() => { voiceTypeRef.current = voiceType; }, [voiceType]);

  // Handle automatic model selection updates on API Provider change
  const handleProviderChange = (newProvider: ApiProvider) => {
    setApiProvider(newProvider);
    const defaultModel = PROVIDER_MODELS[newProvider][0].id;
    setSideA(prev => ({ ...prev, model: defaultModel }));
    setSideB(prev => ({ ...prev, model: defaultModel }));
    toast.success(`Switched provider to ${PROVIDERS.find(p => p.id === newProvider)?.label}. Models reset to defaults.`);
  };

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
    if (voiceTypeRef.current === "browser") {
      speechHandleRef.current?.stop();
      try {
        const handle = speakBrowser(text, readLangRef.current, 1.15);
        speechHandleRef.current = handle;
        await handle.done;
        if (speechHandleRef.current === handle) speechHandleRef.current = null;
      } catch (err) {
        console.error("Browser voice error", err);
      }
    } else {
      const ctx = ensureAudioCtx();
      if (!ctx) return;
      speechHandleRef.current?.stop();
      try {
        const handle = await streamSpeech({ text, lang: readLangRef.current, ctx });
        speechHandleRef.current = handle;
        await handle.done;
        if (speechHandleRef.current === handle) speechHandleRef.current = null;
      } catch (err) {
        if ((err as Error).name !== "AbortError") toast.error("AI voice stream failed.");
      }
    }
  }, [ensureAudioCtx]);

  // Dynamically calculate sentiment changes based on turn contents
  const updateSentiment = useCallback((text: string, side: SideKey) => {
    const words = text.split(/\s+/).length;
    const exclamations = (text.match(/!/g) || []).length;
    const questions = (text.match(/\?/g) || []).length;
    const numbers = (text.match(/\b\d+\b/g) || []).length;

    let power = 0;
    power += Math.min(words / 12, 4); // weight length (capped)
    power += numbers * 1.5; // data reference weight
    power += questions * 0.8; // rhetorical queries
    power -= exclamations * 0.4; // emotional outbursts reduce debate weight
    
    // Add small random noise for audience swing
    power += (Math.random() - 0.5) * 2;
    
    const delta = Math.min(10, Math.max(-10, power));
    
    setSentiment(prev => {
      let next = prev;
      if (side === "A") {
        next = Math.max(10, prev - delta);
      } else {
        next = Math.min(90, prev + delta);
      }
      return Math.round(next);
    });
  }, []);

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

      const messages: ChatMsg[] = [];
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
      setThinkingSide(nextSide);
      setActiveSpeaker(null);

      let full = "";
      try {
        const activeKey = 
          apiProvider === "gemini" ? geminiKey : 
          apiProvider === "openai" ? openaiKey : 
          apiProvider === "openrouter" ? openrouterKey : "";

        if (apiProvider !== "lovable" && activeKey.trim() !== "") {
          // Direct client-side streaming call
          await streamChatCompletion({
            provider: apiProvider,
            apiKey: activeKey,
            model: self.model,
            system,
            messages,
            onChunk: (text) => {
              setThinkingSide(null);
              setActiveSpeaker(nextSide);
              full = text;
              setStreaming({ side: nextSide, text });
            },
            signal: controller.signal
          });
        } else {
          // Server-side fallback call
          const res = await fetch("/api/turn", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: self.model, system, messages }),
            signal: controller.signal,
          });
          if (!res.ok || !res.body) {
            const errText = await res.text().catch(() => "");
            if (res.status === 402) toast.error("AI credits exhausted. Add credentials in workspace settings.");
            else if (res.status === 429) toast.error("Rate limited. Slow down and try again.");
            else toast.error(errText || `Request failed (${res.status})`);
            return null;
          }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          
          setThinkingSide(null);
          setActiveSpeaker(nextSide);

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            full += dec.decode(value, { stream: true });
            setStreaming({ side: nextSide, text: full });
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // ignore outer abort
        } else {
          console.error(err);
          toast.error("Stream error: " + (err as Error).message);
        }
      } finally {
        abortRef.current = null;
        setStreaming(null);
        setThinkingSide(null);
        setActiveSpeaker(null);
      }

      const text = full.trim();
      if (!text) return null;
      
      updateSentiment(text, nextSide);
      return { side: nextSide, text, model: self.model, name: self.name };
    },
    [sideA, sideB, topic, apiProvider, geminiKey, openaiKey, openrouterKey, updateSentiment],
  );

  const start = useCallback(async () => {
    if (running) return;
    if (!topic.trim()) {
      toast.error("Add a topic first.");
      return;
    }
    
    // Warn if trying to call direct APIs without keys
    const activeKey = 
      apiProvider === "gemini" ? geminiKey : 
      apiProvider === "openai" ? openaiKey : 
      apiProvider === "openrouter" ? openrouterKey : "";
    
    if (apiProvider !== "lovable" && !activeKey.trim()) {
      toast.error(`Please configure your ${PROVIDERS.find(p => p.id === apiProvider)?.label} Key in Settings first.`);
      setShowSettings(true);
      return;
    }

    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
    } catch {
      // ignore audio context failures
    }

    stopRequestedRef.current = false;
    setRunning(true);
    setTurns([]);
    setSentiment(50);
    setJudgeReport(null);

    let priorTurns: Turn[] = [];
    let nextSide: SideKey = "A";

    while (!stopRequestedRef.current) {
      const t = await runTurn(nextSide, priorTurns);
      if (!t) break;
      priorTurns = [...priorTurns, t];
      setTurns(priorTurns);
      
      if (autoReadRef.current) {
        setActiveSpeaker(nextSide);
        await readTurnAloud(t.text);
        setActiveSpeaker(null);
        if (stopRequestedRef.current) break;
      }

      nextSide = nextSide === "A" ? "B" : "A";
      const delay = Math.max(0, Math.round(pauseRef.current * 1000));
      if (delay > 0) {
        setThinkingSide(nextSide);
        await new Promise((r) => setTimeout(r, delay));
        setThinkingSide(null);
      }
      if (priorTurns.length >= 40) break;
    }

    setRunning(false);
  }, [running, runTurn, topic, apiProvider, geminiKey, openaiKey, openrouterKey, readTurnAloud]);

  const stop = useCallback(() => {
    stopRequestedRef.current = true;
    abortRef.current?.abort();
    speechHandleRef.current?.stop();
    speechHandleRef.current = null;
    setActiveSpeaker(null);
    setThinkingSide(null);
  }, []);

  const reset = useCallback(() => {
    stop();
    setTurns([]);
    setStreaming(null);
    setSentiment(50);
    setJudgeReport(null);
    savedRef.current = true;
  }, [stop]);

  const loadDebate = (d: SavedDebate) => {
    stop();
    setSideA(d.sideA);
    setSideB(d.sideB);
    setTopic(d.topic);
    setTurns(d.turns);
    setSentiment(50);
    setJudgeReport(null);
    savedRef.current = true;
  };

  const loadPreset = (preset: typeof PRESETS[0]) => {
    if (running) return;
    setTopic(preset.topic);
    const defaultModel = PROVIDER_MODELS[apiProvider][0].id;
    setSideA({
      name: preset.sideA.name,
      model: defaultModel,
      persona: preset.sideA.persona,
      avatar: preset.sideA.avatar
    });
    setSideB({
      name: preset.sideB.name,
      model: defaultModel,
      persona: preset.sideB.persona,
      avatar: preset.sideB.avatar
    });
    setTurns([]);
    setSentiment(50);
    setJudgeReport(null);
    toast.success(`Preset "${preset.title}" loaded!`);
  };

  const getJudgeDecision = async () => {
    if (turns.length < 2) {
      toast.error("The debate needs at least 2 turns to be judged.");
      return;
    }
    setJudging(true);
    setJudgeReport(null);
    setShowJudgeModal(true);

    const activeKey = 
      apiProvider === "gemini" ? geminiKey : 
      apiProvider === "openai" ? openaiKey : 
      apiProvider === "openrouter" ? openrouterKey : "";

    const transcriptText = turns.map(t => `${t.name}: ${t.text}`).join("\n\n");
    const system = `You are a neutral, highly analytical debate judge. Analyze the debate topic: "${topic}" and the debate turns between ${sideA.name} and ${sideB.name}.
Your job is to provide a breakdown of the debate in JSON format.
You must respond with raw JSON ONLY. No markdown wrapper, no triple backticks, no explanatory text.
JSON structure:
{
  "summaryA": "1-sentence summary of ${sideA.name}'s core stance",
  "summaryB": "1-sentence summary of ${sideB.name}'s core stance",
  "strongestPointA": "The strongest argument made by ${sideA.name} and why it worked",
  "strongestPointB": "The strongest argument made by ${sideB.name} and why it worked",
  "winner": "${sideA.name}" or "${sideB.name}" or "Draw",
  "reasoning": "A concise explanation of why the winner was chosen or why it was a draw."
}`;

    const messages = [
      { role: "user" as const, content: `Analyze this debate transcript:\n\n${transcriptText}` }
    ];

    try {
      let resultText = "";
      if (apiProvider !== "lovable" && activeKey.trim() !== "") {
        const controller = new AbortController();
        resultText = await streamChatCompletion({
          provider: apiProvider,
          apiKey: activeKey,
          model: PROVIDER_MODELS[apiProvider][0].id,
          system,
          messages,
          onChunk: () => {},
          signal: controller.signal
        });
      } else {
        const res = await fetch("/api/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            model: PROVIDER_MODELS.lovable[0].id,
            system, 
            messages 
          }),
        });
        if (!res.ok) {
          throw new Error(await res.text() || "Failed to get response from fallback server");
        }
        resultText = await res.text();
      }

      const cleaned = resultText.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned) as JudgeReport;
      setJudgeReport(parsed);
      toast.success("The Judge has reached a decision!");
    } catch (err) {
      console.error(err);
      toast.error("Failed to parse Judge report: " + (err as Error).message);
    } finally {
      setJudging(false);
    }
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
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
      <Toaster theme={theme} />
      
      {/* Top Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-gradient-to-tr from-indigo-500/20 via-transparent to-rose-500/20 shadow-inner">
              <BrainCircuit className="h-5 w-5 text-indigo-500" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold leading-none tracking-tight bg-gradient-to-r from-indigo-500 via-purple-500 to-rose-500 bg-clip-text text-transparent">
                Duel of Minds
              </h1>
              <p className="mt-1 text-[9px] uppercase tracking-[0.25em] text-muted-foreground font-semibold">
                AI vs AI Debate Arena
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Active API Indicator */}
            <Badge variant="outline" className="hidden sm:inline-flex gap-1.5 px-3 py-1 font-mono text-[10px] tracking-wide bg-card border-border">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              PROVIDER: {apiProvider.toUpperCase()}
            </Badge>

            {/* Settings Button */}
            <Button variant="outline" size="sm" onClick={() => setShowSettings(true)} className="gap-2 border-border bg-card">
              <Settings className="h-4 w-4" /> Config
            </Button>

            {/* Theme & History */}
            <ThemeToggle />
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 border-border bg-card">
                  <History className="h-4 w-4" /> History
                </Button>
              </SheetTrigger>
              <SheetContent className="glass-panel border-l">
                <SheetHeader>
                  <SheetTitle className="font-display text-xl font-bold">Past Debates</SheetTitle>
                </SheetHeader>
                <div className="mt-6 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{history.length} saved debates</p>
                  {history.length > 0 && (
                    <Button variant="ghost" size="xs" onClick={clearHistory} className="text-muted-foreground hover:text-destructive">
                      Clear all
                    </Button>
                  )}
                </div>
                <ScrollArea className="mt-4 h-[calc(100vh-140px)] pr-2">
                  <div className="space-y-3">
                    {history.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-10">No saved debates yet. Let them debate!</p>
                    )}
                    {history.map((d) => (
                      <div key={d.id} className="rounded-lg border border-border bg-card/60 p-4 transition-all hover:bg-card">
                        <button onClick={() => loadDebate(d)} className="block w-full text-left">
                          <p className="line-clamp-2 text-sm font-semibold text-foreground/90">{d.topic || "(no topic)"}</p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {d.sideA.name} ({d.sideA.avatar}) vs {d.sideB.name} ({d.sideB.avatar}) · {d.turns.length} turns
                          </p>
                          <p className="mt-1 text-[10px] text-muted-foreground/60">
                            {new Date(d.createdAt).toLocaleDateString()} at {new Date(d.createdAt).toLocaleTimeString()}
                          </p>
                        </button>
                        <div className="mt-3 flex justify-end">
                          <Button variant="ghost" size="xs" onClick={() => deleteDebate(d.id)} className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" /> Delete
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

      {/* Main Container */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        
        {/* Intro Hero Section */}
        <section className="mb-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-500">Battle Ground</p>
          <h2 className="mt-2 font-display text-3xl font-extrabold leading-tight tracking-tight md:text-4xl text-foreground">
            Two AI Entities. <span className="text-muted-foreground">One Live Argument.</span>
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Choose your combatants, configure their personas, select an LLM provider, and watch the exchange stream live. You can even summon an AI judge to evaluate who won the argument!
          </p>
        </section>

        {/* Versus Arena Cards */}
        <div className="grid gap-6 md:grid-cols-5 items-stretch mb-6">
          {/* Side A Card */}
          <div className="md:col-span-2">
            <SideArenaCard 
              label="Left Combatant" 
              config={sideA} 
              onChange={setSideA} 
              disabled={running} 
              active={activeSpeaker === "A"}
              thinking={thinkingSide === "A"}
              isSideA={true}
              apiProvider={apiProvider}
            />
          </div>

          {/* Versus Center Circle / Sentiment */}
          <div className="md:col-span-1 flex flex-col justify-center items-center gap-4 py-4 md:py-0">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-border bg-card shadow-lg">
              <span className="font-display font-black text-lg tracking-wider bg-gradient-to-r from-indigo-500 to-rose-500 bg-clip-text text-transparent">
                VS
              </span>
              
              {/* Spinning borders on speakers */}
              {activeSpeaker === "A" && (
                <div className="absolute inset-0 rounded-full border-2 border-t-indigo-500 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
              )}
              {activeSpeaker === "B" && (
                <div className="absolute inset-0 rounded-full border-2 border-t-rose-500 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
              )}
            </div>
            
            {/* Waveform indicator */}
            {activeSpeaker ? (
              <div className="flex flex-col items-center gap-1">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Speaking</span>
                <div className={`audio-waveform ${activeSpeaker === "A" ? "text-indigo-500" : "text-rose-500"}`}>
                  <div className="waveform-bar" />
                  <div className="waveform-bar" />
                  <div className="waveform-bar" />
                  <div className="waveform-bar" />
                  <div className="waveform-bar" />
                </div>
              </div>
            ) : thinkingSide ? (
              <div className="flex flex-col items-center gap-1">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold animate-pulse">Thinking</span>
                <div className="flex gap-1.5 mt-1">
                  <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            ) : (
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold">Standby</span>
            )}
          </div>

          {/* Side B Card */}
          <div className="md:col-span-2">
            <SideArenaCard 
              label="Right Combatant" 
              config={sideB} 
              onChange={setSideB} 
              disabled={running} 
              active={activeSpeaker === "B"}
              thinking={thinkingSide === "B"}
              isSideA={false}
              apiProvider={apiProvider}
            />
          </div>
        </div>

        {/* Real-time Audience Sentiment Bar */}
        <div className="mb-6 p-4 rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs text-indigo-500 font-semibold">
              <span>{sideA.name} ({100 - sentiment}%)</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
              <TrendingUp className="h-3.5 w-3.5" />
              <span>Audience Sentiment</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-rose-500 font-semibold">
              <span>{sideB.name} ({sentiment}%)</span>
            </div>
          </div>
          <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden flex">
            {/* Aria side */}
            <div 
              className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-500" 
              style={{ width: `${100 - sentiment}%` }} 
            />
            {/* Center dividing pin */}
            <div className="w-[2px] bg-background z-10" />
            {/* Kairo side */}
            <div 
              className="h-full bg-gradient-to-r from-rose-400 to-rose-600 transition-all duration-500" 
              style={{ width: `${sentiment}%` }} 
            />
          </div>
        </div>

        {/* Quick Presets Section */}
        {!running && turns.length === 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-purple-500" />
              <h3 className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Or Load A Quick Debate Preset
              </h3>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {PRESETS.map((preset, index) => (
                <button
                  key={index}
                  onClick={() => loadPreset(preset)}
                  className="text-left p-4 rounded-xl border border-border bg-card/40 transition-all hover:bg-card hover:border-purple-500/50 hover:shadow-md group flex flex-col justify-between"
                >
                  <div>
                    <h4 className="font-display text-sm font-bold text-foreground group-hover:text-purple-500 transition-colors">
                      {preset.title}
                    </h4>
                    <p className="mt-2 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {preset.topic}
                    </p>
                  </div>
                  <div className="mt-4 flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
                    <span>{preset.sideA.avatar} {preset.sideA.name}</span>
                    <span className="text-border">|</span>
                    <span>{preset.sideB.avatar} {preset.sideB.name}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Topic Input Box */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <Label htmlFor="topic" className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-1.5">
            <Flame className="h-3.5 w-3.5 text-amber-500" />
            The Debate Motion / Topic
          </Label>
          <Textarea
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={running}
            rows={2}
            className="mt-3 resize-none border-border bg-background/50 rounded-lg p-3 text-sm focus:bg-background focus:ring-1 focus:ring-indigo-500/50"
            placeholder="E.g. Is artificial intelligence a threat to human creativity?"
          />
          
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              {!running ? (
                <Button onClick={start} className="gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium shadow hover:opacity-90 btn-premium px-5">
                  <Play className="h-4 w-4 fill-current" /> Start Arena
                </Button>
              ) : (
                <Button onClick={stop} variant="destructive" className="gap-2 px-5 animate-pulse">
                  <Square className="h-4 w-4" /> Stop Debate
                </Button>
              )}
              
              <Button onClick={reset} variant="outline" className="gap-2 border-border bg-card" disabled={running}>
                <RotateCcw className="h-4 w-4" /> Reset
              </Button>
              
              {turns.length >= 2 && !running && (
                <Button 
                  onClick={getJudgeDecision} 
                  variant="outline" 
                  className="gap-2 border-indigo-500/40 bg-indigo-500/5 text-indigo-500 hover:bg-indigo-500/10"
                >
                  <Award className="h-4 w-4" /> Debate Judge
                </Button>
              )}

              {running && (
                <span className="ml-1 flex items-center gap-2 text-xs text-muted-foreground font-medium">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>
                  Debate in progress...
                </span>
              )}
            </div>

            {/* Voice & Pause Controls */}
            <div className="flex flex-wrap items-center gap-4">
              {/* Speak Audio Toggle */}
              <button
                type="button"
                onClick={() => {
                  const next = !autoRead;
                  setAutoRead(next);
                  if (next) {
                    ensureAudioCtx();
                    toast.success(`Voice enabled (${voiceType === "browser" ? "Browser Voice" : "AI Voice"})`);
                  } else {
                    speechHandleRef.current?.stop();
                    speechHandleRef.current = null;
                  }
                }}
                className={`grid h-10 w-10 place-items-center rounded-lg border transition-all ${
                  autoRead
                    ? "border-indigo-500 bg-indigo-500 text-white shadow-md shadow-indigo-500/20"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
                title={autoRead ? "Audio Voice: ON" : "Audio Voice: OFF"}
              >
                {autoRead ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>

              {/* Pause Interval Slider */}
              <div className="flex items-center gap-2 bg-card border border-border px-3 py-1.5 rounded-lg">
                <Gauge className="h-4 w-4 text-muted-foreground" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pause</span>
                <Slider
                  value={[pause]}
                  min={0.5}
                  max={8}
                  step={0.5}
                  onValueChange={(v) => setPause(v[0] ?? 1.5)}
                  className="w-24 cursor-pointer"
                />
                <span className="w-8 text-right text-xs font-mono font-bold text-muted-foreground">{pause.toFixed(1)}s</span>
              </div>

              {/* Voice Language Select */}
              <div className="flex items-center gap-2 bg-card border border-border px-3 py-1 rounded-lg">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lang</span>
                <Select value={readLang} onValueChange={setReadLang}>
                  <SelectTrigger className="h-7 w-[120px] text-xs border-none bg-transparent shadow-none p-0 focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
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

        {/* The Exchange Transcript Display */}
        <section className="mt-8">
          <div className="mb-4 flex items-baseline justify-between">
            <h3 className="font-display text-xs font-extrabold uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-indigo-500" />
              The Exchange Transcript
            </h3>
            <span className="text-xs font-mono bg-card px-2 py-0.5 rounded border border-border text-muted-foreground">
              {turns.length} {turns.length === 1 ? "turn" : "turns"}
            </span>
          </div>

          <div
            ref={transcriptRef}
            onScroll={onTranscriptScroll}
            className="h-[55vh] space-y-4 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card/30 p-6 shadow-inner"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {liveTurns.length === 0 && (
              <div className="py-20 flex flex-col items-center justify-center text-center">
                <div className="h-12 w-12 rounded-full border border-dashed border-muted-foreground/40 flex items-center justify-center text-muted-foreground mb-4">
                  <Play className="h-5 w-5 translate-x-0.5" />
                </div>
                <p className="text-sm font-semibold text-muted-foreground">Debate Floor is Empty</p>
                <p className="mt-1 text-xs text-muted-foreground/60 max-w-sm">
                  Review combatants, input a debate topic, and click <span className="text-foreground font-semibold">Start Arena</span>.
                </p>
              </div>
            )}
            
            {liveTurns.map((t, i) => (
              <TurnBubble 
                key={i} 
                turn={t} 
                readLang={readLang} 
                voiceType={voiceType} 
                avatar={t.side === "A" ? sideA.avatar : sideB.avatar}
              />
            ))}
          </div>
        </section>
      </main>

      {/* Global Config Settings Modal */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="sm:max-w-[480px] glass-panel border shadow-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-bold flex items-center gap-2">
              <Settings className="h-5 w-5 text-indigo-500" />
              Arena Configuration
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-5 py-2">
            {/* API Provider selection */}
            <div className="grid gap-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Cpu className="h-3.5 w-3.5 text-indigo-500" />
                Debate LLM Provider
              </Label>
              <Select value={apiProvider} onValueChange={(val) => handleProviderChange(val as ApiProvider)}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue placeholder="Select LLM provider" />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((prov) => (
                    <SelectItem key={prov.id} value={prov.id}>
                      {prov.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Provider API Keys inputs */}
            {apiProvider !== "lovable" && (
              <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-4">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Key className="h-3.5 w-3.5 text-amber-500" />
                  API Keys configuration (Stored Locally)
                </h4>
                
                {apiProvider === "gemini" && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="geminiKey" className="text-xs">Google Gemini API Key</Label>
                    <Input
                      id="geminiKey"
                      type="password"
                      placeholder="AIzaSy..."
                      value={geminiKey}
                      onChange={(e) => setGeminiKey(e.target.value)}
                      className="bg-background border-border"
                    />
                    <span className="text-[10px] text-muted-foreground/80 leading-snug">
                      Get a free Gemini API key on Google AI Studio. Direct client-side streaming request.
                    </span>
                  </div>
                )}

                {apiProvider === "openai" && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="openaiKey" className="text-xs">OpenAI API Key</Label>
                    <Input
                      id="openaiKey"
                      type="password"
                      placeholder="sk-proj-..."
                      value={openaiKey}
                      onChange={(e) => setOpenaiKey(e.target.value)}
                      className="bg-background border-border"
                    />
                  </div>
                )}

                {apiProvider === "openrouter" && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="openrouterKey" className="text-xs">OpenRouter API Key</Label>
                    <Input
                      id="openrouterKey"
                      type="password"
                      placeholder="sk-or-v1-..."
                      value={openrouterKey}
                      onChange={(e) => setOpenrouterKey(e.target.value)}
                      className="bg-background border-border"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Audio Voice settings */}
            <div className="grid gap-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Volume2 className="h-3.5 w-3.5 text-indigo-500" />
                Text-to-Speech Voice Engine
              </Label>
              <Select value={voiceType} onValueChange={(val) => setVoiceType(val as "browser" | "ai")}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="browser">
                    Browser Synthesis (100% Free, Offline)
                  </SelectItem>
                  <SelectItem value="ai">
                    AI TTS Voice (Requires API keys)
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground leading-normal">
                Browser Speech Synthesis is fast, works locally, and requires no API key credits. AI voice uses OpenAI TTS.
              </p>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button onClick={() => setShowSettings(false)} className="bg-indigo-600 text-white hover:bg-indigo-700">
              Save & Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Judge Report Modal */}
      <Dialog open={showJudgeModal} onOpenChange={setShowJudgeModal}>
        <DialogContent className="sm:max-w-[550px] glass-panel border shadow-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-bold flex items-center gap-2 border-b pb-3">
              <Award className="h-5 w-5 text-indigo-500" />
              The AI Judge Panel
            </DialogTitle>
          </DialogHeader>

          {judging ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <div className="h-10 w-10 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin mb-4" />
              <h3 className="font-display font-semibold text-foreground">Analyzing Debate Stances...</h3>
              <p className="text-xs text-muted-foreground max-w-xs mt-1">
                Evaluating claims, evidence strength, logical consistency and rhetorical impact of both sides.
              </p>
            </div>
          ) : judgeReport ? (
            <div className="space-y-5 py-1">
              {/* Winner Reveal Card */}
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5 text-center relative overflow-hidden">
                <div className="absolute top-0 right-0 p-1 opacity-10">
                  <Award className="h-24 w-24" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-indigo-500">Verdict Declared</span>
                <h3 className="font-display text-2xl font-black text-foreground mt-1 flex items-center justify-center gap-2">
                  🏆 Winner: <span className="bg-gradient-to-r from-indigo-500 to-rose-500 bg-clip-text text-transparent">{judgeReport.winner}</span>
                </h3>
              </div>

              {/* Summaries */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-card p-3.5">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-500">{sideA.name} Core Stance</span>
                  <p className="mt-1 text-xs leading-relaxed text-foreground/80">{judgeReport.summaryA}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-3.5">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-rose-500">{sideB.name} Core Stance</span>
                  <p className="mt-1 text-xs leading-relaxed text-foreground/80">{judgeReport.summaryB}</p>
                </div>
              </div>

              {/* Strongest Points */}
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-card p-4">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-500 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    {sideA.name}'s Strongest Point
                  </span>
                  <p className="mt-1.5 text-xs leading-relaxed text-foreground/80">{judgeReport.strongestPointA}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-rose-500 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    {sideB.name}'s Strongest Point
                  </span>
                  <p className="mt-1.5 text-xs leading-relaxed text-foreground/80">{judgeReport.strongestPointB}</p>
                </div>
              </div>

              {/* Judge's Reasoning */}
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Scale className="h-3.5 w-3.5" />
                  Detailed Judge Reasoning
                </span>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{judgeReport.reasoning}</p>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Error fetching judge review.
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <Button onClick={() => setShowJudgeModal(false)} className="bg-indigo-600 text-white hover:bg-indigo-700">
              Dismiss Verdict
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Footer */}
      <footer className="mx-auto max-w-6xl border-t border-border px-6 py-6 mt-10 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        Powered by KurianVarghese26 · Connected to Git & Local Storage
      </footer>
    </div>
  );
}

interface SideArenaCardProps {
  label: string;
  config: SideConfig;
  onChange: (c: SideConfig) => void;
  disabled: boolean;
  active: boolean;
  thinking: boolean;
  isSideA: boolean;
  apiProvider: ApiProvider;
}

function SideArenaCard({
  label,
  config,
  onChange,
  disabled,
  active,
  thinking,
  isSideA,
  apiProvider,
}: SideArenaCardProps) {
  const modelsList = PROVIDER_MODELS[apiProvider] || PROVIDER_MODELS.lovable;

  return (
    <div 
      className={`rounded-xl border bg-card p-5 arena-card-${isSideA ? "a" : "b"} ${
        active ? "active-speaker ring-1 ring-offset-0" : ""
      } ${thinking ? (isSideA ? "thinking-a" : "thinking-b") : ""}`}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between border-b border-border/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-indigo-500" style={{ backgroundColor: isSideA ? "#4f46e5" : "#f43f5e" }} />
          <span className="font-display text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        </div>
        
        {/* Avatar Customization */}
        <Select
          value={config.avatar}
          disabled={disabled}
          onValueChange={(avatar) => onChange({ ...config, avatar })}
        >
          <SelectTrigger className="h-7 w-12 border-none bg-transparent hover:bg-muted/30 p-0 text-center text-sm shadow-none focus:ring-0">
            <SelectValue>{config.avatar}</SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-0 w-24">
            <div className="grid grid-cols-3 gap-1 p-1">
              {AVATAR_OPTIONS.map((emoji) => (
                <SelectItem key={emoji} value={emoji} className="cursor-pointer text-center flex justify-center p-1 font-sans text-sm">
                  {emoji}
                </SelectItem>
              ))}
            </div>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 grid gap-4">
        {/* Name Input */}
        <div>
          <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <User className="h-3 w-3" /> Display Name
          </Label>
          <Input
            value={config.name}
            disabled={disabled}
            onChange={(e) => onChange({ ...config, name: e.target.value })}
            className="mt-1.5 h-9 bg-background/50 border-border"
          />
        </div>

        {/* Model Selector */}
        <div>
          <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Cpu className="h-3 w-3" /> Model
          </Label>
          <Select
            value={config.model}
            disabled={disabled}
            onValueChange={(v) => onChange({ ...config, model: v })}
          >
            <SelectTrigger className="mt-1.5 h-9 bg-background/50 border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {modelsList.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  <span className="flex flex-col text-left">
                    <span className="text-xs font-semibold">{m.label}</span>
                    {m.hint && <span className="text-[10px] text-muted-foreground">{m.hint}</span>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Character Description */}
        <div>
          <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Flame className="h-3 w-3" /> Persona / Character
          </Label>
          <Textarea
            value={config.persona}
            disabled={disabled}
            onChange={(e) => onChange({ ...config, persona: e.target.value })}
            rows={2}
            className="mt-1.5 resize-none bg-background/50 border-border text-xs rounded-lg p-2 leading-relaxed"
            placeholder="e.g. sarcastic physicist who loves data"
          />
        </div>
      </div>
    </div>
  );
}

interface TurnBubbleProps {
  turn: Turn;
  readLang: string;
  voiceType: "browser" | "ai";
  avatar: string;
}

function TurnBubble({ turn, readLang, voiceType, avatar }: TurnBubbleProps) {
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
    
    // Stop any other bubble from speaking first
    window.dispatchEvent(new Event(READ_STOP_EVENT));
    
    if (voiceType === "browser") {
      setSpeaking(true);
      const handle = speakBrowser(turn.text, readLang, 1.15);
      handleRef.current = handle;
      await handle.done;
      if (handleRef.current === handle) handleRef.current = null;
      setSpeaking(false);
    } else {
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
          toast.error((err as Error).message || "AI Voice synthesis failed.");
        }
      }
    }
  };

  return (
    <article className={`flex flex-col max-w-[85%] ${isA ? "mr-auto items-start" : "ml-auto items-end animate-fade-in"}`}>
      {/* Bubble Header */}
      <header className="mb-1.5 flex items-center gap-2 text-muted-foreground px-2">
        <span className="text-[14px]">{avatar}</span>
        <span className="font-display text-xs font-bold text-foreground/80">{turn.name}</span>
        <span className="text-[9px] font-mono bg-muted px-1.5 py-0.2 rounded leading-tight">{modelLabel}</span>
      </header>

      {/* Bubble Content Body */}
      <div 
        className={`relative rounded-2xl p-4 shadow-sm border transition-all duration-300 leading-relaxed text-sm ${
          isA 
            ? "bg-indigo-500/5 dark:bg-indigo-500/10 border-indigo-500/20 text-foreground rounded-tl-none pr-10" 
            : "bg-rose-500/5 dark:bg-rose-500/10 border-rose-500/20 text-foreground rounded-tr-none pl-10"
        }`}
      >
        <p className="whitespace-pre-wrap">{turn.text}</p>
        
        {/* Play/Stop Speech Button Inside Bubble */}
        <button
          type="button"
          onClick={toggleSpeak}
          aria-label={speaking ? "Stop speak" : "Speak turn"}
          className={`absolute bottom-3 ${isA ? "right-3" : "left-3"} h-7 w-7 rounded-lg border border-border/80 bg-background/90 text-muted-foreground flex items-center justify-center transition-all hover:text-foreground hover:scale-105 active:scale-95 shadow-sm`}
        >
          {speaking ? <StopCircle className="h-3.5 w-3.5 text-rose-500" /> : <Volume1 className="h-3.5 w-3.5 text-indigo-500" />}
        </button>
      </div>
    </article>
  );
}
