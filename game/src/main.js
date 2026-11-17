// main.js — EMBERLINE: Saltworks Yard. Boot, fixed-step loop, shooting,
// grenades, round wiring and deterministic ?shot= captures.
// The simulation runs at a fixed 60 Hz; rendering follows the display.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMap } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeaponSystem, WEAPONS, GRENADE } from './weapons.js';
import { createBots } from './bots.js';
import { createGameState, PHASE_TIMES, ECONOMY } from './state.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

// ---------- modules ----------
const map = createMap(scene);
const audio = createAudio();
const hud = createHud();
const effects = createEffects(scene);
const player = createPlayer(map.colliders);
const bots = createBots(scene, map);
const G = createGameState();
const input = createInput(renderer.domElement, onLockChange);

// Weapon sounds: weapons.js calls audio.play(name); adapt to audio.js.
const weaponAudio = {
  play(name) {
    if (name === 'shoot') audio.shot(weapons.state.weaponId === 'pistol' ? 'pistol' : weapons.state.weaponId);
    else if (name === 'reload') audio.reload();
    else if (name === 'dryfire') audio.dryFire();
    else if (name === 'throw') audio.grenadePin();
  },
};
const weapons = createWeaponSystem(camera, weaponAudio);

const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const botHitMeshes = [];
for (const bot of bots.bots) botHitMeshes.push(bot.torso, bot.head);
const shootables = map.shootables.concat(botHitMeshes);

// Reused temporaries: the hot paths allocate nothing.
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();

// ---------- player combat state ----------
const body = player.state;
let playerHealth = 100;
let playerAlive = true;
let owned = new Set(['pistol']);
let noiseEvents = [];
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let prevFiring = false;
let stepSoundTimer = 0;

// Charge mesh: shown where the bomb is planted.
const charge = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.28, 0.36),
  new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.5, metalness: 0.4, emissive: 0x552200 }),
);
charge.visible = false;
charge.castShadow = true;
scene.add(charge);
const chargeLight = new THREE.PointLight(0xff8833, 0, 8, 2);
chargeLight.visible = false;
scene.add(chargeLight);

// Grenade in flight (at most one at a time).
const grenade = {
  active: false, mesh: null, vel: new THREE.Vector3(), fuse: 0, bounced: false,
};
grenade.mesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.09, 10, 8),
  new THREE.MeshStandardMaterial({ color: 0x4a5d23, roughness: 0.8 }),
);
grenade.mesh.visible = false;
scene.add(grenade.mesh);

