"use client";

import { useRef, useState } from "react";

export type UploadResult = {
  status: "transcribing";
  videoUrl?: string | null;
};

/** Upload straight to Supabase (bypasses Vercel's ~4.5MB body limit). */
function uploadViaSignedUrl(
  file: File,
  projectId: string,
  onProgress: (progress: number) => void
): Promise<UploadResult> {
  return new Promise(async (resolve, reject) => {
    try {
      onProgress(5);
      const signRes = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, fileName: file.name }),
      });
      const signBody = await signRes.json();
      if (!signRes.ok || !signBody.signedUrl) {
        reject(new Error(signBody.error ?? "could not start upload"));
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open("PUT", signBody.signedUrl);
      xhr.timeout = 300_000;
      if (file.type) xhr.setRequestHeader("content-type", file.type);
      xhr.setRequestHeader("x-upsert", "true");

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        // 5–90% = bytes to storage
        const pct = Math.min(90, Math.max(5, Math.round(5 + (event.loaded / event.total) * 85)));
        onProgress(pct);
      };

      xhr.onload = async () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`storage upload failed (${xhr.status})`));
          return;
        }
        onProgress(95);
        try {
          const completeRes = await fetch("/api/uploads/complete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId, path: signBody.path }),
          });
          const completeBody = await completeRes.json();
          if (!completeRes.ok) {
            reject(new Error(completeBody.error ?? "upload finalize failed"));
            return;
          }
          onProgress(100);
          resolve({
            status: "transcribing",
            videoUrl: completeBody.videoUrl ?? null,
          });
        } catch (err: any) {
          reject(new Error(String(err?.message ?? err)));
        }
      };

      xhr.onerror = () => reject(new Error("upload network error"));
      xhr.ontimeout = () => reject(new Error("upload timed out — try a shorter clip or stronger connection"));
      xhr.send(file);
    } catch (err: any) {
      reject(new Error(String(err?.message ?? err)));
    }
  });
}

export default function UploadDropzone({
  projectId,
  onComplete,
  demoMode = false,
  onDemoUpload,
  compact = false,
}: {
  projectId: string;
  onComplete: (result: UploadResult) => void;
  demoMode?: boolean;
  onDemoUpload?: (file: File, objectUrl: string) => void;
  compact?: boolean;
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
      onComplete({ status: "transcribing", videoUrl: objectUrl });
      return;
    }

    try {
      const result = await uploadViaSignedUrl(file, projectId, setProgress);
      onComplete(result);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setProgress(null);
    }
  }

  return (
    <div>
      <div
        className={`drop ${compact ? "compact" : ""} ${dragOver ? "active" : ""}`}
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
