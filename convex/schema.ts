import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  videoJobs: defineTable({
    prompt: v.string(),
    gridBackground: v.optional(v.boolean()),
    status: v.union(
      v.literal("queued"),
      v.literal("planning"),
      v.literal("generating_audio"),
      v.literal("laying_out"),
      v.literal("rendering"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    progress: v.number(),
    message: v.optional(v.string()),
    error: v.optional(v.string()),
    scenePlan: v.optional(v.any()),
    plannerSource: v.optional(v.string()),
    audioSource: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
    videoFileId: v.optional(v.id("_storage")),
    videoUrl: v.optional(v.string()),
    workerId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_created", ["createdAt"]),
});