// ---------- rounds ----------
const rounds = createRounds(G, {
  onPhase(phase) {
    if (phase === 'buy') {
      hud.hideOverlay();
      setupRound();
      if (started) hud.showBuy(buyItems(), G.money, G.timer);
    } else if (phase === 'live') {
      hud.hideOverlay();
      hud.hideBuy();
      hud.setHint('Push a site — hold E inside a marked zone to plant the charge.');
    } else if (phase === 'matchEnd') {
      const winner = G.matchWinner === 'ember' ? 'Ember' : G.matchWinner === 'tide' ? 'Tide' : 'Nobody';
      hud.showOverlay('matchEnd', {
        title: 'MATCH OVER',
        copy: `${winner} takes the yard, ${G.score.ember}–${G.score.tide}.`,
        action: 'Play Again',
      });
      if (document.pointerLockElement) document.exitPointerLock();
    }
  },
  onRoundEnd(winner, reason) {
    const won = winner === 'ember';
    const reasonText = { elimination: 'enemy team eliminated', detonation: 'charge detonated', defuse: 'charge defused', time: 'time expired' }[reason] || reason;
    hud.showOverlay('roundEnd', {
      title: won ? 'ROUND WON' : 'ROUND LOST',
      copy: `Ember ${G.score.ember} – ${G.score.tide} Tide. ${won ? 'Ember wins' : 'Tide wins'}: ${reasonText}.`,
      action: 'Next Round',
    });
    if (won) audio.roundWin(); else audio.roundLose();
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onBombPlanted(site) {
    const s = map.sites[site];
    charge.position.set(s.center.x, 0.15, s.center.z);
    charge.visible = true;
    chargeLight.position.set(s.center.x, 1.2, s.center.z);
    chargeLight.visible = true;
    audio.plantBeep();
    hud.killfeed(`Charge planted at Site ${site} (${s.label})`);
  },
  onBombDefused() {
    charge.visible = false;
    chargeLight.visible = false;
    audio.defuseBeep();
    hud.killfeed('Charge defused');
  },
  onBombExploded() {
    const s = map.sites[G.bomb.site];
    const at = s ? s.center : _to.set(0, 0, 0);
    effects.spawnExplosion(new THREE.Vector3(at.x, 0.6, at.z));
    audio.explosion();
    charge.visible = false;
    chargeLight.visible = false;
    hud.killfeed('Charge detonated');
  },
});

function buyItems() {
  const items = [];
  for (const id of ['pistol', 'smg', 'rifle', 'sniper']) {
    const w = WEAPONS[id];
    items.push({ id, name: w.name, price: w.price, owned: owned.has(id), desc: `${w.damage} dmg · ${w.mag} rounds` });
  }
  items.push({ id: 'grenade', name: GRENADE.name, price: GRENADE.price, owned: false, desc: `Blast ${GRENADE.damage} · radius ${GRENADE.radius} m` });
  return items;
}

function setupRound() {
  bots.reset(map.spawns.defend, G.round);
  const spawn = map.spawns.attack[0];
  body.position.set(spawn[0], 0, spawn[1]);
  body.velocity.set(0, 0, 0);
  body.yaw = 0;
  body.pitch = 0;
  playerHealth = 100;
  playerAlive = true;
  weapons.refillAll();
  weapons.equip(owned.has('rifle') ? 'rifle' : owned.has('smg') ? 'smg' : 'pistol');
  grenade.active = false;
  grenade.mesh.visible = false;
  charge.visible = false;
  chargeLight.visible = false;
  syncHud();
}

function onBuy(id) {
  if (G.phase !== 'buy') return;
  if (id === 'grenade') {
    if (G.money < GRENADE.price) return;
    G.money -= GRENADE.price;
    weapons.addGrenades(1);
    audio.buy();
    hud.showBuy(buyItems(), G.money, G.timer);
    syncHud();
    return;
  }
  const w = WEAPONS[id];
  if (!w) return;
  if (owned.has(id)) {
    weapons.equip(id);
  } else {
    if (G.money < w.price) return;
    G.money -= w.price;
    owned.add(id);
    weapons.equip(id);
    audio.buy();
  }
  hud.showBuy(buyItems(), G.money, G.timer);
  syncHud();
}

hud.onBuy(onBuy);
hud.onPlay(() => {
  audio.unlock();
  if (shot) return;
  if (G.phase === 'menu' || G.phase === 'matchEnd') {
    started = true;
    resetMatch();
    hud.hideOverlay();
    hud.showBuy(buyItems(), G.money, G.timer);
    input.requestLock();
  } else if (G.phase === 'roundEnd') {
    hud.hideOverlay();
    input.requestLock();
  } else {
    hud.hideOverlay();
    input.requestLock();
  }
});

function resetMatch() {
  owned = new Set(['pistol']);
  G.phase = 'buy';
  G.round = 1;
  G.score.ember = 0;
  G.score.tide = 0;
  G.roundWins.ember = 0;
  G.roundWins.tide = 0;
  G.money = 800;
  G.kills.player = 0;
  G.kills.deaths = 0;
  G.lastRoundReason = null;
  G.matchWinner = null;
  G.bomb.state = 'carried';
  G.bomb.site = null;
  G.bomb.plantTimer = 0;
  G.bomb.defuseTimer = 0;
  G.bomb.explodeTimer = 0;
  G.bomb.carrier = 'player';
  G.timer = PHASE_TIMES.buy;
  setupRound();
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    hud.hideOverlay();
    // Keep the buy menu up during the buy phase: keys 1-5 buy, B closes.
    if (G.phase !== 'buy') hud.hideBuy();
  } else if (started && G.phase !== 'menu' && G.phase !== 'roundEnd' && G.phase !== 'matchEnd') {
    if (!hud.isBuyOpen()) hud.showOverlay('paused');
  }
}

