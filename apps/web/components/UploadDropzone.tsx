"use client";

import { useRef, useState } from "react";

function uploadViaAppServer(file: File, projectId: string, onProgress: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const form = new FormData();
    form.append("projectId", projectId);
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads/direct");
    xhr.timeout = 180_000;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const pct = Math.min(80, Math.max(5, Math.round((event.loaded / event.total) * 80)));
      onProgress(pct);
    };

    xhr.onload = () => {
      let body: any = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new Error(body?.error ?? `upload failed (${xhr.status})`));
    };

    xhr.onerror = () => reject(new Error("upload network error"));
    xhr.ontimeout = () => reject(new Error("upload timed out — try a shorter clip or stronger connection"));
    xhr.send(form);
  });
}

export default function UploadDropzone({
  projectId,
  onDone,
  demoMode = false,
  onDemoUpload,
}: {
  projectId: string;
  onDone: () => void;
  demoMode?: boolean;
  onDemoUpload?: (file: File, objectUrl: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setProgress(0);

    if (demoMode) {
      const objectUrl = URL.createObjectURL(file);
      setProgress(100);
      onDemoUpload?.(file, objectUrl);
      return;
    }

    try {
      await uploadViaAppServer(file, projectId, setProgress);
      onDone();
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setProgress(null);
    }
  }

  return (
    <div>
      <div
        className={`drop ${dragOver ? "active" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
      >
        {progress === null ? (
          <>drop your talking-head clip here, or click to pick one</>
        ) : progress < 100 ? (
          <>uploading… {progress}%</>
        ) : (
          <>upload complete · starting transcription…</>
        )}
        {progress !== null && (
          <div className="progress">
            <div style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      {error && <p className="status err" style={{ marginTop: 10 }}>{error}</p>}
    </div>
  );
}
