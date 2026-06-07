import type { Storyboard, VisualElement } from "./storyboard";
import { flattenBeats } from "./storyboard";

export type Timepoint = {
  markName: string;
  timeSeconds: number;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// How many narration-synced reveal groups a beat has, from its elements' revealStep.
function beatSteps(beat: { elements?: VisualElement[] }): number {
  let max = 0;
  for (const el of beat.elements ?? []) {
    if (typeof el.revealStep === "number") max = Math.max(max, el.revealStep);
  }
  return max + 1;
}

// Split a sentence into `groups` contiguous word chunks so each reveal mark lands
// at roughly the moment its part of the sentence is spoken.
function splitWords(text: string, groups: number): string[] {
  const trimmed = text.trim();
  if (groups <= 1) return [trimmed];
  const words = trimmed.split(/\s+/).filter(Boolean);
  const result: string[] = [];
  let idx = 0;
  for (let g = 0; g < groups; g += 1) {
    const end = g === groups - 1 ? words.length : Math.max(idx, Math.round(((g + 1) / groups) * words.length));
    result.push(words.slice(idx, end).join(" "));
    idx = end;
  }
  return result;
}

export function storyboardToSsml(storyboard: Storyboard): string {
  const lines = flattenBeats(storyboard).map((beat) => {
    const steps = beatSteps(beat);
    if (steps <= 1) {
      return `<mark name="${escapeXml(beat.id)}"/> ${escapeXml(beat.narration)} <break time="250ms"/>`;
    }
    const parts = splitWords(beat.narration, steps)
      .map((group, k) => {
        const mark = k === 0 ? beat.id : `${beat.id}__r${k}`;
        return `<mark name="${escapeXml(mark)}"/> ${escapeXml(group)}`;
      })
      .join(" ");
    return `${parts} <break time="250ms"/>`;
  });
  return `<speak>${lines.join("\n")}</speak>`;
}

export function narrationText(storyboard: Storyboard): string {
  return flattenBeats(storyboard)
    .map((beat) => beat.narration)
    .join(" ");
}

export function estimateTimepoints(storyboard: Storyboard): {
  timepoints: Timepoint[];
  durationSeconds: number;
} {
  const beats = flattenBeats(storyboard);
  const targetDuration = Math.max(storyboard.durationSeconds, beats.length * 3);
  const totalChars = beats.reduce((sum, beat) => sum + beat.narration.length, 0);
  let cursor = 0;
  const timepoints: Timepoint[] = [];
  for (const beat of beats) {
    const weight = beat.narration.length / Math.max(1, totalChars);
    const beatDuration = Math.max(2.4, targetDuration * weight);
    const steps = beatSteps(beat);
    for (let k = 0; k < steps; k += 1) {
      const frac = steps > 1 ? k / steps : 0;
      const mark = k === 0 ? beat.id : `${beat.id}__r${k}`;
      timepoints.push({ markName: mark, timeSeconds: cursor + frac * beatDuration * 0.9 });
    }
    cursor += beatDuration;
  }
  return {
    timepoints,
    durationSeconds: Math.max(cursor + 1.2, targetDuration),
  };
}
