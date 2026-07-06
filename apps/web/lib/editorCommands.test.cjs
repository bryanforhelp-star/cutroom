const test = require('node:test');
const assert = require('node:assert/strict');
const commands = require('/tmp/cutroom-editorCommands/editorCommands.js');

const words = [
  { word: 'hello', start: 0, end: 0.4 },
  { word: 'um', start: 0.5, end: 0.7 },
  { word: 'world', start: 0.8, end: 1.2 },
  { word: 'pause', start: 2.4, end: 2.8 },
];

const assemblyWords = [
  { word: 'today', start: 0, end: 0.2 },
  { word: 'we', start: 0.2, end: 0.3 },
  { word: 'start', start: 0.3, end: 0.5 },
  { word: 'with', start: 0.5, end: 0.7 },
  { word: 'proof', start: 0.7, end: 1.0 },
  { word: 'then', start: 4.0, end: 4.2 },
  { word: 'the', start: 4.2, end: 4.3 },
  { word: 'hook', start: 4.3, end: 4.8 },
  { word: 'goes', start: 4.8, end: 5.0 },
  { word: 'first', start: 5.0, end: 5.3 },
  { word: 'finally', start: 8.0, end: 8.4 },
  { word: 'buy', start: 8.4, end: 8.8 },
  { word: 'now', start: 8.8, end: 9.1 },
];

test('timeline cut command removes words inside source time range', () => {
  const state = commands.createInitialEditState(words, new Set());
  const next = commands.applyEditCommand(state, { type: 'cut_range', sourceStart: 0.45, sourceEnd: 0.75 });
  assert.deepEqual([...next.removedWordIndexes], [1]);
});

test('filler command removes known filler words', () => {
  const state = commands.createInitialEditState(words, new Set());
  const next = commands.applyEditCommand(state, { type: 'remove_fillers' });
  assert.deepEqual([...next.removedWordIndexes], [1]);
});

test('AI command model can add transitions overlays and keyframe zooms', () => {
  let state = commands.createInitialEditState(words, new Set([1]));
  state = commands.applyEditCommand(state, { type: 'add_transition', afterClipId: 'c1', transition: 'crossfade', duration: 0.18 });
  state = commands.applyEditCommand(state, { type: 'add_text_overlay', text: 'wait for this', start: 0, end: 1, position: 'bottom-center', preset: 'bold' });
  state = commands.applyEditCommand(state, { type: 'add_zoom_keyframes', clipId: 'c1', keyframes: [{ at: 0, scale: 1 }, { at: 0.8, scale: 1.12, x: 0.5, y: 0.42 }] });

  assert.equal(state.transitions[0].type, 'crossfade');
  assert.equal(state.overlays[0].text, 'wait for this');
  assert.equal(state.keyframes[0].property, 'zoom');
});

test('script assembly parses labeled sections', () => {
  const sections = commands.parseScriptSections('hook: the hook goes first\nproof: start with proof');
  assert.deepEqual(sections, [
    { label: 'hook', text: 'the hook goes first' },
    { label: 'proof', text: 'start with proof' },
  ]);
});

test('assemble_from_script finds source moments and reorders clips to script order', () => {
  let state = commands.createInitialEditState(assemblyWords, new Set());
  state = commands.applyEditCommand(state, {
    type: 'assemble_from_script',
    script: 'hook: the hook goes first\nproof: start with proof\ncta: buy now',
  });

  assert.deepEqual(state.scriptSections.map((s) => s.label), ['hook', 'proof', 'cta']);
  assert.equal(state.clips[0].in, 4.2);
  assert.equal(state.clips[1].in, 0.3);
  assert.equal(state.clips[2].in, 8.4);
  assert.deepEqual([...state.removedWordIndexes], [0, 1, 5, 10]);
});

test('create_clip_from_words and reorder_clips allow AI to build a custom timeline', () => {
  let state = commands.createInitialEditState(assemblyWords, new Set());
  state = commands.applyEditCommand(state, { type: 'create_clip_from_words', wordStartIndex: 0, wordEndIndex: 4, label: 'proof' });
  state = commands.applyEditCommand(state, { type: 'create_clip_from_words', wordStartIndex: 6, wordEndIndex: 9, label: 'hook' });
  state = commands.applyEditCommand(state, { type: 'reorder_clips', clipIds: ['clip_s2', 'clip_s1'] });

  assert.deepEqual(state.clips.map((c) => c.id).slice(0, 2), ['clip_s2', 'clip_s1']);
});
