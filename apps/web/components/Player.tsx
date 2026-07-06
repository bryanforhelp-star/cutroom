"use client";

import { useEffect, useRef } from "react";
import type { Clip } from "@/lib/edl";
import { fmtTime, keptDuration } from "@/lib/edl";

/** Plays the CUT: skips removed ranges during playback. Clips are source time. */
export default function Player({
  src,
  clips,
  seek, // { t: sourceTime, nonce } — change nonce to trigger a seek
  onTime, // reports current SOURCE time ~4x/sec
}: {
  src: string;
  clips: Clip[];
  seek: { t: number; nonce: number } | null;
  onTime: (sourceTime: number) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const clipsRef = useRef(clips);
  clipsRef.current = clips;

  useEffect(() => {
    if (seek && ref.current) {
      ref.current.currentTime = seek.t;
      ref.current.play().catch(() => {});
    }
  }, [seek]);

  function handleTime() {
    const v = ref.current;
    if (!v) return;
    const t = v.currentTime;
    onTime(t);
    const cs = clipsRef.current;
    if (!cs.length) return;
    const inClip = cs.some((c) => t >= c.in && t < c.out);
    if (inClip) return;
    const next = cs.find((c) => c.in > t);
    if (next) v.currentTime = next.in + 0.01;
    else {
      v.pause();
      v.currentTime = cs[0].in;
    }
  }

  // start playback at the first kept clip
  function handleLoaded() {
    const v = ref.current;
    const cs = clipsRef.current;
    if (v && cs.length && v.currentTime < cs[0].in) v.currentTime = cs[0].in;
  }

  return (
    <div className="player">
      <video
        ref={ref}
        src={src}
        onTimeUpdate={handleTime}
        onLoadedMetadata={handleLoaded}
        controls
        playsInline
        preload="metadata"
      />
      <div className="player-meta">
        <span className="status">preview plays the cut · {fmtTime(keptDuration(clips))} total</span>
      </div>
    </div>
  );
}

/** Map a source timestamp to timeline (post-cut) time. */
export function sourceToTimeline(t: number, clips: Clip[]): number {
  let acc = 0;
  for (const c of clips) {
    if (t < c.in) return acc;
    if (t < c.out) return acc + (t - c.in);
    acc += c.out - c.in;
  }
  return acc;
}
