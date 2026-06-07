import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetCatalog, assetKeys, type KnownAssetKey } from "../shared/assetCatalog";

type CandidateMap = Record<KnownAssetKey, string[]>;

type OpenMojiDatum = {
  emoji: string;
  hexcode: string;
  group: string;
  subgroups: string;
  annotation: string;
  tags: string;
  openmoji_tags: string;
  openmoji_author: string;
  openmoji_date: string;
  unicode: number;
  order: number;
};

type RegistryEntry = {
  id: string;
  hexcode: string;
  emoji: string;
  label: string;
  concepts: string[];
  group: string;
  subgroup: string;
  colorSvgPath: string;
  license: "CC BY-SA 4.0";
  attribution: "OpenMoji";
  author: string;
  date: string;
  unicode: number;
  order: number;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sourceRoot = path.resolve(root, process.env.OPENMOJI_REPO_DIR ?? "openmoji-17.0.0");
const sourceDataPath = path.join(sourceRoot, "data", "openmoji.json");
const sourceColorSvgDir = path.join(sourceRoot, "color", "svg");

const outputRoot = path.join(root, "assets", "vendor", "openmoji");
const outputColorSvgDir = path.join(outputRoot, "color", "svg");

const candidates: CandidateMap = {
  generic: ["light bulb", "thought balloon", "white question mark"],
  input: ["inbox tray", "input latin letters", "keyboard"],
  data: ["bar chart", "chart increasing", "card index dividers"],
  person: ["bust in silhouette", "person", "adult"],
  group: ["busts in silhouette", "people holding hands", "family"],
  brain: ["brain"],
  neuron: ["neuron", "brain", "atom symbol"],
  network: ["globe with meridians", "link", "linked paperclips"],
  layer: ["card index dividers", "file folder", "open file folder"],
  connection: ["link", "linked paperclips", "chains"],
  weight: ["balance scale", "scales", "scale"],
  activation: ["high voltage", "fire", "radioactive"],
  output: ["outbox tray", "check mark button", "package"],
  feedback: ["counterclockwise arrows button", "anticlockwise arrows button", "repeat button"],
  learning: ["graduation cap", "books", "school"],
  bank: ["bank", "office building", "classical building"],
  wallet: ["wallet", "purse", "credit card"],
  currency: ["dollar banknote", "money with wings", "money bag"],
  coin: ["coin", "heavy dollar sign", "dollar banknote"],
  blockchain: ["chains", "link", "linked paperclips"],
  server: ["desktop computer", "laptop", "computer disk"],
  database: ["file cabinet", "card index dividers", "floppy disk"],
  cloud: ["cloud", "cloud with rain", "globe with meridians"],
  chip: ["computer chip", "microchip", "desktop computer"],
  code: ["laptop", "keyboard", "desktop computer"],
  document: ["page facing up", "scroll", "memo"],
  chart: ["chart increasing", "bar chart", "chart decreasing"],
  gear: ["gear", "hammer and wrench", "toolbox"],
  pipeline: ["factory", "assembly group", "conveyor belt"],
  rocket: ["rocket"],
  house: ["house", "house with garden"],
  lock: ["locked", "locked with key", "key"],
  shield: ["shield", "locked", "check mark button"],
  globe: ["globe with meridians", "globe showing europe africa", "world map"],
  clock: ["alarm clock", "one oclock", "hourglass not done"],
  check: ["check mark button", "check box with check", "white heavy check mark"],
  warning: ["warning", "warning sign", "collision"],
  lightbulb: ["light bulb", "glowing star", "sparkles"],
  magnifier: ["magnifying glass tilted left", "magnifying glass tilted right"],
  oldCell: ["microbe", "petri dish", "dna"],
  youngCell: ["microbe", "dna", "seedling"],
  transcriptionSwitch: ["control knobs", "input latin letters", "dna"],
  liver: ["liver", "anatomical heart", "organ"],
  flask: ["test tube", "alembic", "petri dish"],
  moneyBag: ["money bag", "money with wings", "dollar banknote"],
  calendar: ["calendar", "tear off calendar", "spiral calendar"],
  vial: ["test tube", "syringe", "drop of blood"],
  hourglass: ["hourglass not done", "hourglass done"],
  dna: ["dna"],
  companyMark: ["office building", "factory", "classical building"],
  founder: ["person", "bust in silhouette", "adult"],
};

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function slug(value: string): string {
  return normalize(value).replace(/\s+/g, "-");
}

function conceptsFor(datum: OpenMojiDatum): string[] {
  const values = [
    datum.annotation,
    datum.tags,
    datum.openmoji_tags,
    datum.group,
    datum.subgroups,
  ]
    .join(",")
    .split(/[,/]/)
    .map(normalize)
    .filter(Boolean);
  return [...new Set(values)];
}

function sourceColorSvgPath(hexcode: string): string {
  return path.join(sourceColorSvgDir, `${hexcode}.svg`);
}

function outputColorSvgPath(hexcode: string): string {
  return path.join(outputColorSvgDir, `${hexcode}.svg`);
}

function outputColorSvgRelativePath(hexcode: string): string {
  return `assets/vendor/openmoji/color/svg/${hexcode}.svg`;
}

function registryEntryFor(datum: OpenMojiDatum): RegistryEntry {
  return {
    id: `openmoji.${datum.hexcode}`,
    hexcode: datum.hexcode,
    emoji: datum.emoji,
    label: datum.annotation,
    concepts: conceptsFor(datum),
    group: datum.group,
    subgroup: datum.subgroups,
    colorSvgPath: outputColorSvgRelativePath(datum.hexcode),
    license: "CC BY-SA 4.0",
    attribution: "OpenMoji",
    author: datum.openmoji_author,
    date: datum.openmoji_date,
    unicode: datum.unicode,
    order: datum.order,
  };
}

function hasColorSvg(datum: OpenMojiDatum): boolean {
  return existsSync(sourceColorSvgPath(datum.hexcode));
}

function scoreCandidate(datum: OpenMojiDatum, candidate: string): number {
  const target = normalize(candidate);
  const targetSlug = slug(candidate);
  const annotation = normalize(datum.annotation);
  const annotationSlug = slug(datum.annotation);
  const concepts = conceptsFor(datum);

  if (datum.hexcode.toLowerCase() === target.toLowerCase()) return 100;
  if (annotation === target || annotationSlug === targetSlug) return 90;
  if (concepts.some((concept) => concept === target || slug(concept) === targetSlug)) return 70;

  const haystack = [datum.annotation, datum.tags, datum.openmoji_tags, datum.group, datum.subgroups]
    .map(normalize)
    .join(" ");
  if (haystack.includes(target)) return 45;

  return 0;
}

function pickDatum(data: OpenMojiDatum[], assetKey: KnownAssetKey): OpenMojiDatum {
  const matches = candidates[assetKey]
    .flatMap((candidate, candidateIndex) =>
      data
        .filter(hasColorSvg)
        .map((datum) => ({
          datum,
          score: scoreCandidate(datum, candidate) - candidateIndex * 0.1,
        }))
        .filter((entry) => entry.score > 0),
    )
    .sort((a, b) => b.score - a.score || a.datum.order - b.datum.order);

  const selected = matches[0]?.datum;
  if (!selected) {
    throw new Error(`No local OpenMoji color SVG candidate found for ${assetKey}: ${candidates[assetKey].join(", ")}`);
  }
  return selected;
}

if (!existsSync(sourceDataPath)) {
  throw new Error(`OpenMoji metadata not found at ${sourceDataPath}`);
}
if (!existsSync(sourceColorSvgDir)) {
  throw new Error(`OpenMoji color SVG folder not found at ${sourceColorSvgDir}`);
}

await mkdir(outputColorSvgDir, { recursive: true });

const data = JSON.parse(await readFile(sourceDataPath, "utf8")) as OpenMojiDatum[];
const dataWithColorSvg = data.filter(hasColorSvg);

const registry = dataWithColorSvg
  .slice()
  .sort((a, b) => a.order - b.order)
  .map(registryEntryFor);

for (const entry of registry) {
  await copyFile(sourceColorSvgPath(entry.hexcode), outputColorSvgPath(entry.hexcode));
}

const curatedEntries = assetKeys.map((assetKey) => {
  const datum = pickDatum(data, assetKey);
  const registryEntry = registryEntryFor(datum);
  return {
    assetKey,
    id: registryEntry.id,
    provider: "local-openmoji",
    collection: "openmoji",
    style: "color",
    hexcode: registryEntry.hexcode,
    emoji: registryEntry.emoji,
    iconRef: `openmoji:${registryEntry.hexcode}`,
    label: assetCatalog[assetKey].label,
    openMojiLabel: registryEntry.label,
    concepts: [...new Set([...assetCatalog[assetKey].tags, ...registryEntry.concepts])],
    group: registryEntry.group,
    subgroup: registryEntry.subgroup,
    colorSvgPath: registryEntry.colorSvgPath,
    svgPath: registryEntry.colorSvgPath,
    license: registryEntry.license,
    attribution: registryEntry.attribution,
  };
});

const manifest = {
  generatedAt: new Date().toISOString(),
  provider: "local-openmoji",
  collection: "openmoji",
  style: "color",
  sourceRepo: path.relative(root, sourceRoot).replace(/\\/g, "/"),
  license: "CC BY-SA 4.0",
  attribution: "OpenMoji",
  total: curatedEntries.length,
  registryTotal: registry.length,
  entries: curatedEntries,
};

const searchIndex = registry.map((entry) => ({
  id: entry.id,
  hexcode: entry.hexcode,
  label: entry.label,
  concepts: entry.concepts,
  group: entry.group,
  subgroup: entry.subgroup,
  colorSvgPath: entry.colorSvgPath,
}));

await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(path.join(outputRoot, "registry.json"), `${JSON.stringify({ generatedAt: manifest.generatedAt, style: "color", total: registry.length, entries: registry }, null, 2)}\n`, "utf8");
await writeFile(path.join(outputRoot, "search-index.json"), `${JSON.stringify({ generatedAt: manifest.generatedAt, style: "color", total: searchIndex.length, entries: searchIndex }, null, 2)}\n`, "utf8");

for (const entry of curatedEntries) {
  console.log(`${entry.assetKey} -> ${entry.iconRef} (${entry.openMojiLabel})`);
}

console.log(`\nCopied ${registry.length} color SVG assets from ${path.relative(root, sourceColorSvgDir)}`);
console.log(`Wrote curated manifest for ${curatedEntries.length} asset keys`);
