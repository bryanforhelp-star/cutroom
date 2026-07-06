"use client";

import { useRef, useState } from "react";
import * as tus from "tus-js-client";
import { supabase, BUCKET } from "@/lib/supabase";

const TUS_THRESHOLD = 6 * 1024 * 1024; // resumable upload above 6MB

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
      if (file.size > TUS_THRESHOLD) {
        try {
          await tusUpload(file, path, setProgress);
        } catch (tusErr) {
          // resumable endpoint can be finicky across supabase configs — fall
          // back to a standard upload rather than blocking the user
          console.warn("tus failed, falling back to standard upload", tusErr);
          setProgress(0);
          const { error: upErr } = await supabase.storage
            .from(BUCKET)
            .upload(path, file, { contentType: file.type || "video/mp4", upsert: true });
          if (upErr) throw new Error(upErr.message);
          setProgress(100);
        }
      } else {
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { contentType: file.type || "video/mp4", upsert: true });
        if (upErr) throw new Error(upErr.message);
        setProgress(100);
      }

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

  async function tusUpload(file: File, path: string, onProgress: (p: number) => void) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("not signed in");

    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000],
        headers: {
          authorization: `Bearer ${token}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          "x-upsert": "true",
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: 6 * 1024 * 1024, // required by Supabase
        metadata: {
          bucketName: BUCKET,
          objectName: path,
          contentType: file.type || "video/mp4",
        },
        onError: reject,
        onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)),
        onSuccess: () => resolve(),
      });
      upload.start();
    });
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
