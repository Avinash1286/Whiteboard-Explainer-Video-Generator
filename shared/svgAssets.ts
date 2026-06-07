import type { AssetKey } from "./assetCatalog";
import { renderGeneratedSvgAsset } from "./generatedSvgAssets";
import { renderOpenMojiAsset } from "./openMojiAssets";

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function renderSvgAsset(input: {
  key: AssetKey;
  label?: string;
  box: Box;
  color: string;
  progress: number;
  opacity: number;
  seed: number;
  clipId: string;
}): string {
  const rendered = renderOpenMojiAsset({
    key: input.key,
    label: input.label,
    box: input.box,
    progress: input.progress,
    opacity: input.opacity,
    seed: input.seed,
    clipId: input.clipId,
  });

  if (rendered) return rendered;

  return renderGeneratedSvgAsset({
    key: input.key,
    label: input.label,
    box: input.box,
    progress: input.progress,
    opacity: input.opacity,
    seed: input.seed,
    clipId: input.clipId,
  });
}
