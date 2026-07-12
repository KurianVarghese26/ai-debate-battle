
## Goal

Retire the current colorful look. Rebuild the UI as a restrained, editorial "Paper & Ink" experience with Space Grotesk + DM Sans, and add a proper light/dark theme toggle (light by default).

## Design direction

- Palette: Paper & Ink — off-white paper `#f5f3ee`, warm border `#e8e4dd`, ink `#2d2d2d`, deep ink `#0d0d0d`. Dark mode inverts to ink background with paper foreground, keeping the same restrained feel (no purple/blue/pink accents anywhere).
- One accent only: deep ink (or paper in dark mode). No gradients, no glowing buttons, no rainbow model chips. Model/side identity communicated with typography weight, thin rules, and small serif labels — not color.
- Typography: Space Grotesk for headings/labels, DM Sans for body. Tight tracking on display sizes, generous line-height in bubbles.
- Layout: more whitespace, thin 1px borders, subtle paper texture on cards, quiet hover states, refined focus rings. Debate bubbles become editorial "columns" (LEFT / RIGHT labels above each turn), not colored chat balloons.

## Theme system

- Add a `ThemeProvider` (React context) that stores `theme: 'light' | 'dark'` in `localStorage` under `dom.theme` (default `light`) and toggles the `dark` class on `<html>`.
- SSR-safe: read storage inside `useEffect` after mount; render neutral until hydrated to avoid mismatch. No `typeof window` in a `useState` initializer.
- Header gets a `ThemeToggle` button (sun/moon lucide icons) next to existing controls.
- Rewrite `src/styles.css` `:root` and `.dark` tokens to the Paper & Ink values (background, foreground, card, border, muted, primary, ring). Every component uses semantic tokens — no hardcoded `text-white` / `bg-black` / hex values in JSX.

## Files to change

- `src/styles.css` — new token values for `:root` and `.dark`, register `--font-display` (Space Grotesk) and `--font-sans` (DM Sans) in `@theme`, remove any leftover colorful custom tokens.
- `src/routes/__root.tsx` — add Google Fonts `<link>` tags (preconnect + Space Grotesk + DM Sans), keep existing metadata.
- `src/components/theme-provider.tsx` (new) — context + hook, applies `.dark` class to `documentElement`.
- `src/components/theme-toggle.tsx` (new) — icon button using shadcn Button.
- `src/routes/index.tsx` — wrap page in `ThemeProvider`, mount `ThemeToggle` in the header, restyle: hero, controls panel, debate column, `TurnBubble`, buttons, and status chips using semantic tokens and the new type scale. Remove colorful side accents; replace with neutral "LEFT" / "RIGHT" serif labels and thin dividers.

## Out of scope

- No changes to `/api/turn`, `/api/speech`, `src/lib/tts.ts`, or debate logic. TTS behavior, streaming, and language handling stay exactly as they are.
- No new dependencies beyond Google Fonts via `<link>`.

## Verification

- Load `/` — confirm light mode renders in Paper & Ink with Space Grotesk headings.
- Click theme toggle — `<html>` gets `dark` class, colors invert cleanly, no flash of unstyled content on reload.
- Run a debate — bubbles, controls, and read-aloud button all use semantic tokens in both themes; no hardcoded colors remain.
