import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";
import type { AssetKey } from "../shared/assetCatalog";
import {
  findGeneratedSvgAsset,
  generateSvgAsset,
  validateGeneratedSvg,
  writeGeneratedSvgAsset,
} from "../shared/generatedSvgAssets";

type OpenMojiSearchIndexEntry = {
  id: string;
  hexcode: string;
  label: string;
  concepts: string[];
  group: string;
  subgroup: string;
  colorSvgPath: string;
};

type OpenMojiSearchIndex = {
  entries: OpenMojiSearchIndexEntry[];
};

export type SvgGenerationSource = "ai-svg-generator" | "deterministic-svg-generator" | "existing";

export type SvgGeneratorResult = {
  assetKey: AssetKey;
  label?: string;
  source: SvgGenerationSource;
  svgPath: string;
  model?: string;
  reason?: string;
};

const svgGeneratorResponseSchema = z.object({
  svg: z.string().min(120).max(40_000),
  rationale: z.string().max(400).optional(),
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const searchIndexPath = path.join(root, "assets", "vendor", "openmoji", "search-index.json");
const colorSvgDir = path.join(root, "assets", "vendor", "openmoji", "color", "svg");

function hasGoogleCredentials(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

function normalize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokensFor(key: string, label?: string): string[] {
  return [...new Set([key, label ?? ""].flatMap((value) => normalize(value).split(/\s+/)).filter((token) => token.length > 2))];
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // Continue to balanced-object extraction below.
  }

  const first = candidate.indexOf("{");
  if (first === -1) {
    throw new Error("SVG Generator response did not contain a JSON object");
  }

  let inString = false;
  let escape = false;
  let depth = 0;
  for (let index = first; index < candidate.length; index += 1) {
    const char = candidate[index];

    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return JSON.parse(candidate.slice(first, index + 1));
    }
  }

  throw new Error("SVG Generator response contained an unterminated JSON object");
}

async function callGeminiJson(prompt: string): Promise<{ data: unknown; model: string }> {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.VERTEX_LOCATION || "global";
  const model = process.env.SVG_GENERATOR_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const endpoint = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.18,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`SVG Generator failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("\n");
  if (!text) {
    throw new Error("SVG Generator did not return text");
  }

  return { data: extractJson(text), model };
}

function loadOpenMojiSearchIndex(): OpenMojiSearchIndexEntry[] {
  if (!existsSync(searchIndexPath)) return [];
  const index = JSON.parse(readFileSync(searchIndexPath, "utf8")) as OpenMojiSearchIndex;
  return index.entries;
}

function scoreEntry(entry: OpenMojiSearchIndexEntry, key: string, label?: string): number {
  const tokens = tokensFor(key, label);
  const labelText = normalize(entry.label);
  const concepts = entry.concepts.map(normalize);
  let score = 0;
  for (const token of tokens) {
    if (labelText === token) score += 45;
    if (labelText.includes(token)) score += 20;
    if (concepts.includes(token)) score += 34;
    if (concepts.some((concept) => concept.includes(token))) score += 12;
  }
  return score;
}

function svgBodySample(relativePath: string): string {
  const filePath = path.resolve(root, relativePath);
  const vendorRoot = path.resolve(root, "assets", "vendor", "openmoji");
  if (!filePath.startsWith(vendorRoot) || !filePath.startsWith(colorSvgDir) || !existsSync(filePath)) return "";
  const svg = readFileSync(filePath, "utf8")
    .replace(/\s+/g, " ")
    .trim();
  return svg.length > 900 ? `${svg.slice(0, 900)}...` : svg;
}

function nearestStyleReferences(key: string, label?: string): string {
  return loadOpenMojiSearchIndex()
    .map((entry) => ({ entry, score: scoreEntry(entry, key, label) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label))
    .slice(0, 3)
    .map(({ entry }) => {
      const sample = svgBodySample(entry.colorSvgPath);
      return [
        `label: ${entry.label}`,
        `concepts: ${entry.concepts.slice(0, 10).join(", ")}`,
        sample ? `svg sample: ${sample}` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function canonicalizeSvg(svg: string): string {
  const match = svg.match(/<svg\b[\s\S]*?<\/svg>/i);
  const candidate = (match?.[0] ?? svg).trim();
  const body = candidate
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!doctype[\s\S]*?>/gi, "")
    .replace(/<svg\b[^>]*>/i, "")
    .replace(/<\/svg>\s*$/i, "")
    .trim();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
${body}
</svg>`;
}

function svgPrompt(input: { key: AssetKey; label?: string; sceneContext?: string }): string {
  const label = input.label || input.key;
  const references = nearestStyleReferences(input.key, input.label) || "No close OpenMoji references found.";
  return `You are an SVG icon designer creating one OpenMoji-inspired color SVG for a whiteboard explainer renderer.

Concept assetKey: ${input.key}
Concept label: ${label}
Scene context: ${input.sceneContext || "None"}

Use these nearby OpenMoji assets only as style references, not as a required composition:
${references}

Return only JSON:
{
  "svg": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"72\\" height=\\"72\\" viewBox=\\"0 0 72 72\\">...</svg>",
  "rationale": "short reason"
}

Hard rules:
- Output exactly one complete SVG document in the svg string.
- Use viewBox="0 0 72 72".
- Transparent background.
- OpenMoji-like: bold black outlines, simple rounded geometry, flat color fills.
- Use only inline SVG shapes: path, circle, ellipse, rect, line, polyline, polygon, g, title.
- No script, style tag, foreignObject, image, text, external hrefs, data URLs, filters, masks, or animations.
- Keep it readable at 80px.
- Keep the SVG under 40 KB.
- Do not include real brand logos or copyrighted marks.
- Represent the concept directly with 1-3 simple symbolic objects.`;
}

export async function generateSvgAssetWithAgent(input: {
  key: AssetKey;
  label?: string;
  sceneContext?: string;
  force?: boolean;
}): Promise<SvgGeneratorResult> {
  if (!input.force) {
    const existing = findGeneratedSvgAsset(input.key);
    if (existing) {
      return {
        assetKey: input.key,
        label: input.label,
        source: "existing",
        svgPath: existing.svgPath,
        model: existing.model,
        reason: `Existing ${existing.source} asset found.`,
      };
    }
  }

  if (!hasGoogleCredentials() || process.env.SVG_GENERATOR_MODE === "deterministic") {
    const entry = generateSvgAsset({ key: input.key, label: input.label });
    return {
      assetKey: input.key,
      label: input.label,
      source: "deterministic-svg-generator",
      svgPath: entry.svgPath,
      reason: hasGoogleCredentials() ? "SVG_GENERATOR_MODE=deterministic" : "Google credentials unavailable.",
    };
  }

  try {
    const { data, model } = await callGeminiJson(svgPrompt(input));
    const parsed = svgGeneratorResponseSchema.parse(data);
    const svg = canonicalizeSvg(parsed.svg);
    validateGeneratedSvg(svg);
    const entry = writeGeneratedSvgAsset({
      key: input.key,
      label: input.label,
      svg,
      source: "ai-svg-generator",
      model,
    });
    return {
      assetKey: input.key,
      label: input.label,
      source: "ai-svg-generator",
      svgPath: entry.svgPath,
      model,
      reason: parsed.rationale,
    };
  } catch (error) {
    const entry = generateSvgAsset({ key: input.key, label: input.label });
    return {
      assetKey: input.key,
      label: input.label,
      source: "deterministic-svg-generator",
      svgPath: entry.svgPath,
      reason: `AI generation failed; used deterministic fallback. ${String(error)}`,
    };
  }
}
