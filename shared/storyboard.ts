import { z } from "zod";
import { assetKeySchema } from "./assetCatalog";

export const visualPositionSchema = z.enum([
  "left",
  "center",
  "right",
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
]);

export const visualShapeSchema = z.enum(["square", "rectangle"]);

export const sceneCompositionSchema = z.enum([
  "flow",
  "hub",
  "branch",
  "cycle",
  "compare",
  "balance",
  "stack",
  "scatter",
  "equation",
]);

export const visualSchema = z.object({
  type: z.union([z.literal("asset"), z.literal("box")]),
  assetKey: assetKeySchema.default("generic"),
  label: z.string().min(1).max(32),
  shape: visualShapeSchema,
  position: visualPositionSchema,
  fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const visualElementSchema = z.object({
  id: z.string().regex(/^el_[a-zA-Z0-9_-]+$/),
  type: z.enum(["asset", "text", "logo", "arrow", "line", "node"]),
  assetKey: assetKeySchema.optional(),
  text: z.string().min(1).max(96).optional(),
  label: z.string().min(1).max(48).optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  x2: z.number().optional(),
  y2: z.number().optional(),
  fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fontSize: z.number().positive().optional(),
  strokeWidth: z.number().positive().optional(),
  // A concrete imagery hint used ONLY for icon search (not drawn). Lets an icon
  // resolve by what it should DEPICT (e.g. "light switch") while the visible
  // caption stays the abstract concept (e.g. "CLASSICAL BIT").
  searchHint: z.string().max(80).optional(),
  delay: z.number().min(0).max(6).optional(),
  // Reveal index within the beat: which narration word-group this element is
  // synced to. Resolved to an absolute time from TTS marks in compileVideo.
  revealStep: z.number().int().min(0).max(8).optional(),
});

export const beatSchema = z.object({
  id: z.string().regex(/^beat_[a-zA-Z0-9_-]+$/),
  narration: z.string().min(1).max(240),
  visual: visualSchema,
  elements: z.array(visualElementSchema).max(80).optional(),
});

export const sceneSchema = z.object({
  id: z.string().regex(/^scene_[a-zA-Z0-9_-]+$/),
  title: z.string().min(1).max(48),
  composition: sceneCompositionSchema.default("flow"),
  beats: z.array(beatSchema).min(1).max(6),
});

export const storyboardSchema = z.object({
  title: z.string().min(1).max(64),
  durationSeconds: z.number().int().min(20).max(180),
  scenes: z.array(sceneSchema).min(1).max(8),
});

export type VisualPosition = z.infer<typeof visualPositionSchema>;
export type VisualShape = z.infer<typeof visualShapeSchema>;
export type SceneComposition = z.infer<typeof sceneCompositionSchema>;
export type Visual = z.infer<typeof visualSchema>;
export type VisualElement = z.infer<typeof visualElementSchema>;
export type Beat = z.infer<typeof beatSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Storyboard = z.infer<typeof storyboardSchema>;

export type FlatBeat = Beat & {
  sceneId: string;
  sceneTitle: string;
  sceneIndex: number;
  beatIndex: number;
};

export function flattenBeats(storyboard: Storyboard): FlatBeat[] {
  return storyboard.scenes.flatMap((scene, sceneIndex) =>
    scene.beats.map((beat, beatIndex) => ({
      ...beat,
      sceneId: scene.id,
      sceneTitle: scene.title,
      sceneIndex,
      beatIndex,
    })),
  );
}

export function validateStoryboard(input: unknown): Storyboard {
  const parsed = storyboardSchema.parse(input);
  const ids = new Set<string>();
  const elementIds = new Set<string>();
  for (const beat of flattenBeats(parsed)) {
    if (ids.has(beat.id)) {
      throw new Error(`Duplicate beat id: ${beat.id}`);
    }
    ids.add(beat.id);
    for (const element of beat.elements ?? []) {
      if (elementIds.has(element.id)) {
        throw new Error(`Duplicate visual element id: ${element.id}`);
      }
      elementIds.add(element.id);
    }
  }
  return parsed;
}
