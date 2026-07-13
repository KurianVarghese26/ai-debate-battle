export type ModelOption = { id: string; label: string; hint?: string };

export type ApiProvider = "lovable" | "gemini" | "openai" | "openrouter";

export const PROVIDERS = [
  { id: "lovable", label: "Lovable Gateway (Default)" },
  { id: "gemini", label: "Google Gemini API (Direct)" },
  { id: "openai", label: "OpenAI API (Direct)" },
  { id: "openrouter", label: "OpenRouter (Direct)" },
] as const;

export const PROVIDER_MODELS: Record<ApiProvider, ModelOption[]> = {
  lovable: [
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Default • Fast" },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Reasoning" },
    { id: "openai/gpt-4o-mini", label: "GPT-4o Mini", hint: "Fast" },
    { id: "openai/gpt-4o", label: "GPT-4o", hint: "Strong" },
    { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (preview)" },
    { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
    { id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)" },
  ],
  gemini: [
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "Default • Fast & Smart" },
    { id: "gemini-2.0-pro-exp-02-05", label: "Gemini 2.0 Pro Exp", hint: "Reasoning" },
    { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", hint: "Legacy Fast" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", hint: "Legacy Smart" },
  ],
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o Mini", hint: "Default • Fast & Cheap" },
    { id: "gpt-4o", label: "GPT-4o", hint: "Highly Capable" },
    { id: "o3-mini", label: "o3-mini", hint: "Reasoning" },
    { id: "o1-mini", label: "o1-mini", hint: "Legacy Reasoning" },
  ],
  openrouter: [
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Fast" },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Reasoning" },
    { id: "openai/gpt-4o-mini", label: "GPT-4o Mini", hint: "Fast & Cheap" },
    { id: "openai/gpt-4o", label: "GPT-4o", hint: "Strong" },
    { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", hint: "Expert Writer" },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", hint: "Open Source" },
    { id: "deepseek/deepseek-chat", label: "DeepSeek Chat", hint: "DeepSeek V3" },
  ],
};

// Flat list for backward compatibility
export const MODELS: ModelOption[] = [
  ...PROVIDER_MODELS.lovable,
  ...PROVIDER_MODELS.gemini,
  ...PROVIDER_MODELS.openai,
  ...PROVIDER_MODELS.openrouter,
];

export const DEFAULT_MODEL = "google/gemini-2.5-flash";

