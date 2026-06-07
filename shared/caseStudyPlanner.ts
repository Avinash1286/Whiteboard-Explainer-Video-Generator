import type { AssetKey } from "./assetCatalog";
import { validateStoryboard, type Beat, type Storyboard, type VisualElement } from "./storyboard";

function visual(assetKey: AssetKey, label: string): Beat["visual"] {
  return {
    type: "asset",
    assetKey,
    label,
    shape: "square",
    position: "center",
    fill: "#a7c7ff",
  };
}

function asset(
  id: string,
  assetKey: AssetKey,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  fill: string,
  delay = 0,
): VisualElement {
  return {
    id,
    type: "asset",
    assetKey,
    x,
    y,
    width,
    height,
    ...(label ? { label } : {}),
    fill,
    delay,
  };
}

function text(
  id: string,
  value: string,
  x: number,
  y: number,
  fontSize = 26,
  delay = 0,
): VisualElement {
  return { id, type: "text", text: value, x, y, fontSize, delay };
}

function arrow(id: string, x: number, y: number, x2: number, y2: number, delay = 0): VisualElement {
  return { id, type: "arrow", x, y, x2, y2, delay };
}

function logo(
  id: string,
  value: string,
  x: number,
  y: number,
  fill: string,
  delay = 0,
): VisualElement {
  return {
    id,
    type: "logo",
    text: value,
    x,
    y,
    width: 118,
    height: 66,
    fill,
    fontSize: 21,
    delay,
  };
}

function beat(id: string, narration: string, elements: VisualElement[], label: string): Beat {
  return {
    id,
    narration,
    visual: visual("generic", label),
    elements,
  };
}

export function matchesNewLimitCaseStudy(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return (
    normalized.includes("newlimit") ||
    (normalized.includes("transcription") && normalized.includes("cell")) ||
    (normalized.includes("series c") && normalized.includes("liver")) ||
    (normalized.includes("epigenetic") && normalized.includes("reprogramming"))
  );
}

