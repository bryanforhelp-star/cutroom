"use client";

import { useRef, useState } from "react";
import { supabase, BUCKET } from "@/lib/supabase";

const MAX_DIRECT_UPLOAD = 50 * 1024 * 1024; // temporary smoke-test limit; avoids auth-only TUS path

export default function UploadDropzone({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setProgress(0);
    const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
    const path = `${projectId}/source.${ext}`;

    try {
      if (file.size > MAX_DIRECT_UPLOAD) {
        throw new Error("clip is over 50mb. use a shorter/smaller clip for this smoke test while resumable auth is off.");
      }
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || "video/mp4", upsert: true });
      if (upErr) throw new Error(upErr.message);
      setProgress(100);

      // register asset + flip project to transcribing — the worker takes it from here
      const { data: asset, error: aErr } = await supabase
        .from("assets")
        .insert({ project_id: projectId, kind: "source", storage_path: path })
        .select("id")
        .single();
      if (aErr || !asset) throw new Error(aErr?.message ?? "asset insert failed");

      const { error: pErr } = await supabase
        .from("projects")
        .update({ source_asset_id: asset.id, status: "transcribing" })
        .eq("id", projectId);
      if (pErr) throw new Error(pErr.message);

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
