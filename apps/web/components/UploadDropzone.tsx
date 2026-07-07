"use client";

import { useRef, useState } from "react";

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
      setProgress(8);
      const signRes = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, fileName: file.name }),
      });
      const signed = await signRes.json();
      if (!signRes.ok) throw new Error(signed.error ?? "could not prepare upload");

      setProgress(25);
      const uploadForm = new FormData();
      uploadForm.append("cacheControl", "3600");
      uploadForm.append("", file);
      const uploadRes = await fetch(signed.signedUrl, {
        method: "PUT",
        headers: { "x-upsert": "true" },
        body: uploadForm,
      });
      if (!uploadRes.ok) {
        const uploadText = await uploadRes.text().catch(() => "");
        throw new Error(uploadText || `upload failed (${uploadRes.status})`);
      }

      setProgress(85);
      const completeRes = await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, path: signed.path }),
      });
      const completed = await completeRes.json();
      if (!completeRes.ok) throw new Error(completed.error ?? "upload did not finish");

      setProgress(100);
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
        ) : (
          <>uploading… {progress}%</>
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