export function createNewLimitCaseStudyStoryboard(): Storyboard {
  return validateStoryboard({
    title: "NewLimit case study",
    durationSeconds: 96,
    scenes: [
      {
        id: "scene_1",
        title: "CELL RESET IDEA",
        composition: "flow",
        beats: [
          beat(
            "beat_1",
            "NewLimit is working on a simple-sounding promise: help old cells act young again.",
            [
              asset("el_s1_mark", "companyMark", 560, 162, 92, 92, "", "#fdfcf7"),
              asset("el_s1_old_cell", "oldCell", 250, 334, 126, 126, "OLD CELL", "#d6d0c7"),
            ],
            "old cell",
          ),
          beat(
            "beat_2",
            "The visual story is a reset from an aged cell state toward a younger one.",
            [
              arrow("el_s1_cell_arrow", 420, 398, 608, 398),
              text("el_s1_arrow_text", "act young again", 514, 434, 26, 0.12),
              asset("el_s1_young_cell", "youngCell", 654, 334, 126, 126, "YOUNG CELL", "#91df80", 0.18),
            ],
            "young cell",
          ),
          beat(
            "beat_3",
            "Its core idea is epigenetic reprogramming: changing which cell instructions are switched on or off.",
            [
              asset("el_s1_switch", "transcriptionSwitch", 890, 300, 104, 142, "SWITCHES", "#ffe66d"),
              text("el_s1_epi", "EPIGENETIC\nREPROGRAMMING", 944, 490, 28, 0.16),
              asset("el_s1_dna", "dna", 1008, 336, 98, 98, "DNA", "#b28dff", 0.28),
            ],
            "cell switches",
          ),
        ],
      },
      {
        id: "scene_2",
        title: "FOUNDING TEAM",
        composition: "scatter",
        beats: [
          beat(
            "beat_4",
            "The company was founded in twenty twenty one by a team focused on cellular reprogramming.",
            [
              asset("el_s2_founder_1", "founder", 254, 314, 98, 98, "BRIAN\nARMSTRONG", "#9bd5ff"),
              asset("el_s2_founder_2", "founder", 548, 314, 98, 98, "BLAKE\nBYERS", "#9bd5ff", 0.14),
              asset("el_s2_founder_3", "founder", 842, 314, 98, 98, "JACOB\nKIMMEL CEO", "#9bd5ff", 0.28),
            ],
            "founders",
          ),
          beat(
            "beat_5",
            "The useful takeaway is the team is organized around one scientific bet.",
            [
              text("el_s2_year", "2021", 594, 528, 44),
              text("el_s2_focus", "CELLULAR\nREPROGRAMMING", 594, 592, 31, 0.18),
            ],
            "team focus",
          ),
        ],
      },
      {
        id: "scene_3",
        title: "A.I. GENOMICS PLATFORM",
        composition: "flow",
        beats: [
          beat(
            "beat_6",
            "The platform reads genomic signals and turns them into candidate instructions.",
            [
              asset("el_s3_platform", "chart", 152, 250, 156, 136, "PLATFORM", "#8ec5ff"),
              asset("el_s3_dna", "dna", 370, 270, 94, 94, "GENOMICS", "#b28dff", 0.18),
            ],
            "platform",
          ),
          beat(
            "beat_7",
            "Those instructions become transcription factors, shown as switches that tell cells how to behave.",
            [
              arrow("el_s3_switch_arrow", 504, 326, 604, 326),
              asset("el_s3_switch_1", "transcriptionSwitch", 640, 246, 82, 120, "", "#ffe66d", 0.08),
              asset("el_s3_switch_2", "transcriptionSwitch", 752, 246, 82, 120, "", "#ffe66d", 0.2),
              asset("el_s3_switch_3", "transcriptionSwitch", 864, 246, 82, 120, "TRANSCRIPTION\nFACTORS", "#ffe66d", 0.32),
            ],
            "factors",
          ),
          beat(
            "beat_8",
            "That makes the platform story easier to understand: data becomes switches.",
            [
              text("el_s3_summary", "DATA  ->  SWITCHES", 594, 546, 34),
              text("el_s3_note", "instructions for\ncell behavior", 934, 546, 28, 0.18),
            ],
            "summary",
          ),
        ],
      },
      {
        id: "scene_4",
        title: "LIVER MEDICINE PATH",
        composition: "flow",
        beats: [
          beat(
            "beat_9",
            "The target is not just a diagram: the company points to cells and tissue-like systems.",
            [
              asset("el_s4_old_liver", "liver", 180, 318, 134, 120, "AGED\nLIVER CELL", "#c18b57"),
            ],
            "liver",
          ),
          beat(
            "beat_10",
            "The intended direction is a reset toward healthier cell behavior.",
            [
              arrow("el_s4_liver_arrow", 358, 378, 532, 378),
              asset("el_s4_young_liver", "liver", 580, 318, 134, 120, "YOUNG\nLIVER CELL", "#8bd577", 0.18),
            ],
            "cell reset",
          ),
          beat(
            "beat_11",
            "The result is a prototype medicine path rather than a one-off illustration.",
            [
              arrow("el_s4_medicine_arrow", 752, 378, 890, 348),
              asset("el_s4_flask", "flask", 936, 286, 126, 148, "PROTOTYPE\nMEDICINE", "#cdb4db", 0.16),
            ],
            "medicine",
          ),
        ],
      },
      {
        id: "scene_5",
        title: "SERIES C: 435 MILLION DOLLARS",
        composition: "branch",
        beats: [
          beat(
            "beat_12",
            "NewLimit's latest funding round was a four hundred thirty five million dollar Series C.",
            [asset("el_s5_money", "moneyBag", 528, 168, 138, 138, "RAISE", "#8fcd72")],
            "raise",
          ),
          beat(
            "beat_13",
            "The round included a dense group of capital partners.",
            [
              logo("el_s5_founders", "FOUNDERS\nFUND LEAD", 110, 358, "#ef534f"),
              logo("el_s5_thrive", "THRIVE\nCAPITAL", 275, 358, "#3e3a8d", 0.1),
              logo("el_s5_greenoaks", "GREENOAKS", 440, 358, "#6abd78", 0.2),
              logo("el_s5_quiet", "QUIET\nCAPITAL", 605, 358, "#111111", 0.3),
              logo("el_s5_kleiner", "KLEINER\nPERKINS", 770, 358, "#58a66a", 0.4),
              logo("el_s5_lilly", "ELI LILLY\nVENTURES", 935, 358, "#e64848", 0.5),
            ],
            "investors",
          ),
          beat(
            "beat_14",
            "The money points toward both liver trial work and computational biology teams.",
            [
              arrow("el_s5_arrow_liver", 500, 454, 330, 548),
              asset("el_s5_trial_liver", "liver", 238, 544, 112, 98, "HUMAN\nLIVER TRIAL", "#c18b57", 0.12),
              arrow("el_s5_arrow_team", 664, 454, 696, 548, 0.18),
              asset("el_s5_team", "group", 650, 544, 134, 108, "COMPUTATIONAL\nBIOLOGY TEAMS", "#9bd5ff", 0.3),
            ],
            "uses",
          ),
        ],
      },
      {
        id: "scene_6",
        title: "RUNWAY TO TRIAL",
        composition: "flow",
        beats: [
          beat(
            "beat_15",
            "The raise put NewLimit at a reported three point one billion dollar valuation.",
            [
              asset("el_s6_chart", "chart", 154, 246, 150, 130, "VALUATION", "#79c56d"),
              text("el_s6_value", "3.1\nBILLION\nDOLLARS", 410, 294, 40, 0.12),
              text("el_s6_triple", "more than triple", 284, 496, 30, 0.26),
              arrow("el_s6_up_arrow", 456, 486, 520, 410, 0.36),
            ],
            "valuation",
          ),
          beat(
            "beat_16",
            "It was also described as the third raise in a year, which makes timing part of the story.",
            [
              asset("el_s6_calendar", "calendar", 606, 246, 136, 130, "THIRD RAISE\nIN A YEAR", "#ffe66d"),
              arrow("el_s6_calendar_arrow", 768, 310, 880, 310, 0.12),
            ],
            "calendar",
          ),
          beat(
            "beat_17",
            "The next milestone is a first human trial planned for the following year.",
            [asset("el_s6_vial", "vial", 920, 236, 132, 142, "FIRST HUMAN\nTRIAL NEXT YEAR", "#72bfff")],
            "trial",
          ),
          beat(
            "beat_18",
            "Put together, the visual story is aging, reprogramming, funding, and a clinical path.",
            [
              asset("el_s6_scale", "pipeline", 500, 524, 126, 96, "SCALE-UP", "#9ee7c5"),
              text("el_s6_scale_text", "capital becomes\nexperiments, teams,\nand timelines", 784, 574, 27, 0.14),
            ],
            "scale",
          ),
        ],
      },
    ],
  });
}
