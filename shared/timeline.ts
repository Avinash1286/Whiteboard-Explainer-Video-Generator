import type { AssetKey } from "./assetCatalog";
import type { SceneComposition, VisualElement } from "./storyboard";

export type TimelineBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutDiagnostic = {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  sceneId: string;
  beatId?: string;
  elementId?: string;
  before?: TimelineBox;
  after?: TimelineBox;
};

export type ResolvedTimelineElement = {
  id: string;
  kind: VisualElement["type"];
  assetKey?: AssetKey;
  text?: string;
  label?: string;
  box: TimelineBox;
  line?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  fill?: string;
  fontSize?: number;
  start: number;
  end: number;
  z: number;
  sourceBeatId: string;
};

export type ResolvedTimelineBeat = {
  id: string;
  narration: string;
  start: number;
  end: number;
  elements: ResolvedTimelineElement[];
};

export type ResolvedTimelineScene = {
  id: string;
  title: string;
  composition: SceneComposition;
  start: number;
  end: number;
  beats: ResolvedTimelineBeat[];
  diagnostics: LayoutDiagnostic[];
};

export type ResolvedTimeline = {
  version: 1;
  width: number;
  height: number;
  fps: number;
  duration: number;
  title: string;
  scenes: ResolvedTimelineScene[];
  diagnostics: LayoutDiagnostic[];
};
