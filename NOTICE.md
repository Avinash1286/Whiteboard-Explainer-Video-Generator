# Third-Party Notices & Attributions

This project's **source code** is released under the MIT License (see `LICENSE`).

However, the repository also bundles and/or generates **assets** (icons and fonts)
that are covered by **their own upstream licenses**. Those licenses are *not* MIT,
and some carry obligations (attribution and/or share-alike) that you must keep when
you redistribute this project or videos made with it. The relevant ones are listed
below.

---

## OpenMoji icons — CC BY-SA 4.0

The bundled icon set under `assets/vendor/openmoji/` (and the OpenMoji-derived
artwork under `assets/generated/openmoji-inspired/`) is based on **OpenMoji**.

- Project: https://openmoji.org
- License: **Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)**
- License text: https://creativecommons.org/licenses/by-sa/4.0/
- Copyright: © OpenMoji – the open-source emoji and icon project. License: CC BY-SA 4.0

**What this requires of you:**
- **Attribution** — keep this credit (in the app, the repo, and ideally in/near
  generated videos that display these icons).
- **ShareAlike** — if you modify the OpenMoji artwork and distribute it, the
  modified artwork must also be licensed CC BY-SA 4.0.

A suggested credit line for rendered output or an "About" page:

> Icons by OpenMoji (https://openmoji.org), licensed under CC BY-SA 4.0.

---

## Excalidraw libraries — MIT

The hand-drawn icon libraries under `assets/vendor/excalidraw/` (when present) are
sourced from the **Excalidraw** ecosystem and its community libraries.

- Project: https://excalidraw.com  •  Libraries: https://libraries.excalidraw.com
- License: **MIT** (per the Excalidraw project and the individual library authors)

**What this requires of you:** retain the MIT copyright/permission notice. Individual
library authors retain copyright to their own contributed shapes.

> Note: this set is **git-ignored by default** (regenerated via `scripts/excalidraw/*`).
> If you commit it, keep this attribution.

---

## Fonts

Fonts under `assets/fonts/` are distributed under their own open-source licenses,
typically the **SIL Open Font License 1.1 (OFL)** or the **Apache License 2.0**.

- SIL OFL 1.1: https://openfontlicense.org
- Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0

**What this requires of you:** retain each font's license/copyright file as shipped
by its author, and do not sell the fonts on their own. Check the individual font
files/folders for the exact license and reserved font names.

---

## In short

| Asset | License | Obligation when you redistribute |
|---|---|---|
| OpenMoji icons | CC BY-SA 4.0 | **Attribution + ShareAlike** |
| Excalidraw libraries | MIT | Keep copyright/permission notice |
| Fonts | OFL 1.1 / Apache-2.0 | Keep font license files |
| Everything else (the code) | MIT | Keep `LICENSE` |

If you add or swap assets, update this file accordingly.
