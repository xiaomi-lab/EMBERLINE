// bots.js — enemy bot AI for EMBERLINE: Saltworks Yard.
// Four defenders ('tide') vs the lone attacker (the player, 'ember').
// Bots hold sites, patrol the waypoint graph, hear noise, hunt on sight,
// fire in bursts, and move to defuse a planted bomb. No DOM, no network.
// main.js drives step(dt, api); bots call api.shoot and main.js resolves
// the ray. main.js damages bots via bot.health or damage(); step() plays
// the fall and calls api.onBotKilled once. api: { playerPos, playerAlive,
// playerCrouching, playerFiring, playerNoise, playerSpeed, time,
// los(a, b), shoot(from, dir, shooter, damage, headMult),
// damagePlayer(amount, fromPos), bomb, onBotKilled(bot),
// noiseEvents: [{ x, z, loud }] }

import * as THREE from 'three';

export const BOT_NAMES = ['Ash', 'Bramble', 'Cinder', 'Flint'];
export const BOT_COUNT = 4;
export const BOT_SPEED = 3.4;
export const BOT_VISION_RANGE = 28;
export const BOT_VISION_HALF_ANGLE = 70; // degrees either side of facing
export const BOT_HEAR_RANGE = 25;
export const BOT_DEFUSE_TIME = 3.5;
export const BOT_SHOT_DAMAGE = 25;
export const BOT_HEAD_MULT = 2.0;

// Module-scope temporaries: step() must not allocate per frame.
const _toPlayer = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _move = new THREE.Vector3();
const _sitePos = new THREE.Vector3();
const _probe = new THREE.Box3();
const _probeMin = new THREE.Vector3();
const _probeMax = new THREE.Vector3();
const _wp = new THREE.Vector3();
const COS_VISION = Math.cos((BOT_VISION_HALF_ANGLE * Math.PI) / 180);

// Waypoints may be Vector3s, { x, z } objects, or { pos, links } nodes.
function waypointPos(map, index, out) {
  const wp = map.waypoints[index];
  if (!wp) return out.set(0, 0, 0);
  if (wp.isVector3) return out.copy(wp);
  if (wp.pos && wp.pos.isVector3) return out.copy(wp.pos);
  if (wp.pos) return out.set(wp.pos.x || 0, 0, wp.pos.z || 0);
  if (wp.position && wp.position.isVector3) return out.copy(wp.position);
  return out.set(wp.x || 0, 0, wp.z || 0);
}
function waypointLinks(map, index) {
  const wp = map.waypoints[index];
  if (!wp) return null;
  return wp.links || wp.neighbors || wp.next || null;
}
function sitePosition(map, siteId, out) {
  const sites = map.sites || map.sitePositions || null;
  if (sites) {
    const s = sites[siteId];
    if (s) {
      // map.js shape: { center: Vector3, radius, label }.
      if (s.center) {
        if (s.center.isVector3) return out.copy(s.center);
        return out.set(s.center.x || 0, 0, s.center.z || 0);
      }
      if (s.isVector3) return out.copy(s);
      return out.set(s.x || 0, 0, s.z || 0);
    }
  }
  for (let i = 0; i < (map.waypoints || []).length; i++) {
    const wp = map.waypoints[i];
    if (wp && (wp.site === siteId || wp.siteId === siteId)) return waypointPos(map, i, out);
  }
  return out.set(0, 0, 0);
}
function makeBotMesh(name, accent) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.85 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.9 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5, metalness: 0.4 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.36), bodyMat); torso.position.y = 1.05;
  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.06), accentMat); chestPlate.position.set(0, 1.15, 0.2);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), skinMat); head.position.y = 1.62;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.06), accentMat); visor.position.set(0, 1.64, 0.18);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.72), gunMat); gun.position.set(0.28, 1.18, 0.42);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.32), bodyMat); legs.position.y = 0.31;
  group.add(torso, chestPlate, head, visor, gun, legs);
  group.traverse((child) => { child.userData.botName = name; });
  return { group, torso, head, gun };
}

