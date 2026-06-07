import type { AssetKey } from "./assetCatalog";
import type { SceneComposition, Storyboard, VisualElement, VisualPosition } from "./storyboard";

export type LayoutRegion =
  | "left"
  | "center"
  | "right"
  | "top"
  | "bottom"
  | "topLeft"
  | "topRight"
  | "bottomLeft"
  | "bottomRight";

export type LayoutRelation =
  | "none"
  | "left-of"
  | "right-of"
  | "above"
  | "below"
  | "points-to"
  | "connects";

export type ElementPriority = "primary" | "secondary" | "annotation" | "connector";

export type TimingAnchor =
  | { type: "beat"; beatId: string; offsetSeconds?: number }
  | { type: "absolute"; seconds: number }
  | { type: "phrase"; value: string; offsetSeconds?: number };

export type LayoutIntent = {
  mode: "auto" | "slot" | "absolute";
  region?: LayoutRegion;
  relation?: LayoutRelation;
  targetId?: string;
  priority: ElementPriority;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  x2?: number;
  y2?: number;
};

export type ElementStyleIntent = {
  fill?: string;
  fontSize?: number;
};

export type AnimationIntent = {
  kind: "draw" | "fade" | "pop" | "line-draw";
  delaySeconds?: number;
};

export type VideoPlanElement = {
  id: string;
  kind: VisualElement["type"];
  role: ElementPriority;
  assetKey?: AssetKey;
  text?: string;
  label?: string;
  layout: LayoutIntent;
  style?: ElementStyleIntent;
  animation: AnimationIntent;
  appearAt: TimingAnchor;
  sourceBeatId: string;
};

export type VideoPlanBeat = {
  id: string;
  narration: string;
  elements: VideoPlanElement[];
};

export type VideoPlanScene = {
  id: string;
  title: string;
  composition: SceneComposition;
  durationTargetSeconds?: number;
  visualIntent: string;
  beats: VideoPlanBeat[];
};

export type VideoPlan = {
  version: 1;
  title: string;
  durationTargetSeconds: number;
  voice: {
    narrationMode: "ssml-marks";
  };
  scenes: VideoPlanScene[];
};

function visualPositionToRegion(position: VisualPosition): LayoutRegion {
  switch (position) {
    case "left":
      return "left";
    case "right":
      return "right";
    case "topLeft":
      return "topLeft";
    case "topRight":
      return "topRight";
    case "bottomLeft":
      return "bottomLeft";
    case "bottomRight":
      return "bottomRight";
    case "center":
    default:
      return "center";
  }
}

function animationForKind(kind: VisualElement["type"], delaySeconds?: number): AnimationIntent {
  if (kind === "arrow" || kind === "line") {
    return { kind: "line-draw", delaySeconds };
  }
  if (kind === "text") {
    return { kind: "fade", delaySeconds };
  }
  return { kind: "draw", delaySeconds };
}

function legacyElementToPlanElement(element: VisualElement, beatId: string): VideoPlanElement {
  const role: ElementPriority = element.type === "arrow" || element.type === "line" ? "connector" : "secondary";
  return {
    id: element.id,
    kind: element.type,
    role,
    assetKey: element.assetKey,
    text: element.text,
    label: element.label,
    layout: {
      mode: "absolute",
      priority: role,
      relation: role === "connector" ? "connects" : "none",
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      x2: element.x2,
      y2: element.y2,
    },
    style: {
      fill: element.fill,
      fontSize: element.fontSize,
    },
    animation: animationForKind(element.type, element.delay),
    appearAt: { type: "beat", beatId, offsetSeconds: element.delay },
    sourceBeatId: beatId,
  };
}

export function storyboardToVideoPlan(storyboard: Storyboard): VideoPlan {
  const averageSceneDuration = storyboard.durationSeconds / Math.max(1, storyboard.scenes.length);
  return {
    version: 1,
    title: storyboard.title,
    durationTargetSeconds: storyboard.durationSeconds,
    voice: {
      narrationMode: "ssml-marks",
    },
    scenes: storyboard.scenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      composition: scene.composition,
      durationTargetSeconds: averageSceneDuration,
      visualIntent: `${scene.composition} composition with ${scene.beats.length} narrated beats`,
      beats: scene.beats.map((beat) => {
        const primaryElement: VideoPlanElement = {
          id: `el_primary_${beat.id.replace(/^beat_/, "")}`,
          kind: "asset",
          role: "primary",
          assetKey: beat.visual.assetKey,
          label: beat.visual.label,
          layout: {
            mode: "slot",
            region: visualPositionToRegion(beat.visual.position),
            relation: "none",
            priority: "primary",
          },
          style: {
            fill: beat.visual.fill,
          },
          animation: { kind: "draw" },
          appearAt: { type: "beat", beatId: beat.id },
          sourceBeatId: beat.id,
        };
        return {
          id: beat.id,
          narration: beat.narration,
          elements: [primaryElement, ...(beat.elements ?? []).map((element) => legacyElementToPlanElement(element, beat.id))],
        };
      }),
    })),
  };
}
