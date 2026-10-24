# TACTIX design system

## Concept

The moment is the page. TACTIX drops you onto a touchline at a real minute of a real match, and every screen is built like a tactics board on matchday paper: a calm cream page, ink outlines, a soft-green pitch panel where the game happens, and one loud yellow action. Gumroad-style friendliness (bold type, thick outlines, rounded components, a lift on anything you can press) carries the interface. Football carries the details: a broadcast score bug, chalk lines, kit-number tokens, a rubber-stamp verdict. Data is drawn from real StatsBomb coordinates and is never decorated into claims the engine hasn't made.

## Palette

All values live as tokens in `frontend/src/index.css` (`@theme`). Ink and vermilion come from the TACTIX mark.

| Token | Hex | Role |
| --- | --- | --- |
| `cream` | `#FBF0D9` | Page ground |
| `cream-deep` | `#F3E3BF` | Quiet fills, skeletons, inactive headers |
| `paper` | `#FFFAF0` | Raised panels and cards |
| `ink` | `#14161F` | Text, 2px outlines, score bug |
| `ink-soft` | `#464957` | Secondary text (7.9:1 on cream) |
| `vermilion` | `#FF5A36` | The opponent, danger, the minute tag |
| `vermilion-deep` | `#C93A1A` | Vermilion text and risk marks on light grounds |
| `yellow` | `#FFD23F` | The one primary action per view, selection, the stamp |
| `sky` | `#7CC8FF` | You: the side you manage |
| `sky-deep` | `#2F7FC0` | Focus rings, sky strokes on light grounds |
| `pitch` | `#8CC57E` | Soft, sun-washed turf |
| `pitch-stripe` | `#80BB72` | Mown stripes |
| `pitch-deep` | `#3F7A3A` | Positive text on light grounds |
| `chalk` | `#F8FFF2` | Pitch markings, label halos |

### Kit colours

Players wear their team's kit (`frontend/src/lib/kits.ts`): the shirt colour is the token fill, the number colour is the text.

| Team | Shirt | Number |
| --- | --- | --- |
| Argentina | `#6CC4EE` | `#14161F` |
| France | `#1D2E6B` | `#FFFFFF` |
| Croatia | `#D9241C` | `#FFFFFF` |
| England | `#F7F5EE` | `#14161F` |
| Italy | `#1F66C6` | `#FFFFFF` |
| Spain | `#AD0F26` | `#FFD23F` |

Unknown teams fall back to sky (home) and vermilion (away). Containers set `--kit-you`, `--kit-you-ink`, `--kit-them` and `--kit-them-ink` with `kitVars()`; on the game board "you" is the side you manage, in Analyst Mode it is the home side.

Rules:
- **Team colour is never the only cue.** Your tokens are circles and theirs are rounded squares; the key threat carries a ring and a name; goals are filled with a centre dot while misses are open rings; every mark keeps an ink outline so light kits (England's white) read on grass.
- Sky and vermilion remain brand colours (vermilion also means danger: threat hatching, the minute tag).
- Yellow appears on one primary action per view, plus selection.
- Vermilion over green is drawn as opaque hatching, never as a translucent fill (it turns brown).
- Never a win-probability number or invented statistic. A `?` placeholder is allowed.

## Type

- **Schibsted Grotesk Variable** (self-hosted, wght 400–900) for all words. Headlines run at weight 800–850 with tracking −0.025em and balanced wrapping.
- **Anybody Variable** (self-hosted, wdth 50–150) for numbers only: scorelines, the clock, kit numbers, ratings. `.score` is expanded 140% at weight 850. `.score-narrow` is condensed 75% at weight 800.

| Token | Size | Use |
| --- | --- | --- |
| `--text-hero` | `clamp(2.6rem, 1.4rem + 3.6vw, 4.6rem)`, leading 0.98 | Home headline |
| `--text-lede` | `clamp(1.15rem, 1rem + 0.5vw, 1.45rem)`, leading 1.35 | Hook line, subheads |
| `--text-body` | `1.125rem` (18px), leading 1.55 | Body copy on Persuade surfaces |
| `text-sm` | `0.875rem` | Captions, metadata only |

Measure: 65ch maximum for body copy, 22ch for headlines.

## Layout

- Content width is 1320px with gutters of 16px (mobile) and 24px (sm and up).
- **Home, desktop:** a 5/12 column for the story (headline, hook, primary action, side toggle, rating stamp) and a 7/12 pitch panel. A full-width tactic dock sits underneath. Everything is visible at 1440×900 and 1280×720.
- **Home, mobile:** story first, then a portrait pitch, then "Make the call". The tactic dock sticks to the bottom of the hero with safe-area padding, and its targets are at least 48px.
- Pitches are portrait (own goal at the bottom, attacking up) on the home screen and on narrow viewports. The game board is landscape from 640px up.
- One spacing rhythm, in steps of 4px. Sections are separated by 64–96px, with more space above a heading than below it.
- **Radii:** 999px for pills and toggles, 10px for controls, 12px for cards, 14px for panels.

## Components

- **Score bug:** ink capsule with team codes on sky and vermilion, the score on cream, a yellow condensed clock, and a status tag (`PAUSED`, `LIVE`).
- **Tactic card:** paper card with an ink outline and a drawn chalkboard glyph. It lifts on hover or focus, and turns yellow when chosen or previewed.
- **Token:** kit number set in Anybody condensed. Yours are sky circles; theirs are vermilion rounded squares. The key threat is larger, with a pulsing ring and a name label. Other labels appear only for the players the scene is about.
- **Display collision pass:** tokens are nudged apart for drawing only, in a few deterministic iterations. The engine always receives the original coordinates.
- **Lift:** `translate(-3px, -3px)` plus a 4px ink shadow on hover and focus of interactive elements only. Never on static panels.

## Motion

- Transform and opacity only (plus SVG `stroke-dashoffset` for drawn lines). Durations are 150–600ms with a single easing, `--ease-glide` (`cubic-bezier(0.22, 1, 0.36, 1)`).
- **Home moments:**
  - one staggered load reveal (story, pitch, dock);
  - the threat's ring pulse and a run arrow that draws once;
  - tokens gliding into a tactic preview over 500ms;
  - the Lock-it-in button entering.
- **Game moments:**
  - tokens spring on shape changes;
  - the verdict stamp lands once.
- No parallax, tilt, confetti, sound, autoplay, scroll hijacking or countdowns. The clock stays paused until the user commits.
- Everything is off under `prefers-reduced-motion`: content appears in place and "Make the call" just moves focus.

## Accessibility

- WCAG 2.2 AA: 18px body text on Persuade surfaces, and a visible 3px sky-deep focus ring with offset on every interactive element.
- Pitches expose a text description of the scene and a list of players with their positions in words.
- The full flow works by keyboard: cards are focusable, Enter previews and a second action locks in.