// ---------- combat ----------
function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function syncHud() {
  hud.setHealth(playerHealth);
  const w = WEAPONS[weapons.state.weaponId];
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, w ? w.name : GRENADE.name);
  hud.setGrenades(weapons.state.grenades);
  hud.setScore(G.score.ember, G.score.tide, G.round);
  hud.setMoney(G.money);
  hud.setTimer(G.bomb.state === 'planted' ? G.bomb.explodeTimer : G.timer);
  if (G.bomb.state === 'planted') hud.setBomb(`Charge planted at Site ${G.bomb.site} — ${Math.ceil(G.bomb.explodeTimer)}s`, 'planted');
  else if (G.bomb.state === 'carried') hud.setBomb('Charge carried — plant at Site A or B', 'carried');
  else hud.setBomb('', 'none');
  hud.setCrosshairGap(4 + weapons.spread(player.groundSpeed()) * 900);
}

// Ray vs the player's capsule: returns the hit distance along the ray, or -1.
function rayHitsPlayer(from, dir, maxDist) {
  _chest.set(body.position.x, body.position.y + 1.25, body.position.z);
  _closest.copy(_chest).sub(from);
  const t = _closest.dot(dir);
  if (t < 0 || t > maxDist) return -1;
  _closest.copy(from).addScaledVector(dir, t);
  const dChest = _closest.distanceTo(_chest);
  _eye.set(body.position.x, body.position.y + 1.55, body.position.z);
  const dHead = _closest.distanceTo(_eye);
  if (dHead < 0.24) return t;
  if (dChest < 0.45) return t;
  return -1;
}

function los(a, b) {
  _dir.subVectors(b, a);
  const dist = _dir.length();
  if (dist < 0.01) return true;
  _dir.multiplyScalar(1 / dist);
  raycaster.set(a, _dir);
  raycaster.far = dist - 0.1;
  return raycaster.intersectObjects(map.shootables, false).length === 0;
}

// One hitscan shot from `from` along `dir`. `shooter` is 'player' or a bot.
function resolveShot(from, dir, shooter, damage, headMult) {
  raycaster.set(from, dir);
  raycaster.far = 90;
  scene.updateMatrixWorld(true);
  const hits = raycaster.intersectObjects(shootables, false);
  const hit = hits[0];
  const end = _hitPoint;
  if (hit) end.copy(hit.point);
  else end.copy(from).addScaledVector(dir, 80);
  weapons.muzzle.getWorldPosition(_muzzle);
  if (shooter === 'player') {
    effects.spawnTracer(_muzzle, end, 0xffd27a);
    noiseEvents.push({ x: body.position.x, z: body.position.z, loud: 1 });
  } else {
    _from.copy(from);
    effects.spawnTracer(_from, end, 0x9db8ff);
  }
  if (!hit) return;
  const userData = hit.object.userData || {};
  if (shooter === 'player' && userData.entity) {
    const bot = userData.entity;
    const part = userData.part || 'torso';
    bots.damage(bot, damage, part);
    const killed = bot.health <= 0;
    hud.hitMarker(killed, shot ? 4000 : 150);
    audio.hit();
    if (killed) audio.kill();
    effects.spawnImpact(hit.point, hit.face ? hit.face.normal : null, 0xe0524d);
  } else if (shooter !== 'player') {
    // A bot's ray can only reach the player if no wall stopped it first.
    if (!hit || hit.distance > 0) {
      // fallthrough: wall check below
    }
    effects.spawnImpact(hit.point, hit.face ? hit.face.normal : null, 0xcfc8b8);
  } else {
    effects.spawnImpact(hit.point, hit.face ? hit.face.normal : null, 0xcfc8b8);
  }
}

