import { findGeneratedSvgAsset } from "../shared/generatedSvgAssets";
import { resolveOpenMojiAssetInfo } from "../shared/openMojiAssets";
import type { Storyboard } from "../shared/storyboard";
import { generateSvgAssetWithAgent } from "./svgGeneratorAgent";

export type AssetResolutionRecord = {
  assetKey: string;
  label?: string;
  sceneId: string;
  beatId: string;
  provider: "local-openmoji" | "excalidraw" | "generated-openmoji-inspired";
  strategy:
    | "openmoji-curated"
    | "openmoji-semantic"
    | "excalidraw-semantic"
    | "generated-existing"
    | "ai-svg-generator"
    | "deterministic-svg-generator";
  iconRef?: string;
  svgPath: string;
  model?: string;
  reason?: string;
};

type AssetRequest = {
  assetKey: string;
  label?: string;
  preferImagery: boolean;
  sceneId: string;
  sceneTitle: string;
  beatId: string;
  narration: string;
};

function collectAssetRequests(storyboard: Storyboard): AssetRequest[] {
  const requests = new Map<string, AssetRequest>();

  for (const scene of storyboard.scenes) {
    for (const beat of scene.beats) {
      const add = (assetKey: string | undefined, label?: string, preferImagery = false) => {
        if (!assetKey) return;
        const id = `${assetKey}::${label ?? ""}`;
        if (requests.has(id)) return;
        requests.set(id, {
          assetKey,
          label,
          preferImagery,
          sceneId: scene.id,
          sceneTitle: scene.title,
          beatId: beat.id,
          narration: beat.narration,
        });
      };

      add(beat.visual.assetKey, beat.visual.label);
      for (const element of beat.elements ?? []) {
        if (element.type === "asset" || element.type === "logo") {
          // Resolve by the same hint + priority the renderer uses, so the
          // generated-asset decision matches what actually gets drawn.
          add(element.assetKey, element.searchHint ?? element.label ?? element.text, Boolean(element.searchHint));
        }
      }
    }
  }

  return [...requests.values()];
}

export async function prepareStoryboardAssets(storyboard: Storyboard): Promise<AssetResolutionRecord[]> {
  const records: AssetResolutionRecord[] = [];

  for (const request of collectAssetRequests(storyboard)) {
    const openMoji = resolveOpenMojiAssetInfo(request.assetKey, request.label, undefined, request.preferImagery);
    if (openMoji) {
      const isExcali = openMoji.provider === "excalidraw";
      records.push({
        assetKey: request.assetKey,
        label: request.label,
        sceneId: request.sceneId,
        beatId: request.beatId,
        provider: openMoji.provider,
        strategy: isExcali ? "excalidraw-semantic" : openMoji.strategy === "curated" ? "openmoji-curated" : "openmoji-semantic",
        iconRef: openMoji.iconRef,
        svgPath: openMoji.svgPath,
        reason: isExcali
          ? "Matched Excalidraw hand-drawn library (embedding)."
          : openMoji.strategy === "curated"
            ? "Matched curated OpenMoji manifest."
            : "Matched OpenMoji (embedding/keyword).",
      });
      continue;
    }

    const generated = findGeneratedSvgAsset(request.assetKey);
    if (generated) {
      records.push({
        assetKey: request.assetKey,
        label: request.label,
        sceneId: request.sceneId,
        beatId: request.beatId,
        provider: "generated-openmoji-inspired",
        strategy: generated.source === "ai-svg-generator" ? "ai-svg-generator" : "generated-existing",
        svgPath: generated.svgPath,
        model: generated.model,
        reason: `Matched existing ${generated.source} generated asset.`,
      });
      continue;
    }

    const generatedResult = await generateSvgAssetWithAgent({
      key: request.assetKey,
      label: request.label,
      sceneContext: `${request.sceneTitle}: ${request.narration}`,
    });

    records.push({
      assetKey: request.assetKey,
      label: request.label,
      sceneId: request.sceneId,
      beatId: request.beatId,
      provider: "generated-openmoji-inspired",
      strategy:
        generatedResult.source === "ai-svg-generator"
          ? "ai-svg-generator"
          : generatedResult.source === "existing"
            ? "generated-existing"
            : "deterministic-svg-generator",
      svgPath: generatedResult.svgPath,
      model: generatedResult.model,
      reason: generatedResult.reason,
    });
  }

  return records;
}
