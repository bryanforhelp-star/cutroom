"use client";

import { useEffect, useRef } from "react";
import type { Clip } from "@/lib/edl";
import { keptDuration, fmtTime } from "@/lib/edl";
import { sourceToTimeline } from "./Player";
import { useThumbnails, useWaveform } from "./useMedia";

/** Map timeline (post-cut) time back to source time. */
export function timelineToSource(t: number, clips: Clip[]): number {
  let acc = 0;
  for (const c of clips) {
    const d = c.out - c.in;
    if (t < acc + d) return c.in + (t - acc);
    acc += d;
  }
  return clips.length ? clips[clips.length - 1].out : 0;
}

function ClipWave({
  wave,
  cin,
  cout,
}: {
  wave: { peaks: Float32Array; duration: number } | null;
  cin: number;
  cout: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !wave) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = cv.offsetWidth, h = cv.offsetHeight;
      if (!w || !h) return;
      cv.width = w * dpr;
      cv.height = h * dpr;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(27,43,255,0.6)";
      const n = Math.max(1, Math.floor(w / 3));
      for (let i = 0; i < n; i++) {
        const t = cin + ((i + 0.5) / n) * (cout - cin);
        const idx = Math.min(wave.peaks.length - 1, Math.max(0, Math.floor((t / wave.duration) * wave.peaks.length)));
        const bh = Math.max(1, wave.peaks[idx] * (h - 2));
        ctx.fillRect(i * 3, h - bh - 1, 2, bh);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [wave, cin, cout]);
  return <canvas ref={ref} className="tl-wave" />;
}

/**
 * Editor timeline, CapCut/Premiere-style: filmstrip thumbnails + audio waveform
 * inside each clip block, seams at cut points, cuts ripple closed.
 * click = jump · drag range + delete = cut · playhead tracks playback.
 */
export default function Timeline({
  clips,
  videoSrc,
  playSourceT,
  sel,
  onSel,
  onSeek,
}: {
  clips: Clip[];
  videoSrc: string | null;
  playSourceT: number;
  sel: [number, number] | null;
  onSel: (s: [number, number] | null) => void;
  onSeek: (sourceT: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; moved: boolean } | null>(null);
  const { thumbs, interval } = useThumbnails(videoSrc);
  const wave = useWaveform(videoSrc);
  const total = keptDuration(clips);
  if (!clips.length || total <= 0) return null;

  function tlFromEvent(e: React.PointerEvent): number {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width);
    return (x / r.width) * total;
  }
  function down(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { start: tlFromEvent(e), moved: false };
    onSel(null);
  }
  function move(e: React.PointerEvent) {
    if (!drag.current) return;
    const t = tlFromEvent(e);
    if (Math.abs(t - drag.current.start) > total * 0.004) {
      drag.current.moved = true;
      onSel([Math.min(drag.current.start, t), Math.max(drag.current.start, t)]);
    }
  }
  function up(e: React.PointerEvent) {
    if (!drag.current) return;
    if (!drag.current.moved) {
      onSel(null);
      onSeek(timelineToSource(tlFromEvent(e), clips));
    }
    drag.current = null;
  }

  const playheadPct = (sourceToTimeline(playSourceT, clips) / total) * 100;

  let acc = 0;
  const blocks = clips.map((c) => {
    const d = c.out - c.in;
    const b = { clip: c, dur: d, left: (acc / total) * 100, width: (d / total) * 100 };
    acc += d;
    return b;
  });

  return (
    <div className="timeline-row">
      <div ref={ref} className="timeline" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        {blocks.map((b, i) => (
          <div
            key={b.clip.id}
            className={`tl-clip ${i === 0 ? "first" : ""} ${i === blocks.length - 1 ? "last" : ""}`}
            style={{ left: `${b.left}%`, width: `${b.width}%` }}
          >
            <div className="tl-head">{b.width > 7 && <span>{fmtTime(b.dur)}</span>}</div>
            <div className="tl-film">
              {thumbs
                .filter((th) => th.t >= b.clip.in - interval / 2 && th.t < b.clip.out)
                .map((th) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={th.t}
                    src={th.url}
                    alt=""
                    draggable={false}
                    style={{
                      left: `${(Math.max(0, th.t - interval / 2 - b.clip.in) / b.dur) * 100}%`,
                      width: `${(interval / b.dur) * 100}%`,
                    }}
                  />
                ))}
            </div>
            <ClipWave wave={wave} cin={b.clip.in} cout={b.clip.out} />
          </div>
        ))}
        {sel && (
          <div
            className="tl-sel"
            style={{ left: `${(sel[0] / total) * 100}%`, width: `${((sel[1] - sel[0]) / total) * 100}%` }}
          />
        )}
        <div className="tl-playhead" style={{ left: `${playheadPct}%` }} />
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        drag to select, delete to cut · click to jump · seams are cut points
      </p>
    </div>
  );
}
