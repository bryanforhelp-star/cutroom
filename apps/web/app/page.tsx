"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Project = { id: string; name: string; status: string; created_at: string };

const DEMO_PROJECTS_KEY = "cutroom.demo.projects";

function loadDemoProjects(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(DEMO_PROJECTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveDemoProject(project: Project) {
  const projects = [project, ...loadDemoProjects().filter((p) => p.id !== project.id)];
  window.localStorage.setItem(DEMO_PROJECTS_KEY, JSON.stringify(projects.slice(0, 12)));
}

function createDemoProject(name: string): Project {
  const id = `demo-${Date.now().toString(36)}`;
  const project = {
    id,
    name,
    status: "created",
    created_at: new Date().toISOString(),
  };
  saveDemoProject(project);
  return project;
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadProjects() {
    const demoProjects = loadDemoProjects();
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, status, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setProjects([...(data ?? []), ...demoProjects]);
    } catch (err) {
      console.warn("Supabase project load failed; using demo projects", err);
      setNotice("Prototype mode: database auth is blocking live project storage, so create opens a local demo project instead of freezing.");
      setProjects(demoProjects);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  async function createProject() {
    const projectName = name.trim();
    if (!projectName) return;
    setCreating(true);
    setNotice(null);

    try {
      const { data, error } = await supabase
        .from("projects")
        .insert({ name: projectName })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Project insert returned no data");
      window.location.href = `/p/${data.id}`;
    } catch (err) {
      console.warn("Supabase create failed; opening local demo project", err);
      const demo = createDemoProject(projectName);
      window.location.href = `/p/${demo.id}`;
    } finally {
      setCreating(false);
    }
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
            {creating ? "creating…" : "create"}
          </button>
        </div>
        {notice && <p className="notice">{notice}</p>}
      </div>

      {projects.map((p) => (
        <Link key={p.id} href={`/p/${p.id}`} className="project-link">
          <span>{p.name}</span>
          <span className={`status ${p.status === "ready" ? "ok" : p.status === "error" ? "err" : ""}`}>
            {p.id.startsWith("demo-") ? "demo" : p.status}
          </span>
        </Link>
      ))}
      {!projects.length && <p className="hint">nothing here yet.</p>}
    </main>
  );
}
