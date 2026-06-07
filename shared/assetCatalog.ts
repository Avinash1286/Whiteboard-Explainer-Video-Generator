import { z } from "zod";

export const assetKeys = [
  "generic",
  "input",
  "data",
  "person",
  "group",
  "brain",
  "neuron",
  "network",
  "layer",
  "connection",
  "weight",
  "activation",
  "output",
  "feedback",
  "learning",
  "bank",
  "wallet",
  "currency",
  "coin",
  "blockchain",
  "server",
  "database",
  "cloud",
  "chip",
  "code",
  "document",
  "chart",
  "gear",
  "pipeline",
  "rocket",
  "house",
  "lock",
  "shield",
  "globe",
  "clock",
  "check",
  "warning",
  "lightbulb",
  "magnifier",
  "oldCell",
  "youngCell",
  "transcriptionSwitch",
  "liver",
  "flask",
  "moneyBag",
  "calendar",
  "vial",
  "hourglass",
  "dna",
  "companyMark",
  "founder",
] as const;

export type KnownAssetKey = (typeof assetKeys)[number];
export type AssetKey = string;

export const assetKeySchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, "assetKey must be a semantic identifier like cellReprogramming");

export const assetCatalog: Record<KnownAssetKey, { label: string; tags: string[] }> = {
  generic: { label: "Concept", tags: ["concept", "placeholder", "idea"] },
  input: { label: "Input", tags: ["input", "incoming", "signal", "start", "source"] },
  data: { label: "Data", tags: ["data", "information", "dataset"] },
  person: { label: "Person", tags: ["user", "customer", "sender", "receiver", "person"] },
  group: { label: "Group", tags: ["team", "people", "community", "users"] },
  brain: { label: "Brain", tags: ["brain", "ai", "intelligence", "neural"] },
  neuron: { label: "Neuron", tags: ["neuron", "node", "neural", "signal"] },
  network: { label: "Network", tags: ["network", "graph", "nodes", "distributed"] },
  layer: { label: "Layer", tags: ["layer", "hidden", "stack"] },
  connection: { label: "Connection", tags: ["connection", "edge", "link", "path"] },
  weight: { label: "Weight", tags: ["weight", "importance", "scale"] },
  activation: { label: "Activation", tags: ["activation", "fire", "threshold"] },
  output: { label: "Output", tags: ["output", "result", "prediction"] },
  feedback: { label: "Feedback", tags: ["feedback", "loop", "correction"] },
  learning: { label: "Learning", tags: ["learning", "training", "improvement"] },
  bank: { label: "Bank", tags: ["bank", "finance", "institution"] },
  wallet: { label: "Wallet", tags: ["wallet", "account", "payment"] },
  currency: { label: "Currency", tags: ["money", "currency", "cash", "dollar"] },
  coin: { label: "Coin", tags: ["coin", "token", "crypto"] },
  blockchain: { label: "Blockchain", tags: ["blockchain", "chain", "ledger"] },
  server: { label: "Server", tags: ["server", "compute", "backend"] },
  database: { label: "Database", tags: ["database", "storage", "records"] },
  cloud: { label: "Cloud", tags: ["cloud", "internet", "hosted"] },
  chip: { label: "Chip", tags: ["chip", "gpu", "processor", "hardware"] },
  code: { label: "Code", tags: ["code", "software", "program"] },
  document: { label: "Document", tags: ["document", "paper", "policy", "file"] },
  chart: { label: "Chart", tags: ["chart", "growth", "metrics"] },
  gear: { label: "Gear", tags: ["process", "engine", "automation"] },
  pipeline: { label: "Pipeline", tags: ["pipeline", "flow", "stages"] },
  rocket: { label: "Rocket", tags: ["rocket", "launch", "spacex", "speed"] },
  house: { label: "House", tags: ["house", "home", "property"] },
  lock: { label: "Lock", tags: ["lock", "security", "private"] },
  shield: { label: "Shield", tags: ["shield", "protection", "safety"] },
  globe: { label: "Globe", tags: ["global", "world", "cross-border"] },
  clock: { label: "Clock", tags: ["time", "speed", "delay"] },
  check: { label: "Check", tags: ["verified", "done", "success"] },
  warning: { label: "Warning", tags: ["risk", "problem", "alert"] },
  lightbulb: { label: "Idea", tags: ["idea", "insight", "concept"] },
  magnifier: { label: "Inspect", tags: ["inspect", "search", "analysis"] },
  oldCell: { label: "Old Cell", tags: ["old", "cell", "aging", "senescent"] },
  youngCell: { label: "Young Cell", tags: ["young", "cell", "rejuvenated"] },
  transcriptionSwitch: { label: "Switch", tags: ["transcription", "factor", "switch", "on", "off"] },
  liver: { label: "Liver", tags: ["liver", "organ", "trial", "biology"] },
  flask: { label: "Medicine", tags: ["medicine", "prototype", "drug", "lab", "flask"] },
  moneyBag: { label: "Raise", tags: ["raise", "funding", "money", "series"] },
  calendar: { label: "Timeline", tags: ["calendar", "year", "schedule", "raise"] },
  vial: { label: "Trial", tags: ["vial", "trial", "human", "clinical"] },
  hourglass: { label: "Aging", tags: ["aging", "time", "longevity"] },
  dna: { label: "DNA", tags: ["dna", "genomics", "gene", "epigenetic"] },
  companyMark: { label: "Company", tags: ["company", "logo", "brand", "newlimit"] },
  founder: { label: "Founder", tags: ["founder", "leader", "person", "team"] },
};

export function isKnownAssetKey(value: string): value is KnownAssetKey {
  return (assetKeys as readonly string[]).includes(value);
}

export function assetCatalogPrompt(): string {
  return assetKeys
    .map((key) => `${key}: ${assetCatalog[key].tags.join(", ")}`)
    .join("\n");
}
