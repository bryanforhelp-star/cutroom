"use client";

import { useState, type PointerEvent } from "react";
import type { Clip, Word } from "@/lib/edl";
import type { ClipKeyframes, ScriptSection, TimelineOverlay } from "@/lib/editorCommands";

function pct(n: number, total: number) {
  if (!total) return "0%";
  return `${Math.max(0, Math.min(100, (n / total) * 100))}%`;
}

function timelineTimeFromEvent(e: PointerEvent<HTMLDivElement>, total: number) {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  return (x / rect.width) * total;
}

type TimelineProps = {
  words: Word[];
  clips: Clip[];
  playT: number;
  overlays: TimelineOverlay[];
  keyframes: ClipKeyframes[];
  scriptSections: ScriptSection[];
  onSeek: (sourceTime: number) => void;
  onCutRange: (sourceStart: number, sourceEnd: number) => void;
  onAddTransition: (afterClipId: string) => void;
  onAddOverlay: () => void;
  onAddZoom: (clipId: string) => void;
};

export default function Timeline({
  words,
  clips,
  playT,
  overlays,
  keyframes,
  scriptSections,
  onSeek,
  onCutRange,
  onAddTransition,
  onAddOverlay,
  onAddZoom,
}: TimelineProps) {
  const total = words.length ? words[words.length - 1].end : 0;
  const [dragStart, setDragStart] = useTimelineDrag();
  const [dragEnd, setDragEnd] = useTimelineDrag();
  const hasSelection = dragStart !== null && dragEnd !== null && Math.abs(dragEnd - dragStart) > 0.04;
  const sectionByClip = new Map(scriptSections.map((s) => [s.clipId, s]));
  const selA = hasSelection ? Math.min(dragStart!, dragEnd!) : 0;
  const selB = hasSelection ? Math.max(dragStart!, dragEnd!) : 0;

  return (
    <section className="timeline-panel" aria-label="timeline editor">
      <div className="timeline-head">
        <span>timeline</span>
        <div className="row">
          <button className="ghost small" onClick={onAddOverlay}>+ overlay</button>
          {clips[0] && <button className="ghost small" onClick={() => onAddZoom(clips[0].id)}>+ zoom</button>}
        </div>
      </div>

      <div
        className="timeline-ruler"
        onPointerDown={(e) => {
          const t = timelineTimeFromEvent(e, total);
          setDragStart(t);
          setDragEnd(t);
          onSeek(t);
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragStart === null) return;
          setDragEnd(timelineTimeFromEvent(e, total));
        }}
        onPointerUp={(e) => {
          if (dragStart !== null && dragEnd !== null && Math.abs(dragEnd - dragStart) <= 0.04) {
            onSeek(timelineTimeFromEvent(e, total));
          }
          (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        }}
      >
        <div className="timeline-row clips-row">
          {clips.map((clip, i) => (
            <div
              key={clip.id}
              className="clip-block"
              style={{ left: pct(clip.in, total), width: pct(clip.out - clip.in, total) }}
              title={`${clip.id}: ${clip.in.toFixed(2)} → ${clip.out.toFixed(2)}`}
              onDoubleClick={() => onAddTransition(clip.id)}
            >
              <span>{sectionByClip.get(clip.id)?.label ?? clip.id}</span>
              {i < clips.length - 1 && <button className="transition-dot" onClick={(e) => { e.stopPropagation(); onAddTransition(clip.id); }}>+</button>}
            </div>
          ))}
        </div>

        <div className="timeline-row overlay-row">
          {overlays.map((o) => (
            <div key={o.id} className="overlay-block" style={{ left: pct(o.start, total), width: pct(o.end - o.start, total) }}>
              {o.text}
            </div>
          ))}
        </div>

        <div className="timeline-row keyframe-row">
          {keyframes.flatMap((track) => track.keyframes.map((k, i) => (
            <span key={`${track.id}-${i}`} className="keyframe-dot" style={{ left: pct(k.at, total) }} title={`zoom ${k.scale.toFixed(2)}x`} />
          )))}
        </div>

        <div className="playhead" style={{ left: pct(playT, total) }} />
        {hasSelection && <div className="timeline-selection" style={{ left: pct(selA, total), width: pct(selB - selA, total) }} />}
      </div>

      <div className="timeline-actions">
        <span className="hint">drag a range then cut · double-click a clip edge for transition</span>
        <button className="small" disabled={!hasSelection} onClick={() => {
          onCutRange(selA, selB);
          setDragStart(null);
          setDragEnd(null);
        }}>cut range</button>
      </div>
    </section>
  );
}

function useTimelineDrag(): [number | null, (v: number | null) => void] {
  return useState<number | null>(null);
}
