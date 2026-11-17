# BUILD LOG — EMBERLINE: Saltworks Yard (make.fun threejs-fps-01)

Built 2026-11-17 00:05–~01:00 WIB, inside the competition transcript window
(opened 2026-11-17 00:00 WIB). All game code written fresh in this session
by Muse subagents; nothing reused from before the opening.

## The game

Round-based Counter-Strike-style tactical FPS, single-player vs 4 bots.
Player is Ember (attackers); bots are Tide (defenders). First to 7 rounds
(max 13). Original map "Saltworks Yard": two bomb sites (A Crane Yard,
B Pump House), mid lane with a central silo, west/east lanes, crates,
barrels, a raised platform. Original names, art, sounds throughout.

- Weapons: P9 Warden pistol, Rook-9 SMG ($1,500), VK-7 Carbine rifle
  ($2,700), LS-50 Longshot sniper ($4,750), F1 Frag grenade ($300).
  Headshot multipliers, recoil + spread bloom, reload, limited ammo.
- Economy: $800 start, $3,250 round win / $1,900 loss, $300 per kill /
  plant / defuse. Buy menu (B or auto-open) in the 12 s buy phase.
- Objective: hold E in a site for 3.2 s to plant the charge (40 s fuse);
  hold E to defuse (5 s player / 3.5 s bot). Rounds also end on
  elimination or time expiry (100 s).
- Bots: hold/patrol the waypoint graph, 28 m / 70-degree vision, burst
  fire with spread, strafe, investigate loud noises, nearest bot defuses
  a planted charge, stop hunting when the player dies.
- HUD: health, ammo, round timer, score, money, bomb status, killfeed,
  grenade count, hints, hitmarker, damage vignette.
- Sounds: all procedural WebAudio (shots, reload, hits, explosion,
  plant/defuse beeps, round win/lose, footsteps). No audio files.
- three.js 0.187.0 vendored byte-for-byte; fixed 60 Hz simulation
  separate from rendering; pooled tracers/particles, no per-frame
  allocation in hot loops; state in one place (state.js).

## Files

- game/index.html, game/src/*.js (13 source files, 122,858 bytes),
  game/vendor/three/ (kit bytes), game/favicon.png
- screenshots/1-start.jpg (menu), 2-buy.jpg (buy menu),
  3-play.jpg (mid-round combat), 4-site.jpg (planted charge at Site A)
  — all 1280x800 JPEG, real Playwright renders, 48–71 KiB each
- main.ts (starter pattern, unchanged), vendor/makefun-threejs.ts
  (kit copy, unchanged), LICENSE (MIT), serve.ts

## Playwright verification (headless Chromium, SwiftShader)

Full suite /tmp/pw/verify.mjs: 20/20 PASS on the final run except one
flaky sampling check (bots-move in a 2 s window at ~0.2x sim speed),
re-checked separately: 2/4 bots moved 3+ m in 12 s; hold/patrol states
explain the rest. Verified: menu -> buy -> live transitions, pointer
lock, buy menu auto-open, grenade purchase ($300), WASD movement
(5.35 m in 3 s), shooting consumes ammo, round end on elimination
(Ember 1–0), next round buy phase, HUD values, zero console errors,
zero failed requests. Focused combat tests: bot return fire (player
100 -> 25 HP), grenade (bot 100 -> -8.7, killed), bomb plant
(Site A, +$300, money $800 -> $1,100). Screenshots visually inspected.

## Gate checks (all PASS)

| check | evidence |
|---|---|
| game_files | 17 files, 2,257,750 bytes, 0 symlinks; index.html 17,703 bytes |
| three_js | module sha256 ef510bae… (kit match), core sha256 613e370f… (kit match); one import map, "three" -> ./vendor/three/three.module.min.js |
| references | no http(s) in index.html/src; all src/href relative inside game/ |
| screenshots | 4 JPEGs, 1280x800, 48,276 / 70,555 / 53,247 / 50,739 bytes (all <= 256 KiB) |
| dossier | text 124,056 bytes < 163,840 cap; all 13 source files whole, no truncation |
| main.ts / output | two runs byte-identical (diff -r clean); /output 22 files, 2,906,207 bytes |
| vendor lib | vendor/makefun-threejs.ts sha256 matches kit copy |
| LICENSE | MIT, identical to starter LICENSE |

## Known limitations

- 1v4 (no friendly bots); player is the only attacker, balanced by bot
  inaccuracy and burst pauses.
- The 0.5 m platform is a step the player cannot climb (acts as cover).
- Bot headshot multiplier is a flat 2.0x (weapons define their own
  headMult for the player).
- Headless SwiftShader runs the sim at ~0.2–0.5x real time; on a real
  machine it runs at full speed.
- NOT submitted. Next step needs the user: create a public empty GitHub
  repo, push this directory, submit with transcripts.
