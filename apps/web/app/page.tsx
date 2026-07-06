"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Project = { id: string; name: string; status: string; created_at: string };

export default function Home() {
  const [session, setSession] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase
      .from("projects")
      .select("id, name, status, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => setProjects(data ?? []));
  }, [session]);

  async function signIn() {
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setSent(true);
  }

  async function createProject() {
    if (!name.trim()) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("projects")
      .insert({ name: name.trim() })
      .select("id")
      .single();
    setCreating(false);
    if (!error && data) window.location.href = `/p/${data.id}`;
  }

  if (session === null) return <main className="wrap"><span className="status">loading…</span></main>;

  if (!session) {
    return (
      <main className="wrap">
        <div className="brand">cutroom</div>
        <h1 className="h1">sign in</h1>
        <p className="sub">single-user shop. magic link only.</p>
        <div className="card">
          {sent ? (
            <span className="status ok">link sent — check your inbox</span>
          ) : (
            <div className="row">
              <input
                type="email"
                placeholder="you@bykyndall.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && signIn()}
              />
              <button onClick={signIn} disabled={!email.includes("@")}>
                send link
              </button>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      <div className="brand">cutroom</div>
      <h1 className="h1">projects</h1>
      <p className="sub">upload → transcribe → cut by text → export</p>

      <div className="card">
        <div className="row">
          <input
            type="text"
            placeholder="new project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createProject()}
          />
          <button onClick={createProject} disabled={creating || !name.trim()}>
            create
          </button>
        </div>
      </div>

      {projects.map((p) => (
        <Link key={p.id} href={`/p/${p.id}`} className="project-link">
          <span>{p.name}</span>
          <span className={`status ${p.status === "ready" ? "ok" : p.status === "error" ? "err" : ""}`}>
            {p.status}
          </span>
        </Link>
      ))}
      {!projects.length && <p className="hint">nothing here yet.</p>}
    </main>
  );
}
