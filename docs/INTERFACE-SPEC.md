# cutroom — interface spec (v2, light)

Design direction locked by Kyndall: **a notes app that edits video.** Light, paper,
quiet. Not a tool, not a terminal, not "computerized." Descript is the reference.

## design language
- **Surface:** white `#ffffff`. Hairlines `#ececea`. No dark theme, no cards where a hairline will do.
- **Text:** near-black `#1c1c1c` · dim `#a0a09b` · faint `#c9c9c4`.
- **One accent:** royal blue `#1B2BFF` (her brand blue). Used ONLY for: export button, playhead word highlight, selection tint, send arrow. Nothing else gets color.
- **Struck words:** gray `#b8b8b3` with a thin gray line-through — like edits in a doc. NEVER red.
- **Type:** system sans everywhere, including timestamps. NO monospace anywhere — mono reads "computerized." Transcript 18px / 2.05 line-height, max-width 660.
- **All UI text lowercase**, terse. Buttons are words, not commands ("export", "undo").
- **No** pills, badges, terminal glyphs (▸), status chrome, or gratuitous borders.

## editing model (locked — do not add interactions)
- **Highlight text → press delete** = cut. Delete on already-struck text = restore. That is the entire cutting interface. No cut buttons, no pills, no context menus.
- **Click a word** → video jumps there.
- **⌘Z** → undo (every edit, including script match, goes through one history stack).
- Playhead word gets a soft blue highlight; fillers get a faint dotted underline (hint only).

## layout
Toolbar (sticky, hairline-bottom): `‹ cutroom · project name` left · `kept ~~original~~ · undo · export` right.
Grid: player left (300px, sticky, rounded-14 video, centered gray timecode under) · transcript right as a document with paragraph breaks at >1.2s pauses. One faint hint line under the transcript.

## AI panel (Phase 3 — build to this)
A plain chat, like texting. Right-hand column (~300px, hairline-left divider) or a
bottom sheet on mobile.
- **Bubbles:** user = blue `#1B2BFF`, white text, right-aligned, radius 14/14/4/14.
  assistant = light gray `#f2f2f0`, dark text, left-aligned, radius 14/14/14/4.
  13px, soft, generous padding. (Telegram convention: you on the right.)
- **Edits are conversational, not machinery.** When the AI makes/proposes an edit, the
  assistant bubble says it in plain words: "done — cut 2 retakes, saved 8 seconds."
  In suggest mode, two small text links inside the bubble: `apply · dismiss`. No diff
  tables, no JSON, no patch summaries, no mono.
- **Mode:** apply-directly vs suggest lives as one small text toggle at the top of the
  panel ("asks first / just does it") — not a segmented control.
- **Input:** single rounded field, placeholder "message", blue up-arrow send. Enter sends.
- Transcript strikethroughs update live when an edit lands — the doc is the diff.

## states
created → dropzone · uploading → thin progress line · transcribing → one quiet
sentence, self-polls · ready → editor · rendering → export shows "rendering…" ·
done → small card: "done · 0:29" + download · error → one plain sentence, `#c25e50`.

## principles
The transcript is the interface. Everything else defers to it. When in doubt: remove
the element, lighten the color, use a word instead of a control.
