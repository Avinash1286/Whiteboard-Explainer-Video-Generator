import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

const statusValidator = v.union(
  v.literal("queued"),
  v.literal("planning"),
  v.literal("generating_audio"),
  v.literal("laying_out"),
  v.literal("rendering"),
  v.literal("completed"),
  v.literal("failed"),
);

export const createVideoJob = mutation({
  args: { prompt: v.string(), gridBackground: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("videoJobs", {
      prompt: args.prompt,
      gridBackground: args.gridBackground ?? false,
      status: "queued",
      progress: 0,
      message: "Queued",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.pipeline.kickoffWorker, { jobId });
    return jobId;
  },
});

export const getVideoJob = query({
  args: { jobId: v.id("videoJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const storageUrl = job.videoFileId ? await ctx.storage.getUrl(job.videoFileId) : null;
    return {
      ...job,
      videoUrl: storageUrl ?? job.videoUrl ?? null,
    };
  },
});

export const listVideoJobs = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db.query("videoJobs").order("desc").take(20);
    return Promise.all(
      jobs.map(async (job) => ({
        ...job,
        videoUrl: job.videoFileId ? await ctx.storage.getUrl(job.videoFileId) : job.videoUrl ?? null,
      })),
    );
  },
});

export const claimQueuedJob = mutation({
  args: { workerId: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("videoJobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .order("asc")
      .first();
    if (!job) return null;
    const now = Date.now();
    await ctx.db.patch(job._id, {
      status: "planning",
      progress: 0.05,
      message: "Worker claimed job",
      workerId: args.workerId,
      updatedAt: now,
    });
    return { jobId: job._id, prompt: job.prompt, gridBackground: job.gridBackground ?? false };
  },
});

// Resume: re-queue an existing job (typically a failed one) so the worker runs
// the FULL pipeline again with the same prompt. Clears the stale error and any
// previous video so the job presents cleanly. The pipeline isn't checkpointed,
// so this re-runs from the top — which is the correct, deterministic behaviour.
export const retryVideoJob = mutation({
  args: { jobId: v.id("videoJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "queued",
      progress: 0,
      message: "Re-queued",
      error: undefined,
      videoFileId: undefined,
      videoUrl: undefined,
      workerId: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.pipeline.kickoffWorker, { jobId: args.jobId });
    return args.jobId;
  },
});

export const updateVideoJob = mutation({
  args: {
    jobId: v.id("videoJobs"),
    status: v.optional(statusValidator),
    progress: v.optional(v.number()),
    message: v.optional(v.string()),
    error: v.optional(v.string()),
    scenePlan: v.optional(v.any()),
    plannerSource: v.optional(v.string()),
    audioSource: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
    videoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { jobId, ...patch } = args;
    await ctx.db.patch(jobId, {
      ...patch,
      updatedAt: Date.now(),
    });
  },
});

export const generateUploadUrl = mutation({
  args: { jobId: v.id("videoJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    return await ctx.storage.generateUploadUrl();
  },
});

export const completeVideoJob = mutation({
  args: {
    jobId: v.id("videoJobs"),
    videoFileId: v.optional(v.id("_storage")),
    videoUrl: v.optional(v.string()),
    scenePlan: v.any(),
    plannerSource: v.string(),
    audioSource: v.string(),
    durationSeconds: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "completed",
      progress: 1,
      message: "Video ready",
      videoFileId: args.videoFileId,
      videoUrl: args.videoUrl,
      scenePlan: args.scenePlan,
      plannerSource: args.plannerSource,
      audioSource: args.audioSource,
      durationSeconds: args.durationSeconds,
      updatedAt: Date.now(),
    });
  },
});

export const failVideoJob = mutation({
  args: { jobId: v.id("videoJobs"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "failed",
      progress: 1,
      message: "Failed",
      error: args.error,
      updatedAt: Date.now(),
    });
  },
});

// Watchdog: fail any job that's been in a processing state without a progress
// update for too long. `updatedAt` is bumped on every onProgress tick, so a job
// stuck here means the worker hung on an API/render call OR died mid-job. Either
// way the user gets a clear failure (+ Resume/Regenerate) instead of a silent
// stall. Runs from a 1-minute cron (see convex/crons.ts).
const STALE_MS = Number(process.env.JOB_STALE_MS ?? 300000); // 5 minutes
const PROCESSING_STATUSES = ["planning", "generating_audio", "laying_out", "rendering"] as const;

export const failStaleJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_MS;
    let failed = 0;
    for (const status of PROCESSING_STATUSES) {
      const jobs = await ctx.db
        .query("videoJobs")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      for (const job of jobs) {
        if (job.updatedAt >= cutoff) continue;
        await ctx.db.patch(job._id, {
          status: "failed",
          progress: 1,
          message: "Failed (timed out)",
          error:
            "Generation timed out — the worker stopped reporting progress (a model/render call hung or the worker stopped). Use Resume or Regenerate.",
          updatedAt: Date.now(),
        });
        failed += 1;
      }
    }
    return { failed };
  },
});

export const internalPatchJob = internalMutation({
  args: {
    jobId: v.id("videoJobs"),
    status: v.optional(statusValidator),
    progress: v.optional(v.number()),
    message: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { jobId, ...patch } = args;
    await ctx.db.patch(jobId, { ...patch, updatedAt: Date.now() });
  },
});
