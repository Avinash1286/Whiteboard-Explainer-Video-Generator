import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const kickoffWorker = internalAction({
  args: { jobId: v.id("videoJobs") },
  handler: async (ctx, args) => {
    const workerUrl = process.env.RENDER_WORKER_URL;
    if (!workerUrl) {
      await ctx.runMutation(internal.jobs.internalPatchJob, {
        jobId: args.jobId,
        status: "queued",
        progress: 0.02,
        message: "Queued for render worker",
      });
      return;
    }

    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: args.jobId }),
    });
    if (!response.ok) {
      await ctx.runMutation(internal.jobs.internalPatchJob, {
        jobId: args.jobId,
        status: "failed",
        progress: 1,
        error: `Render worker returned ${response.status}: ${await response.text()}`,
      });
    }
  },
});
