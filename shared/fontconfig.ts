import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const toPosix = (p: string) => p.replace(/\\/g, "/");

/**
 * Make the bundled marker font in assets/fonts available to the SVG rasterizer
 * (libvips/librsvg via fontconfig). librsvg ignores @font-face data URIs, so the
 * only portable path is a fontconfig file with absolute paths pointed at by
 * FONTCONFIG_FILE.
 *
 * libvips reads FONTCONFIG_FILE from the real process environment when its native
 * addon loads, and on Windows a `process.env` mutation is NOT seen by the addon's
 * separate C runtime. So when the variable is missing we re-launch this process
 * once with it set in the child's environment. Import this module before sharp.
 */
export function ensureFontconfig(): void {
  if (process.env.FONTCONFIG_FILE) return; // already set (incl. the re-exec'd child)

  const fontsDir = path.join(root, "assets", "fonts");
  if (!existsSync(path.join(fontsDir, "PatrickHand-Regular.ttf"))) return;

  const confPath = path.join(fontsDir, "fonts.conf");
  const cacheDir = path.join(fontsDir, ".fccache");
  const sysFontDir =
    process.platform === "win32"
      ? "C:/Windows/Fonts"
      : process.platform === "darwin"
        ? "/System/Library/Fonts"
        : "/usr/share/fonts";
  const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>${toPosix(fontsDir)}</dir>
  <dir>${sysFontDir}</dir>
  <cachedir>${toPosix(cacheDir)}</cachedir>
</fontconfig>`;
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(confPath, conf, "utf8");
  } catch {
    return; // best-effort: fall back to the system font stack in DRAW_FONT
  }
  const confPosix = toPosix(confPath);

  // Non-Windows: an in-process env write reaches the addon, so no re-exec needed.
  if (process.platform !== "win32") {
    process.env.FONTCONFIG_FILE = confPosix;
    return;
  }

  const result = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, FONTCONFIG_FILE: confPosix },
  });
  if (result.error) {
    process.env.FONTCONFIG_FILE = confPosix; // best-effort if the re-exec failed
    return;
  }
  process.exit(result.status ?? 0);
}

// Run on import so the variable is set before sharp/libvips initialises fontconfig.
ensureFontconfig();