function botShoot(from, dir, shooterBot, damage, headMult) {
  // Wall distance along the bot's ray.
  raycaster.set(from, dir);
  raycaster.far = 90;
  const wall = raycaster.intersectObjects(map.shootables, false)[0];
  const wallDist = wall ? wall.distance : 90;
  if (!playerAlive) return;
  const t = rayHitsPlayer(from, dir, wallDist);
  if (t >= 0) {
    const head = _eye.distanceTo(from.clone().addScaledVector(dir, t)) < 0.3;
    damagePlayer(damage * (head ? headMult : 1), shooterBot);
  }
  // Tracer + sound for the bot's shot.
  _to.copy(from).addScaledVector(dir, Math.min(wallDist, t >= 0 ? t : wallDist));
  effects.spawnTracer(from, _to, 0x9db8ff);
  noiseEvents.push({ x: from.x, z: from.z, loud: 0.8 });
  audio.shot('enemy');
}

function damagePlayer(amount, fromBot) {
  if (!playerAlive) return;
  playerHealth -= amount;
  hud.damageFlash();
  if (playerHealth <= 0) {
    playerHealth = 0;
    playerAlive = false;
    G.kills.deaths += 1;
    hud.killfeed(`${fromBot ? fromBot.name : 'Tide'} ▸ You`);
    if (document.pointerLockElement) document.exitPointerLock();
  }
  syncHud();
}

function playerShoot() {
  const def = WEAPONS[weapons.state.weaponId];
  if (!def) return;
  if (!weapons.pullTrigger()) return;
  camera.getWorldDirection(_dir);
  const spread = shot ? 0 : weapons.spread(player.groundSpeed());
  _dir.x += (random() * 2 - 1) * spread;
  _dir.y += (random() * 2 - 1) * spread;
  _dir.z += (random() * 2 - 1) * spread;
  _dir.normalize();
  camera.getWorldPosition(_from);
  resolveShot(_from, _dir, 'player', def.damage, def.headMult);
  player.recoil(def.kick, (random() * 2 - 1) * def.kick * 0.4);
  syncHud();
}

function throwGrenade() {
  if (!weapons.throwGrenade()) return;
  camera.getWorldDirection(_dir);
  grenade.active = true;
  grenade.fuse = GRENADE.fuse;
  grenade.bounced = false;
  camera.getWorldPosition(_from);
  grenade.mesh.position.copy(_from).addScaledVector(_dir, 0.5);
  grenade.mesh.visible = true;
  grenade.vel.copy(_dir).multiplyScalar(15);
  grenade.vel.y += 3.5;
  noiseEvents.push({ x: body.position.x, z: body.position.z, loud: 1 });
  syncHud();
}

function explodeGrenade() {
  const p = grenade.mesh.position;
  grenade.active = false;
  grenade.mesh.visible = false;
  effects.spawnExplosion(p);
  audio.explosion();
  noiseEvents.push({ x: p.x, z: p.z, loud: 1 });
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.pos.x - p.x, bot.pos.z - p.z);
    if (d < GRENADE.radius) {
      const dmg = Math.max(30, GRENADE.damage * (1 - (d / GRENADE.radius) * 0.7));
      bots.damage(bot, dmg, 'torso');
      hud.hitMarker(bot.health <= 0, 150);
    }
  }
  if (playerAlive) {
    const d = Math.hypot(body.position.x - p.x, body.position.z - p.z);
    if (d < GRENADE.radius) damagePlayer(Math.max(15, GRENADE.damage * 0.5 * (1 - d / GRENADE.radius)), null);
  }
}

