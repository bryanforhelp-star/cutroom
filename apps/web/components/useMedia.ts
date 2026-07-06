"use client";

import { useEffect, useState } from "react";

/** Extract filmstrip thumbnails from the source video (client-side, progressive). */
export function useThumbnails(src: string | null) {
  const [thumbs, setThumbs] = useState<{ t: number; url: string }[]>([]);
  const [interval, setIntervalS] = useState(1);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.src = src;

    const seekTo = (t: number) =>
      new Promise<void>((res) => {
        const done = () => { video.removeEventListener("seeked", done); res(); };
        video.addEventListener("seeked", done);
        video.currentTime = t;
        setTimeout(done, 1500); // never hang on a stubborn seek
      });

    (async () => {
      await new Promise<void>((res, rej) => {
        video.onloadedmetadata = () => res();
        video.onerror = () => rej(new Error("video load failed"));
      });
      const dur = video.duration;
      const iv = Math.max(0.75, dur / 48); // ~48 frames across the source
      setIntervalS(iv);
      const h = 56;
      const w = Math.max(16, Math.round(h * (video.videoWidth / Math.max(1, video.videoHeight))));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const out: { t: number; url: string }[] = [];
      for (let t = iv / 2; t < dur; t += iv) {
        if (cancelled) return;
        await seekTo(Math.min(t, dur - 0.05));
        try {
          ctx.drawImage(video, 0, 0, w, h);
          out.push({ t, url: canvas.toDataURL("image/jpeg", 0.5) });
        } catch {
          return; // CORS-tainted canvas — bail silently, blocks render plain
        }
        if (out.length % 6 === 0) setThumbs([...out]); // paint progressively
      }
      if (!cancelled) setThumbs(out);
    })().catch(() => {});

    return () => {
      cancelled = true;
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);

  return { thumbs, interval };
}

/** Decode the source audio into waveform peaks (client-side). */
export function useWaveform(src: string | null) {
  const [wave, setWave] = useState<{ peaks: Float32Array; duration: number } | null>(null);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    (async () => {
      const buf = await (await fetch(src)).arrayBuffer();
      const AC: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const ac = new AC();
      try {
        const audio = await ac.decodeAudioData(buf);
        const ch = audio.getChannelData(0);
        const buckets = 1600;
        const per = Math.max(1, Math.floor(ch.length / buckets));
        const peaks = new Float32Array(buckets);
        for (let i = 0; i < buckets; i++) {
          let m = 0;
          const s = i * per;
          const e = Math.min(ch.length, s + per);
          for (let j = s; j < e; j += 32) {
            const v = Math.abs(ch[j]);
            if (v > m) m = v;
          }
          peaks[i] = m;
        }
        // normalize so quiet recordings still show shape
        let max = 0;
        for (let i = 0; i < buckets; i++) if (peaks[i] > max) max = peaks[i];
        if (max > 0) for (let i = 0; i < buckets; i++) peaks[i] /= max;
        if (!cancelled) setWave({ peaks, duration: audio.duration });
      } finally {
        ac.close();
      }
    })().catch(() => {}); // no waveform is fine — timeline degrades gracefully
    return () => { cancelled = true; };
  }, [src]);

  return wave;
}
