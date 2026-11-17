# EMBERLINE: Saltworks Yard

A round-based tactical FPS built for the make.fun `threejs-fps-01` bounty
("Make the best three.js tactical FPS", $1,000 prize).

Single-player vs 4 bots. Player is Ember (attackers); bots are Tide
(defenders). First to 7 rounds (max 13). Original map "Saltworks Yard":
two bomb sites (A Crane Yard, B Pump House), mid lane with a central silo,
crates, barrels, and a raised platform.

## How to play

Open `game/index.html` in a browser, or run the local server:

```
node serve.ts
```

- **WASD** move, **mouse** aim, **click** shoot, **R** reload
- **B** buy menu (auto-opens in the 12 s buy phase)
- **E** (hold) plant / defuse the charge
- **G** throw a frag grenade

## Features

- Weapons: P9 Warden pistol, Rook-9 SMG ($1,500), VK-7 Carbine rifle
  ($2,700), LS-50 Longshot sniper ($4,750), F1 Frag grenade ($300).
  Headshot multipliers, recoil + spread bloom, reload, limited ammo.
- Economy: $800 start, $3,250 round win / $1,900 loss, $300 per kill /
  plant / defuse.
- Objective: hold E in a site for 3.2 s to plant the charge (40 s fuse);
  hold E to defuse (5 s player / 3.5 s bot).
- Bots: hold/patrol the waypoint graph, vision cones, burst fire with
  spread, strafe, investigate loud noises, nearest bot defuses.
- HUD: health, ammo, round timer, score, money, bomb status, killfeed,
  grenade count, hints, hitmarker, damage vignette.
- Sounds: all procedural WebAudio. No audio files.
- three.js 0.187.0 vendored; fixed 60 Hz simulation separate from
  rendering.

## Files

- `game/index.html`, `game/src/*.js` — the game
- `game/vendor/three/` — vendored three.js
- `screenshots/` — real gameplay renders
- `main.ts` — dossier generator (make.fun starter pattern)
- `serve.ts` — local dev server
- `BUILD_LOG.md` — full build + verification log

## License

MIT. See `LICENSE`.
