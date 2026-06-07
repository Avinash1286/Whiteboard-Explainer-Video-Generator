import { GoogleAuth } from "google-auth-library";
import * as textToSpeech from "@google-cloud/text-to-speech";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { estimateTimepoints, storyboardToSsml, type Timepoint } from "../shared/ssml";
import type { Storyboard } from "../shared/storyboard";
import { createAgenticStoryboard } from "./agents";
import { probeDurationSeconds } from "./ffmpeg";

export type AudioResult = {
  audioPath: string;
  timepoints: Timepoint[];
  durationSeconds: number;
  source: "google-tts";
};

function hasGoogleCredentials(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

export async function planStoryboard(prompt: string): Promise<{
  storyboard: Storyboard;
  source: "agents";
}> {
  // Every video is planned fresh by the AI director — no canned/case-study shortcuts.
  return createAgenticStoryboard(prompt);
}

export async function synthesizeNarration(
  storyboard: Storyboard,
  outputDir: string,
): Promise<AudioResult> {
  const estimate = estimateTimepoints(storyboard);

  if (!hasGoogleCredentials()) {
    // No silent (literally silent) audio fallback: fail loudly so the job is
    // marked failed and the user can Resume/Regenerate, rather than shipping a
    // mute video that looks "completed".
    throw new Error(
      "Narration unavailable: Google Cloud Text-to-Speech credentials are not configured " +
        "(set GOOGLE_CLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS).",
    );
  }

  const languageCode = process.env.GOOGLE_TTS_LANGUAGE || "en-US";
  const voiceName = process.env.GOOGLE_TTS_VOICE || "en-US-Chirp3-HD-Charon";
  const client = new textToSpeech.v1beta1.TextToSpeechClient() as any;
  // gax call timeout so a hung TTS request fails loudly instead of stalling the job.
  const ttsTimeoutMs = Number(process.env.TTS_TIMEOUT_MS ?? 120000);
  const [response] = await client.synthesizeSpeech(
    {
      input: { ssml: storyboardToSsml(storyboard) },
      voice: { languageCode, name: voiceName },
      audioConfig: { audioEncoding: "MP3" },
      enableTimePointing: ["SSML_MARK"],
    },
    { timeout: ttsTimeoutMs },
  );

  if (!response.audioContent) {
    throw new Error("Google TTS did not return audio content");
  }

  const mp3Path = path.join(outputDir, "narration.mp3");
  await writeFile(mp3Path, Buffer.from(response.audioContent as Uint8Array));
  const durationSeconds = await probeDurationSeconds(mp3Path);

  const ttsTimepoints = (response.timepoints ?? [])
    .map((point: { markName?: string; timeSeconds?: number }) => ({
      markName: point.markName ?? "",
      timeSeconds: Number(point.timeSeconds ?? 0),
    }))
    .filter((point: { markName: string }) => point.markName);

  // Some premium voices (e.g. Chirp3-HD) ignore SSML marks and return no
  // timepoints. Fall back to the word-weighted estimate, scaled to the real
  // audio length, so beat and element reveals still track the narration.
  const timepoints =
    ttsTimepoints.length > 0
      ? ttsTimepoints
      : scaleTimepoints(estimate.timepoints, estimate.durationSeconds, durationSeconds);

  return {
    audioPath: mp3Path,
    timepoints,
    durationSeconds,
    source: "google-tts",
  };
}

function scaleTimepoints(timepoints: Timepoint[], from: number, to: number): Timepoint[] {
  if (from <= 0 || to <= 0) return timepoints;
  const factor = to / from;
  return timepoints.map((point) => ({ ...point, timeSeconds: point.timeSeconds * factor }));
}