export function createBots(scene, map) {
  const waypoints = map.waypoints || [];
  const colliders = map.colliders || [];
  const accents = [0x3b82f6, 0x60a5fa, 0x2563eb, 0x93c5fd];
  const bots = [];
  for (let i = 0; i < BOT_COUNT; i++) {
    const built = makeBotMesh(BOT_NAMES[i], accents[i]);
    const bot = {
      id: i, name: BOT_NAMES[i], team: 'tide', health: 100, alive: true,
      pos: new THREE.Vector3(0, 0, 0), yaw: 0, pitch: 0, speed: BOT_SPEED,
      state: 'hold', waypoint: 0, targetWaypoint: 0, group: built.group, // hold|patrol|hunt|defuse|retreat
      torso: built.torso, head: built.head, gun: built.gun, shootCooldown: 0,
      burstLeft: 0, burstTimer: 0, pauseTimer: 0, accuracy: 0.03, // base spread, radians
      hearPos: new THREE.Vector3(0, 0, 0), lastSeen: new THREE.Vector3(0, 0, 0),
      holdTimer: 0, scanDir: 1, defuseProgress: 0, defusing: false, fallT: 0, _killedReported: false,
    };
    bot.torso.userData = { entity: bot, part: 'torso' };
    bot.head.userData = { entity: bot, part: 'head' };
    bot.group.userData = { entity: bot, part: 'torso' };
    scene.add(bot.group);
    bots.push(bot);
  }
  function collides(x, z) {
    // Probe starts just above the ground slab: map.js registers the ground
    // itself as a collider (max y = 0), so a probe starting at y = 0 would
    // intersect it everywhere and no bot could ever move. Colliders whose
    // top is at/below ankle height are skipped for the same reason.
    _probeMin.set(x - 0.35, 0.05, z - 0.35);
    _probeMax.set(x + 0.35, 1.8, z + 0.35);
    _probe.min.copy(_probeMin);
    _probe.max.copy(_probeMax);
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (!c) continue;
      if (c.isBox3) {
        if (c.max.y <= 0.05) continue;
        if (_probe.intersectsBox(c)) return true;
      } else if (c.min && c.max) {
        const minX = c.min.x ?? c.min[0], maxX = c.max.x ?? c.max[0];
        const minZ = c.min.z ?? c.min[2], maxZ = c.max.z ?? c.max[2];
        const maxY = c.max.y ?? c.max[1];
        if (maxY !== undefined && maxY <= 0.05) continue;
        if (_probeMin.x < maxX && _probeMax.x > minX && _probeMin.z < maxZ && _probeMax.z > minZ) return true;
      }
    }
    return false;
  }
  // Move in the XZ plane toward (tx, tz), sliding along walls: try the full
  // step, then X-only, then Z-only. Returns true when it arrived.
  function moveToward(bot, tx, tz, dt, speedMul) {
    _move.set(tx - bot.pos.x, 0, tz - bot.pos.z);
    const dist = _move.length();
    if (dist < 0.05) return true;
    _move.multiplyScalar(1 / dist);
    const stepLen = bot.speed * (speedMul || 1) * dt;
    const nx = bot.pos.x + _move.x * stepLen;
    const nz = bot.pos.z + _move.z * stepLen;
    if (!collides(nx, nz)) { bot.pos.x = nx; bot.pos.z = nz; }
    else if (!collides(nx, bot.pos.z)) bot.pos.x = nx;
    else if (!collides(bot.pos.x, nz)) bot.pos.z = nz;
    return dist <= Math.max(stepLen, 0.6);
  }
  function faceToward(bot, tx, tz, dt) {
    const targetYaw = Math.atan2(tx - bot.pos.x, tz - bot.pos.z);
    let d = targetYaw - bot.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    bot.yaw += Math.max(-6 * dt, Math.min(6 * dt, d));
  }
  function pickNextWaypoint(bot) {
    const links = waypointLinks(map, bot.waypoint);
    if (links && links.length > 0) {
      bot.targetWaypoint = links[(Math.random() * links.length) | 0];
    } else if (waypoints.length > 0) {
      bot.targetWaypoint = (Math.random() * waypoints.length) | 0;
    }
  }
  function nearestAliveBotTo(x, z) {
    let best = null, bestD = Infinity;
    for (const b of bots) {
      if (!b.alive) continue;
      const d = (b.pos.x - x) * (b.pos.x - x) + (b.pos.z - z) * (b.pos.z - z);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }
  function die(bot, api) {
    bot.alive = false; bot.state = 'retreat'; bot.burstLeft = 0; bot.defusing = false;
    if (!bot._killedReported) {
      bot._killedReported = true;
      if (api && typeof api.onBotKilled === 'function') api.onBotKilled(bot);
    }
  }
  function fireShot(bot, api) {
    _eye.set(bot.pos.x, bot.pos.y + 1.45, bot.pos.z);
    // Player pos may be feet (y ~ 0) or eye level; aim at the chest either way.
    const aimY = api.playerPos.y > 1 ? api.playerPos.y - 0.35 : api.playerPos.y + 1.25;
    const headShot = Math.random() < 0.15;
    _chest.set(api.playerPos.x, headShot ? aimY + 0.3 : aimY, api.playerPos.z);
    _dir.subVectors(_chest, _eye).normalize();
    // Spread grows when the player is moving fast; crouching shrinks it.
    let err = bot.accuracy + (api.playerSpeed || 0) * 0.004;
    if (api.playerCrouching) err *= 0.7;
    _dir.x += (Math.random() - 0.5) * 2 * err; _dir.y += (Math.random() - 0.5) * 2 * err; _dir.z += (Math.random() - 0.5) * 2 * err;
    _dir.normalize();
    if (typeof api.shoot === 'function') api.shoot(_eye, _dir, bot, BOT_SHOT_DAMAGE, BOT_HEAD_MULT);
  }
  function canSeePlayer(bot, api) {
    if (!api.playerAlive) return false;
    _toPlayer.subVectors(api.playerPos, bot.pos); _toPlayer.y = 0;
    const dist = _toPlayer.length();
    if (dist > BOT_VISION_RANGE || dist < 0.001) return false;
    _fwd.set(Math.sin(bot.yaw), 0, Math.cos(bot.yaw));
    if (_toPlayer.x * _fwd.x + _toPlayer.z * _fwd.z < dist * COS_VISION) return false;
    _eye.set(bot.pos.x, bot.pos.y + 1.45, bot.pos.z);
    _chest.copy(api.playerPos);
    return typeof api.los === 'function' ? api.los(_eye, _chest) : true;
  }
  function reset(spawnPoints, round) {
    const spawns = spawnPoints || map.defendSpawns || (map.spawns && map.spawns.defend) || map.spawns || [];
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      const s = spawns[i % Math.max(spawns.length, 1)];
      if (s) {
        if (s.isVector3) bot.pos.copy(s);
        // map.js spawns are [x, z] pairs (spawns.defend / spawns.attack).
        else if (Array.isArray(s)) bot.pos.set(s[0] || 0, 0, s.length > 2 ? s[2] : s[1] || 0);
        else bot.pos.set(s.x || 0, 0, s.z || 0);
      } else waypointPos(map, i * 2, bot.pos);
      bot.pos.y = 0;
      bot.health = 100; bot.alive = true; bot.state = i < 2 ? 'hold' : 'patrol';
      bot.yaw = Math.random() * Math.PI * 2; bot.pitch = 0;
      bot.shootCooldown = 0; bot.burstLeft = 0; bot.burstTimer = 0;
      bot.pauseTimer = 0.5 + Math.random() * 0.5; bot.holdTimer = 0;
      bot.defuseProgress = 0; bot.defusing = false; bot.fallT = 0; bot._killedReported = false;
      bot.hearPos.set(bot.pos.x, 0, bot.pos.z);
      bot.lastSeen.copy(bot.pos);
      // Hold waypoint: nearest waypoint to the spawn point.
      let best = 0, bestD = Infinity;
      for (let w = 0; w < waypoints.length; w++) {
        waypointPos(map, w, _wp);
        const d = (_wp.x - bot.pos.x) * (_wp.x - bot.pos.x) + (_wp.z - bot.pos.z) * (_wp.z - bot.pos.z);
        if (d < bestD) { bestD = d; best = w; }
      }
      bot.waypoint = best;
      bot.targetWaypoint = best;
      bot.group.visible = true;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.position.copy(bot.pos);
    }
    void round;
  }
  function step(dt, api) {
    if (!api || dt <= 0) return;
    const bombPlanted = api.bomb && api.bomb.state === 'planted';
    let defuser = null;
    if (bombPlanted) {
      sitePosition(map, api.bomb.site, _sitePos);
      defuser = nearestAliveBotTo(_sitePos.x, _sitePos.z);
    }
    for (const bot of bots) {
      if (!bot.alive) {
        // Death fall: rotate the group onto its back over 0.4 s, then stay.
        if (bot.fallT < 1) { bot.fallT = Math.min(1, bot.fallT + dt / 0.4); bot.group.rotation.set(-1.45 * bot.fallT, bot.yaw, 0); }
        continue;
      }
      if (bot.health <= 0) { die(bot, api); continue; }
      bot.shootCooldown = Math.max(0, bot.shootCooldown - dt);
      // Hearing: a loud noise nearby pulls the bot to investigate.
      const noises = api.noiseEvents || [];
      for (let n = 0; n < noises.length; n++) {
        const ev = noises[n];
        const loud = ev.loud === true ? 1 : (typeof ev.loud === 'number' ? ev.loud : 0);
        if (loud <= 0.4) continue;
        const dx = ev.x - bot.pos.x, dz = ev.z - bot.pos.z;
        if (dx * dx + dz * dz > BOT_HEAR_RANGE * BOT_HEAR_RANGE) continue;
        if (bot.state !== 'hunt' && bot.state !== 'defuse') { bot.hearPos.set(ev.x, 0, ev.z); bot.state = 'patrol'; bot.targetWaypoint = bot.waypoint; }
        break;
      }
      // Bomb planted: the nearest bot defuses, the rest cover the site.
      if (bombPlanted && bot === defuser) {
        bot.state = 'defuse';
        sitePosition(map, api.bomb.site, _sitePos);
        const dx = _sitePos.x - bot.pos.x, dz = _sitePos.z - bot.pos.z;
        if (dx * dx + dz * dz > 1.44) {
          bot.defusing = false;
          bot.defuseProgress = 0;
          faceToward(bot, _sitePos.x, _sitePos.z, dt);
          moveToward(bot, _sitePos.x, _sitePos.z, dt, 1);
        } else {
          // Standing on the bomb for BOT_DEFUSE_TIME defuses it; main.js
          // watches bot.defusing / bot.defuseProgress and resolves it.
          bot.defusing = true; bot.defuseProgress += dt;
          faceToward(bot, _sitePos.x, _sitePos.z, dt);
        }
        bot.group.position.copy(bot.pos); bot.group.rotation.set(0, bot.yaw, 0);
        continue;
      }
      if (bombPlanted) {
        sitePosition(map, api.bomb.site, _sitePos);
        faceToward(bot, _sitePos.x, _sitePos.z, dt);
        moveToward(bot, _sitePos.x, _sitePos.z, dt, 0.7);
        bot.group.position.copy(bot.pos); bot.group.rotation.set(0, bot.yaw, 0);
        continue;
      }
      // Player dead: stop hunting, drift back to the sites.
      if (!api.playerAlive) {
        if (bot.state === 'hunt') bot.state = 'patrol';
        waypointPos(map, bot.targetWaypoint, _wp);
        if (moveToward(bot, _wp.x, _wp.z, dt, 0.6)) {
          bot.waypoint = bot.targetWaypoint;
          pickNextWaypoint(bot);
        }
        bot.group.position.copy(bot.pos); bot.group.rotation.set(0, bot.yaw, 0);
        continue;
      }
      const sees = canSeePlayer(bot, api);
      if (sees) {
        bot.state = 'hunt';
        bot.lastSeen.copy(api.playerPos);
        faceToward(bot, api.playerPos.x, api.playerPos.z, dt);
        _toPlayer.subVectors(api.playerPos, bot.pos);
        _toPlayer.y = 0;
        const dist = _toPlayer.length() || 1;
        const px = -_toPlayer.z / dist, pz = _toPlayer.x / dist;
        // Strafe a little so the bot is not a static target.
        const strafe = Math.sin((api.time || 0) * 1.7 + bot.id * 2.1) * 0.8;
        if (dist > 14) moveToward(bot, api.playerPos.x, api.playerPos.z, dt, 0.9);
        else if (dist < 6) moveToward(bot, bot.pos.x - _toPlayer.x / dist, bot.pos.z - _toPlayer.z / dist, dt, 0.7);
        else moveToward(bot, bot.pos.x + px * strafe, bot.pos.z + pz * strafe, dt, 0.5);
        // Burst fire: 3-5 shots, 0.12 s apart, then a 0.9 s pause.
        if (bot.burstLeft > 0) {
          bot.burstTimer -= dt;
          if (bot.burstTimer <= 0) {
            fireShot(bot, api);
            bot.burstLeft -= 1;
            bot.burstTimer = 0.12;
            if (bot.burstLeft === 0) bot.pauseTimer = 0.9;
          }
        } else if (bot.pauseTimer > 0) {
          bot.pauseTimer -= dt;
        } else {
          bot.burstLeft = 3 + ((Math.random() * 3) | 0);
          bot.burstTimer = 0;
        }
      } else {
        if (bot.state === 'hunt') bot.state = 'patrol';
        bot.burstLeft = 0;
        bot.pauseTimer = Math.max(bot.pauseTimer, 0.3);
        const heard = bot.hearPos.x !== bot.pos.x || bot.hearPos.z !== bot.pos.z;
        if (heard && bot.state === 'patrol' && bot.targetWaypoint === bot.waypoint) {
          // Investigate a heard noise first, then patrol the graph.
          if (moveToward(bot, bot.hearPos.x, bot.hearPos.z, dt, 1)) {
            bot.hearPos.set(bot.pos.x, 0, bot.pos.z);
            bot.holdTimer = 1.5;
          }
          faceToward(bot, bot.hearPos.x, bot.hearPos.z, dt);
        } else if (bot.holdTimer > 0) {
          // Hold: scan the area by slowly sweeping the facing yaw.
          bot.holdTimer -= dt;
          bot.yaw += bot.scanDir * dt * 0.45;
          if (Math.random() < dt * 0.4) bot.scanDir *= -1;
        } else {
          waypointPos(map, bot.targetWaypoint, _wp);
          faceToward(bot, _wp.x, _wp.z, dt);
          if (moveToward(bot, _wp.x, _wp.z, dt, 1)) {
            bot.waypoint = bot.targetWaypoint;
            bot.holdTimer = bot.state === 'hold' ? 1 + Math.random() * 2 : 0.4;
            pickNextWaypoint(bot);
          }
        }
      }
      bot.group.position.copy(bot.pos); bot.group.rotation.set(0, bot.yaw, 0);
    }
  }
  function aliveCount() {
    let n = 0;
    for (const b of bots) if (b.alive) n++;
    return n;
  }
  // main.js lowers bot.health on a hit; this is the explicit entry point
  // for that, so callers do not poke fields ad hoc. Death is resolved in
  // step() so onBotKilled fires exactly once, on the next frame.
  function damage(bot, amount, part) {
    if (!bot || !bot.alive) return;
    bot.health -= amount * (part === 'head' ? BOT_HEAD_MULT : 1);
  }
  return { bots, reset, step, aliveCount, damage };
}
