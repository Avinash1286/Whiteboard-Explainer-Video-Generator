"use client";

import { FormEvent, useMemo, useState } from "react";
import { ConvexProvider, ConvexReactClient, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  SquareDashedMousePointer,
} from "lucide-react";

type JobStatus =
  | "queued"
  | "planning"
  | "generating_audio"
  | "laying_out"
  | "rendering"
  | "completed"
  | "failed";

type VideoJob = {
  _id: string;
  prompt: string;
  status: JobStatus;
  progress: number;
  message?: string;
  error?: string;
  videoUrl?: string | null;
  durationSeconds?: number;
  plannerSource?: string;
  audioSource?: string;
};

const createVideoJobRef = "jobs:createVideoJob" as any;
const getVideoJobRef = "jobs:getVideoJob" as any;
const retryVideoJobRef = "jobs:retryVideoJob" as any;

const statusLabels: Record<JobStatus, string> = {
  queued: "Queued",
  planning: "Planning",
  generating_audio: "Generating audio",
  laying_out: "Laying out",
  rendering: "Rendering",
  completed: "Completed",
  failed: "Failed",
};

function SetupView() {
  return (
    <main className="app-shell setup-shell">
      <section className="workspace">
        <div className="status-panel empty-state">
          <SquareDashedMousePointer size={36} />
          <h1>Convex URL Missing</h1>
          <p>
            Add <code>NEXT_PUBLIC_CONVEX_URL</code> or keep <code>VITE_CONVEX_URL</code> in your
            environment, then run the Convex dev server and render worker.
          </p>
          <pre>{`npm run convex:dev
npm run worker
npm run dev`}</pre>
        </div>
      </section>
    </main>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress-track" aria-label="Progress">
      <div className="progress-fill" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function JobPanel({
  job,
  onResume,
  onRegenerate,
  busy,
}: {
  job: VideoJob | null | undefined;
  onResume: () => void;
  onRegenerate: () => void;
  busy: boolean;
}) {
  if (!job) {
    return (
      <section className="status-panel preview-panel">
        <div className="preview-placeholder">
          <Play size={42} />
        </div>
      </section>
    );
  }

  const complete = job.status === "completed";
  const failed = job.status === "failed";

  return (
    <section className="status-panel preview-panel">
      <div className="job-header">
        <div>
          <span className={`status-pill ${failed ? "failed" : complete ? "done" : ""}`}>
            {complete ? (
              <CheckCircle2 size={16} />
            ) : failed ? (
              <AlertTriangle size={16} />
            ) : (
              <Loader2 size={16} className="spin" />
            )}
            {statusLabels[job.status]}
          </span>
          <h2>{job.prompt}</h2>
        </div>
        <strong>{Math.round(job.progress * 100)}%</strong>
      </div>

      <ProgressBar value={job.progress} />

      {job.videoUrl && complete ? (
        <video className="video-output" src={job.videoUrl} controls />
      ) : (
        <div className="preview-placeholder active">
          {failed ? (
            <div className="failure-block">
              <strong>Generation failed</strong>
              <span className="failure-detail">
                {job.error?.split("\n")[0] ?? "Something went wrong while building this video."}
              </span>
            </div>
          ) : (
            <span>{job.message ?? statusLabels[job.status]}</span>
          )}
        </div>
      )}

      {(failed || complete) && (
        <div className="action-row">
          {failed && (
            <button type="button" className="action-btn primary" onClick={onResume} disabled={busy}>
              <RotateCcw size={16} /> Resume
            </button>
          )}
          <button type="button" className="action-btn" onClick={onRegenerate} disabled={busy}>
            <RefreshCw size={16} /> Regenerate
          </button>
        </div>
      )}

      <div className="meta-row">
        <span>Planner: {job.plannerSource ?? "pending"}</span>
        <span>Audio: {job.audioSource ?? "pending"}</span>
        <span>{job.durationSeconds ? `${job.durationSeconds.toFixed(1)}s` : "duration pending"}</span>
      </div>
    </section>
  );
}

function ConfiguredApp() {
  const [prompt, setPrompt] = useState("");
  const [gridBackground, setGridBackground] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const createVideoJob = useMutation(createVideoJobRef);
  const retryVideoJob = useMutation(retryVideoJobRef);
  const job = useQuery(getVideoJobRef, jobId ? { jobId } : "skip") as VideoJob | null | undefined;

  const canSubmit = useMemo(() => prompt.trim().length >= 8 && !submitting, [prompt, submitting]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const id = (await createVideoJob({ prompt: prompt.trim(), gridBackground })) as string;
      setJobId(id);
    } finally {
      setSubmitting(false);
    }
  }

  // Resume: re-run the SAME job through the full pipeline (same prompt, same row).
  async function onResume() {
    if (!job || busy) return;
    setBusy(true);
    try {
      await retryVideoJob({ jobId: job._id });
    } finally {
      setBusy(false);
    }
  }

  // Regenerate: start a brand-new job from the same prompt — a fresh AI pass.
  async function onRegenerate() {
    const source = (job?.prompt ?? prompt).trim();
    if (source.length < 8 || busy) return;
    setBusy(true);
    try {
      const id = (await createVideoJob({ prompt: source, gridBackground })) as string;
      setJobId(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="chat-panel">
        <div className="brand-row">
          <Bot size={24} />
          <div>
            <h1>Video Compiler</h1>
            <span>Structured prompt to synced render</span>
          </div>
        </div>

        <div className="message assistant">
          <p>What should the explainer show?</p>
        </div>

        <form className="prompt-form" onSubmit={onSubmit}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Explain how stablecoin cross-border payments work"
            rows={6}
          />
          <label className="grid-toggle">
            <input
              type="checkbox"
              checked={gridBackground}
              onChange={(event) => setGridBackground(event.target.checked)}
            />
            <span>Grid (graph-paper) background</span>
          </label>
          <button type="submit" disabled={!canSubmit}>
            {submitting ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
            Generate
          </button>
        </form>
      </aside>

      <section className="workspace">
        <JobPanel job={job} onResume={onResume} onRegenerate={onRegenerate} busy={busy || submitting} />
      </section>
    </main>
  );
}

export default function ClientApp({ convexUrl }: { convexUrl: string }) {
  const convex = useMemo(() => (convexUrl ? new ConvexReactClient(convexUrl) : null), [convexUrl]);

  if (!convex) return <SetupView />;

  return (
    <ConvexProvider client={convex}>
      <ConfiguredApp />
    </ConvexProvider>
  );
}
