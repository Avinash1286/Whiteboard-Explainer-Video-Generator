import "./env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { runVideoPipeline } from "./pipeline";

const claimQueuedJob = makeFunctionReference<
  "mutation",
  { workerId: string },
  null | { jobId: string; prompt: string; gridBackground?: boolean }
>("jobs:claimQueuedJob");
const updateVideoJob = makeFunctionReference<"mutation", any, null>("jobs:updateVideoJob");
const completeVideoJob = makeFunctionReference<"mutation", any, null>("jobs:completeVideoJob");
const failVideoJob = makeFunctionReference<"mutation", { jobId: string; error: string }, null>(
  "jobs:failVideoJob",
);
const generateUploadUrl = makeFunctionReference<"mutation", { jobId: string }, string>(
  "jobs:generateUploadUrl",
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;

if (!convexUrl) {
  throw new Error("CONVEX_URL is required to run the worker");
}

const workerId = `worker-${process.pid}`;
const client = new ConvexHttpClient(convexUrl);
if (process.env.CONVEX_AUTH_TOKEN) {
  client.setAuth(process.env.CONVEX_AUTH_TOKEN);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientConvexError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("try again later") ||
    message.includes("internalservererror") ||
    message.includes("failed to fetch") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("service unavailable")
  );
}

async function uploadVideo(jobId: string, filePath: string): Promise<string> {
  // No silent fallback to a local file:// path — a browser can't play that, so a
  // "completed" job with a local path is really a broken video. Throw so the job
  // is marked failed and the user can Resume/Regenerate.
  const uploadUrl = await client.mutation(generateUploadUrl, { jobId });
  const data = await readFile(filePath);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "video/mp4" },
    body: data,
  });
  if (!response.ok) {
    throw new Error(`Convex storage upload failed with ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as { storageId?: string };
  if (!payload.storageId) {
    throw new Error("Convex storage upload did not return a storageId");
  }
  return payload.storageId;
}

async function processOneJob(): Promise<boolean> {
  const job = await client.mutation(claimQueuedJob, { workerId });
  if (!job) return false;

  const outputDir = path.join(root, "outputs", String(job.jobId));
  try {
    const result = await runVideoPipeline({
      prompt: job.prompt,
      outputDir,
      background: job.gridBackground ? "grid" : "plain",
      async onProgress(progress) {
        const status =
          progress.stage === "directing"
            ? "planning"
            : progress.stage === "generating_assets"
              ? "generating_audio"
              : progress.stage === "assembling"
                ? "laying_out"
                : progress.stage === "completed"
                  ? "completed"
                  : "rendering";
        await client.mutation(updateVideoJob, {
          jobId: job.jobId,
          status,
          progress: Math.min(0.98, progress.progress),
          message: progress.message,
        });
      },
    });

    const storageId = await uploadVideo(job.jobId, result.outputPath);
    await client.mutation(completeVideoJob, {
      jobId: job.jobId,
      videoFileId: storageId,
      scenePlan: result.storyboard,
      plannerSource: result.plannerSource,
      audioSource: result.audioSource,
      durationSeconds: result.durationSeconds,
    });
    console.log(`Completed ${job.jobId}: ${result.outputPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    await client.mutation(failVideoJob, { jobId: job.jobId, error: message });
    console.error(`Failed ${job.jobId}`, error);
  }
  return true;
}

console.log(`Render worker ${workerId} connected to ${convexUrl}`);
let backoffMs = 2000;
for (;;) {
  try {
    const worked = await processOneJob();
    backoffMs = worked ? 1000 : 2500;
    if (!worked) {
      await sleep(backoffMs);
    }
  } catch (error) {
    if (!isTransientConvexError(error)) {
      console.error("Worker polling failed", error);
    } else {
      console.warn(`Convex is not ready yet; retrying in ${Math.round(backoffMs / 1000)}s.`);
    }
    await sleep(backoffMs);
    backoffMs = Math.min(backoffMs * 1.6, 15000);
  }
}