function siteAt(x, z) {
  for (const id of ['A', 'B']) {
    const s = map.sites[id];
    const dx = x - s.center.x;
    const dz = z - s.center.z;
    if (dx * dx + dz * dz < s.radius * s.radius) return id;
  }
  return null;
}

// ---------- fixed step ----------
function step(dt) {
  elapsed += dt;
  const keys = input.keys;
  const firing = input.firing;

  // Look + fire (only while locked, or in a capture).
  if (input.locked || shot) {
    const look = input.takeLook();
    player.look(look.x, look.y);
  }
  if (firing && playerAlive && G.phase === 'live') {
    const def = WEAPONS[weapons.state.weaponId];
    if (def) {
      if (def.auto) { if (weapons.ready()) playerShoot(); }
      else if (firing && !prevFiring && weapons.ready()) playerShoot();
    }
  }
  prevFiring = firing;
  if (keys.has('KeyR') && playerAlive) weapons.reload();
  if (keys.has('KeyG') && playerAlive && G.phase === 'live' && !grenade.active) throwGrenade();

  // Weapon switching 1-4 (buy menu closed).
  if (!hud.isBuyOpen()) {
    const switchKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
    const switchIds = ['pistol', 'smg', 'rifle', 'sniper'];
    for (let i = 0; i < 4; i++) {
      if (keys.has(switchKeys[i]) && owned.has(switchIds[i])) weapons.equip(switchIds[i]);
    }
  }
  // Buy menu toggle.
  if (keys.has('KeyB') && G.phase === 'buy' && !hud.isBuyOpen()) {
    hud.showBuy(buyItems(), G.money, G.timer);
    keys.delete('KeyB');
  }

  if (playerAlive && (G.phase === 'live' || G.phase === 'buy')) player.step(dt, keys);
  weapons.step(dt, player.groundSpeed());
  effects.step(dt);

  // Footsteps.
  stepSoundTimer -= dt;
  if (player.groundSpeed() > 1 && stepSoundTimer <= 0) {
    audio.step();
    stepSoundTimer = 0.38;
  }

  // Grenade flight.
  if (grenade.active) {
    grenade.fuse -= dt;
    grenade.vel.y -= 12 * dt;
    const m = grenade.mesh.position;
    m.x += grenade.vel.x * dt;
    m.y += grenade.vel.y * dt;
    m.z += grenade.vel.z * dt;
    if (m.y < 0.1) {
      m.y = 0.1;
      if (!grenade.bounced) { grenade.vel.y *= -0.35; grenade.vel.x *= 0.6; grenade.vel.z *= 0.6; grenade.bounced = true; }
      else { grenade.vel.set(0, 0, 0); }
    }
    if (grenade.fuse <= 0) explodeGrenade();
  }

  // Bots.
  const botApi = {
    playerPos: body.position,
    playerAlive,
    playerCrouching: body.crouching,
    playerFiring: firing,
    playerNoise: firing ? 1 : 0,
    playerSpeed: player.groundSpeed(),
    time: elapsed,
    los,
    shoot: botShoot,
    damagePlayer,
    bomb: G.bomb,
    onBotKilled(bot) {
      rounds.awardKill();
      hud.killfeed(`You ▸ ${bot.name}`);
      syncHud();
    },
    noiseEvents,
  };
  if (G.phase === 'live' || G.phase === 'buy') bots.step(dt, botApi);
  noiseEvents = [];

  // Plant / defuse context: site only counts while E is held.
  const eHeld = keys.has('KeyE');
  const here = siteAt(body.position.x, body.position.z);
  const atSite = playerAlive && eHeld ? here : null;
  let botDefusing = false;
  for (const bot of bots.bots) if (bot.alive && bot.defusing) botDefusing = true;

  rounds.update(dt, {
    playerAlive,
    enemiesAlive: bots.aliveCount(),
    bombCarrierAlive: playerAlive,
    playerAtSite: atSite,
    playerDefusing: playerAlive && eHeld && G.bomb.state === 'planted' && here === G.bomb.site,
    botDefusing,
    time: elapsed,
  });

  // Hints.
  if (G.phase === 'buy') hud.setHint('Buy phase — press B for the buy menu, or wait for the round.');
  else if (G.phase === 'live' && G.bomb.state === 'carried' && here) hud.setHint(`Hold E to plant the charge at Site ${here} (${map.sites[here].label}).`);
  else if (G.phase === 'live' && G.bomb.state === 'planted' && here === G.bomb.site) hud.setHint('Hold E to defuse the charge.');
  else if (G.phase === 'live') hud.setHint('Push a site — hold E inside a marked zone to plant the charge.');
  else hud.setHint('');

  if (G.bomb.state === 'planted') {
    chargeLight.intensity = 2 + Math.sin(elapsed * 6) * 1.5;
  }
  syncHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (frozen) {
    renderer.render(scene, camera);
    return;
  }
  if (!shot && input.locked) {
    const look = input.takeLook();
    player.look(look.x, look.y);
  }
  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    step(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (accumulator > FIXED_STEP * 5) accumulator = 0;
  syncCamera();
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i++) step(FIXED_STEP);
  syncCamera();
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function placeBotForShot(bot, x, z, faceX, faceZ) {
  bot.pos.set(x, 0, z);
  bot.yaw = Math.atan2(faceX - x, faceZ - z);
  bot.state = 'hold';
  bot.holdTimer = 30;
  bot.group.position.copy(bot.pos);
  bot.group.rotation.set(0, bot.yaw, 0);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  started = true;
  resetMatch();
  if (name === 'start') {
    body.position.set(0, 0, 19);
    body.yaw = 0;
    body.pitch = 0;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, 0));
    hud.showOverlay('start');
  } else if (name === 'buy') {
    body.position.set(0, 0, 19);
    body.yaw = 0;
    body.pitch = 0;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, 0));
    G.money = 5200;
    hud.showBuy(buyItems(), G.money, G.timer);
    syncHud();
  } else if (name === 'play') {
    G.phase = 'live';
    G.timer = 87;
    weapons.equip('rifle');
    body.position.set(0, 0, 9);
    settle(10);
    placeBotForShot(bots.bots[0], -3, 3, 0, 9);
    placeBotForShot(bots.bots[1], 4, 4, 0, 9);
    placeBotForShot(bots.bots[2], -6, -1, 0, 9);
    placeBotForShot(bots.bots[3], 6, -2, 0, 9);
    settle(20);
    aimAt(new THREE.Vector3(-3, 1.2, 3));
    playerShoot();
    settle(8);
    aimAt(new THREE.Vector3(4, 1.2, 4));
    playerShoot();
    settle(6);
    aimAt(new THREE.Vector3(-3, 1.2, 3));
    syncHud();
  } else if (name === 'site') {
    G.phase = 'live';
    G.timer = 64;
    weapons.equip('rifle');
    rounds.plantBomb('A', 'player');
    body.position.set(-8, 0, -5);
    settle(10);
    placeBotForShot(bots.bots[0], -16, -14, -8, -5);
    placeBotForShot(bots.bots[1], -21, -16, -8, -5);
    placeBotForShot(bots.bots[2], -19, -11, -8, -5);
    placeBotForShot(bots.bots[3], -12, -17, -8, -5);
    settle(20);
    aimAt(new THREE.Vector3(-16, 1.2, -14));
    playerShoot();
    settle(8);
    aimAt(new THREE.Vector3(-20, 0.6, -15));
    syncHud();
  } else {
    body.position.set(0, 0, 19);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, 0));
  }
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Debug handle for Playwright checks (read-only state, no cheats in play).
window.__ember = { G, player, bots, weapons, map, grenade };

syncCamera();
syncHud();
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
