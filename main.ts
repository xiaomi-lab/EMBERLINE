// EMBERLINE for best-game-01 (Node 22, standard library only). The game itself is the static
// files in game/: a desktop browser opens game/index.html with no network, loading ES modules
// plus the three.js copy vendored under game/vendor/. This script hands the entry in, copying
// game/ and screenshots/ from beside it into /output and writing /output/dossier.json, the
// summary the judge reads, through the vendored make.fun library.
//
// EMBERLINE: Saltworks Yard — a round-based tactical FPS. Ember (one player, attackers) versus
// Tide (four bots, defenders) on an original two-site map. First to 7 rounds (max 13). Every
// round starts with a buy phase; attackers plant a charge with E, defenders defuse it, and a
// round ends in a win, a loss, or a detonation. Add 3 or 4 PNG or JPEG screenshots under
// screenshots/ (the first by name is the cover), then run this file.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
