
# AI vs AI Debate Arena

A single-page app where two AI agents (each with a user-chosen model + custom personality) debate or discuss a piece of content the user provides. The conversation streams back and forth freely until the user hits stop.

## Core UX

- **Split-screen layout**: left side = Agent A, right side = Agent B. Center column = the shared "topic/content" input and the streaming conversation transcript.
- **Per side, user configures**:
  - Display name
  - Model (dropdown of all Lovable AI chat models — Gemini 3 Flash, Gemini 3.1 Flash Lite, Gemini 3.5 Flash, Gemini 3.1 Pro, Gemini 2.5 Pro/Flash/Flash-Lite, GPT-5, GPT-5 mini, GPT-5 nano, GPT-5.2, GPT-5.4 family, GPT-5.5)
  - Character/personality (free-text textarea, e.g. "sarcastic economist who loves puns")
- **Topic input**: big textarea for the content/topic to discuss.
- **Controls**: Start, Stop, Reset. While running, "Stop" is prominent. New turns append live with streaming text.
- **Transcript**: chat-style messages, colored/badged by side, showing which model + persona spoke. Auto-scroll to bottom.

## Conversation Loop

Free-flow: after the user hits Start, the app alternates turns A → B → A → B... Each turn calls the Lovable AI Gateway with:
- system prompt built from that side's persona + the shared topic + "you are debating <other side name>"
- full running transcript as prior messages (mapping the *other* side's turns to `user` role and this side's turns to `assistant` role, so the model sees a normal chat history)

Streaming via AI SDK `streamText` through a TanStack server route (`/api/turn`). Client loops: after each turn finishes streaming, if not stopped, it fires the next turn for the other side. Stop button sets a flag that breaks the loop and aborts the in-flight stream.

## Persistence (LocalStorage)

- One "current setup" saved (both sides' name/model/persona + last topic) so refresh keeps config.
- Debate history: list of past debates `{ id, topic, sideA, sideB, messages, createdAt }` in a sidebar/drawer. Click to view read-only transcript. Delete per item and "clear all".
- No accounts, no Cloud.

## Design Direction

Since the user hasn't specified visuals, I'll generate 3 design directions (dark arena / editorial split / playful chat) via `design--create_directions` before building, so they pick the look.

## Technical Details

- Stack: existing TanStack Start + Tailwind v4 + shadcn (already set).
- Server route: `src/routes/api/turn.ts` — POST `{ model, system, messages }` → streaming text response using `@ai-sdk/openai-compatible` + Lovable AI Gateway helper (`src/lib/ai-gateway.server.ts`).
- Client: `src/routes/index.tsx` becomes the arena. Uses `fetch` with a `ReadableStream` reader for streaming (simpler than `useChat` since we drive two alternating agents manually) and an `AbortController` for Stop.
- LocalStorage hooks: `useLocalStorage` for config + debate history.
- Model list: constant array in `src/lib/models.ts` matching the Lovable AI chat catalog.
- Lovable AI enabled + `LOVABLE_API_KEY` provisioned via `ai_gateway--create`.
- Head metadata: real title/description for the arena on `__root.tsx`.

## Out of Scope

- Accounts, database, sharing links, exporting transcripts, voice, images.
- Judge/scoring AI (can add later if requested).
