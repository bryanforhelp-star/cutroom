# cutroom — interface spec

The target UI across all phases. Bots implement toward this; each session builds only its slice. Design tokens already live in `apps/web/app/globals.css` — reuse them, don't invent new colors.

## design language
- **Palette:** ink `#0f1411` bg · panel `#161d19` · lines `#2a352f` · text `#e8ede9` / dim `#8fa198` · **pine `#4fa88a`** = the only accent (actions, kept, success) · **cut red `#c9564f`** = removed/errors only. Nothing else gets color.
- **Type:** system sans for content; mono (`--mono`) for anything machine-ish — timestamps, durations, statuses, clip counts. **All UI text lowercase.** Terse labels: "export mp4", not "Export your video".
- **Feel:** a tool, not a product. Dense, quiet, fast. No onboarding, no empty-state illustrations, no toasts stacking up. One accent, everything else disciplined.

## layout — desktop (≥1024px)

```
┌────────────────────────────────────────────────────────────────┐
│ toolbar   ▸ cutroom · project name        0:42 kept 1:15  [export mp4] │
├──────────────────┬──────────────────────────────┬──────────────┤
│                  │                              │              │
│   PREVIEW        │   TRANSCRIPT                 │   AI PANEL   │
│   9:16 player    │   striking words = cutting   │   chat       │
│   sticky, ~300px │   flexible width, scrolls    │   ~320px     │
│                  │                              │              │
│   ▶ 0:12 / 0:42  │   so today i'm ~~um~~ going  │   [apply ⟷   │
│                  │   to show you how i ~~like~~ │    suggest]  │
│                  │   built this...              │   ┌────────┐ │
│                  │                              │   │diff card│ │
│                  │                              │   └────────┘ │
│                  │                              │   [input___] │
├──────────────────┴──────────────────────────────┴──────────────┤
│ TIMELINE (phase 2) — one strip, ~120px, collapsible            │
│ [clip c1     ][c2      ][c3  ]        ← spoken spine (kept)    │
│    [lower-third]      [b-roll  ]      ← overlay track          │
│  ♪ music ──────────────────────       ← audio track            │
└────────────────────────────────────────────────────────────────┘
```

- Transcript is the primary surface and gets the space. Preview is sticky (stays visible while transcript scrolls).
- AI panel is collapsible (chevron). Collapsed by default until Phase 3 ships.
- Timeline is collapsible and appears only in Phase 2+.

**Mobile (<768px):** stacked — preview on top (sticky, smaller), transcript below, AI panel as a bottom sheet toggled from the toolbar, timeline hidden. Cutting on the phone must work: tap word = strike; long-press + drag = range.

## components

### toolbar (exists, extend)
`brand · project name` left · `duration kept + struck original` (mono, pine/dim) center-right · `[reset ghost] [export mp4]` right. During render the export button becomes `rendering…` disabled; on completion the download card appears (current behavior — keep).

### transcript panel (exists, extend in 1.5)
- Word states: **default** · **hover** (subtle bg) · **struck** (dim + red strikethrough — current) · **playing** (Phase 1.5: pine underline or bg on the word under the playhead).
- Click = toggle strike. Shift-click = range. (Phase 5: select + ⌫.)
- Paragraph breaks: insert a line break when the gap between consecutive words > 1.2s. Big readability win, ~5 lines of code.
- Filler emphasis (nice-to-have): render likely fillers (um, uh, like, "you know") with a subtle dotted underline so the eye finds them — never auto-strike.

### preview v1 (session 2)
- Native `<video>` (signed URL of the source), aspect box per project orientation.
- Plays the **cut**: on `timeupdate`, if currentTime enters a removed range, seek to the next kept clip's `in`. Derive ranges from the same `buildClipsFromWords` output — one logic source.
- Click a kept word → seek to `word.start`. Playhead position → highlight current word.
- Controls: play/pause (space), mono timecode `cut-time / kept-total` (map source→timeline time for display).
- Phase 2 swaps this for Remotion Player, same slot, same props — captions/overlays appear on top.

### AI panel (session 1)
- Header: `ai` + mode toggle, a two-option segmented control: **`apply`** / **`suggest`** (default suggest). Mono, small.
- Messages: user right-ish/plain, assistant left with pine tick prefix `▸`. All lowercase. Persisted per project.
- **Diff card** (assistant message variant when a patch needs approval):
  ```
  ┌──────────────────────────────────┐
  │ ▸ removed 7 filler segments (~9s)│
  │   clips 12 → 9 · −0:09           │
  │   [accept]  [reject]             │
  └──────────────────────────────────┘
  ```
  Human summary, not JSON. Numbers in mono. On accept: apply patch + sync strikethroughs. On reject: nothing, card dims.
- Applied-directly messages show the same summary line with a small `applied` tag instead of buttons.
- Input: single line, enter to send, disabled while a request is in flight with a `thinking…` status line.

### timeline (session 3)
- One horizontal strip, timeline-time x-axis. Three rows: **clips** (kept segments as pine-outlined blocks, gaps show cuts), **overlays** (draggable blocks: lower-thirds, b-roll), **audio** (music bar + sfx dots).
- Click a clip block → scroll transcript to it. Drag overlay edges = retime. That's it — no multi-track NLE ambitions; the transcript stays the cutting surface.

### caption controls (session 3)
- In the preview footer: captions on/off + preset picker (4 chips: `bold-bottom`, `karaoke`, `minimal`, `boxed`). Live in preview instantly (config-only change, no re-derive).

## states (project lifecycle)
| state | screen |
|---|---|
| created | drop zone (exists) |
| uploading | drop zone + progress bar (exists) |
| transcribing | status card, self-polls (exists) |
| ready | full editor |
| rendering | export button → `rendering…`; everything else stays interactive |
| render done | download card: `render done · 9 clips · 0:42` + `[download mp4]` (exists) |
| error | red status line with the actual error string. errors never apologize, never vague |

## interaction principles
- Every action's result is visible where you did it (strike a word → duration updates in the toolbar; accept a diff → strikethroughs move).
- Nothing modal except accept/reject on a diff card. No confirmations for reversible things — reset is one click because striking is one click.
- Keyboard (Phase 5): `space` play/pause · `⌫` strike selection · `⌘z` undo strike · `e` export.
- Quality floor: visible focus rings (exists), reduced-motion respected (exists), works at 380px wide.
