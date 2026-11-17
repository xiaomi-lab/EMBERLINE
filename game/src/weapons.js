// weapons.js — weapon definitions, viewmodel, ammo, recoil bloom and grenades
// for EMBERLINE: Saltworks Yard. Original names/stats; box-geometry viewmodel
// rebuilt on equip, with a muzzle flash plane + point light.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Warden', price: 0, damage: 34, headMult: 3.0,
    mag: 12, reserve: 48, fireGap: 0.16, reloadTime: 1.4, auto: false,
    spreadStill: 0.004, spreadMove: 0.03, speed: 5.2, kick: 0.006,
  },
  rifle: {
    id: 'rifle', name: 'VK-7 Carbine', price: 2700, damage: 33, headMult: 3.2,
    mag: 30, reserve: 90, fireGap: 0.096, reloadTime: 1.9, auto: true,
    spreadStill: 0.0022, spreadMove: 0.028, speed: 5.2, kick: 0.009,
  },
  smg: {
    id: 'smg', name: 'Rook-9', price: 1500, damage: 26, headMult: 3.0,
    mag: 25, reserve: 100, fireGap: 0.07, reloadTime: 1.7, auto: true,
    spreadStill: 0.004, spreadMove: 0.034, speed: 5.6, kick: 0.006,
  },
  sniper: {
    id: 'sniper', name: 'LS-50 Longshot', price: 4750, damage: 110, headMult: 2.0,
    mag: 5, reserve: 15, fireGap: 1.1, reloadTime: 3.2, auto: false,
    spreadStill: 0.0008, spreadMove: 0.05, speed: 4.6, kick: 0.03,
  },
};

export const GRENADE = {
  id: 'grenade', name: 'F1 Frag', price: 300, damage: 110, radius: 6, fuse: 1.6,
};
// Viewmodel colours; the warm accent comes from the shared palette.
const METAL = 0x2b2e35;
const DARK = 0x17181c;
const GRIP = 0x3a2f26;
const ACCENT = parseInt(PALETTE.accent.slice(1), 16);
const FLASH_COLOR = ACCENT;

const BASE_POS = { x: 0.24, y: -0.2, z: -0.42 };
const BLOOM_PER_SHOT = 0.004, BLOOM_MAX = 0.02;
const BLOOM_DECAY = 0.03, KICK_DECAY = 0.12;

export function createWeaponSystem(camera, audio) {
  // Per-weapon ammo, preserved across switches.
  const ammo = {};
  for (const id of Object.keys(WEAPONS)) {
    ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
  }

  const state = {
    weaponId: 'pistol',
    mag: WEAPONS.pistol.mag,
    reserve: WEAPONS.pistol.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    grenades: 1,
  };

  let bloom = 0;
  let time = 0;
  let bobPhase = 0;

  const group = new THREE.Group();
  group.position.set(BASE_POS.x, BASE_POS.y, BASE_POS.z);
  camera.add(group);

  // Muzzle anchor at the barrel tip; rebuilt per weapon.
  const muzzle = new THREE.Object3D();
  group.add(muzzle);

  const flashMat = new THREE.MeshBasicMaterial({
    color: FLASH_COLOR, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
  flashMesh.visible = false;
  muzzle.add(flashMesh);

  const flashLight = new THREE.PointLight(FLASH_COLOR, 0, 6, 2);
  muzzle.add(flashLight);

  const metalMat = new THREE.MeshStandardMaterial({ color: METAL, roughness: 0.55, metalness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.7, metalness: 0.5 });
  const gripMat = new THREE.MeshStandardMaterial({ color: GRIP, roughness: 0.9, metalness: 0.1 });
  const accentMat = new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.5, metalness: 0.6 });
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x4a5d23, roughness: 0.8, metalness: 0.3 });

  function box(w, h, d, mat, x, y, z, parent) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    (parent || group).add(mesh);
    return mesh;
  }

  // Proportions per weapon; the sniper is longest, the pistol shortest.
  function rebuild() {
    // Remove old gun meshes, keep the muzzle anchor and its children.
    for (let i = group.children.length - 1; i >= 0; i--) {
      const child = group.children[i];
      if (child !== muzzle) group.remove(child);
    }
    const def = WEAPONS[state.weaponId];
    if (state.weaponId === 'grenade') {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), grenadeMat);
      ball.position.set(0, 0, 0);
      group.add(ball);
      box(0.02, 0.03, 0.02, metalMat, 0, 0.065, 0, group);
      muzzle.position.set(0, 0, -0.08);
      return;
    }
    let receiver;
    let barrelLen;
    if (state.weaponId === 'pistol') {
      receiver = [0.05, 0.07, 0.22];
      barrelLen = 0.1;
      box(receiver[0], receiver[1], receiver[2], metalMat, 0, 0, -0.05);
      box(0.045, 0.09, 0.05, gripMat, 0, -0.07, 0.05);
      box(0.02, 0.02, barrelLen, darkMat, 0, 0.01, -0.2);
      box(0.012, 0.015, 0.01, accentMat, 0, 0.045, -0.14);
    } else if (state.weaponId === 'rifle') {
      receiver = [0.06, 0.09, 0.42];
      barrelLen = 0.3;
      box(receiver[0], receiver[1], receiver[2], metalMat, 0, 0, -0.1);
      box(0.05, 0.06, 0.16, gripMat, 0, -0.06, -0.18);
      box(0.05, 0.08, 0.1, darkMat, 0, -0.01, 0.12);
      box(0.04, 0.05, 0.06, gripMat, 0, -0.08, -0.02);
      box(0.025, 0.025, barrelLen, darkMat, 0, 0.01, -0.44);
      box(0.03, 0.05, 0.03, accentMat, 0, 0.06, -0.28);
    } else if (state.weaponId === 'smg') {
      receiver = [0.055, 0.08, 0.34];
      barrelLen = 0.16;
      box(receiver[0], receiver[1], receiver[2], metalMat, 0, 0, -0.08);
      box(0.05, 0.07, 0.05, gripMat, 0, -0.07, 0.06);
      box(0.04, 0.1, 0.05, darkMat, 0, -0.09, -0.16);
      box(0.025, 0.025, barrelLen, darkMat, 0, 0.01, -0.32);
      box(0.05, 0.02, 0.2, accentMat, 0, 0.05, -0.18);
    } else {
      // sniper: long barrel, scope, bolt.
      receiver = [0.06, 0.09, 0.5];
      barrelLen = 0.48;
      box(receiver[0], receiver[1], receiver[2], darkMat, 0, 0, -0.12);
      box(0.045, 0.05, 0.1, gripMat, 0, -0.07, 0.1);
      box(0.05, 0.08, 0.12, darkMat, 0, -0.01, 0.16);
      box(0.035, 0.035, 0.16, metalMat, 0, 0.075, -0.2);
      box(0.025, 0.025, barrelLen, darkMat, 0, 0.01, -0.58);
      box(0.02, 0.03, 0.03, accentMat, 0.04, 0.01, -0.05);
    }
    muzzle.position.set(0, 0.01, -0.2 - barrelLen - 0.06);
  }

  function playSound(name) {
    if (!audio) return;
    if (typeof audio.play === 'function') { audio.play(name); return; }
    if (typeof audio.playShot === 'function' && name === 'shoot') { audio.playShot(); return; }
    const fn = audio[name];
    if (typeof fn === 'function') fn.call(audio);
  }

  function saveAmmo() {
    ammo[state.weaponId] = { mag: state.mag, reserve: state.reserve };
  }

  function equip(id, keepAmmo = true) {
    if (!WEAPONS[id] && id !== 'grenade') return false;
    saveAmmo();
    if (!keepAmmo && WEAPONS[id]) {
      ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    }
    state.weaponId = id;
    if (WEAPONS[id]) {
      state.mag = ammo[id].mag;
      state.reserve = ammo[id].reserve;
    }
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    bloom = 0;
    rebuild();
    return true;
  }

  function ready() {
    return state.cooldown <= 0 && state.reloadLeft <= 0;
  }

  function takeRound() {
    if (state.mag <= 0) return false;
    state.mag -= 1;
    return true;
  }

  function reload() {
    const def = WEAPONS[state.weaponId];
    if (!def) return false;
    if (state.reloadLeft > 0 || state.mag >= def.mag || state.reserve <= 0) return false;
    state.reloadLeft = def.reloadTime;
    playSound('reload');
    return true;
  }

  function pullTrigger() {
    const def = WEAPONS[state.weaponId];
    if (!def || !ready()) return false;
    if (state.mag <= 0) {
      playSound('dryfire');
      state.cooldown = 0.25;
      return false;
    }
    takeRound();
    state.cooldown = def.fireGap;
    state.flash = 1;
    state.kick += def.kick;
    bloom = Math.min(BLOOM_MAX, bloom + BLOOM_PER_SHOT);
    flashMesh.rotation.z = Math.random() * Math.PI;
    playSound('shoot');
    return true;
  }

  function spread(speed) {
    const def = WEAPONS[state.weaponId];
    if (!def) return 0.01;
    const move = Math.min(1, speed / 5.2) * def.spreadMove;
    return def.spreadStill + move + bloom;
  }

  function throwGrenade() {
    if (state.grenades <= 0) return false;
    state.grenades -= 1;
    playSound('throw');
    return true;
  }

  function addGrenades(n) {
    state.grenades = Math.max(0, state.grenades + n);
    return state.grenades;
  }

  function refillAll() {
    if (WEAPONS[state.weaponId]) saveAmmo();
    for (const id of Object.keys(WEAPONS)) {
      ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    }
    if (WEAPONS[state.weaponId]) {
      state.mag = ammo[state.weaponId].mag;
      state.reserve = ammo[state.weaponId].reserve;
    }
    state.reloadLeft = 0;
    state.cooldown = 0;
  }

  function step(dt, moveSpeed = 0) {
    if (dt <= 0) return state;
    if (dt > 0.05) dt = 0.05;
    time += dt;

    if (state.cooldown > 0) state.cooldown -= dt;
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt / 0.06);
    if (state.kick > 0) state.kick = Math.max(0, state.kick - KICK_DECAY * dt);
    if (bloom > 0) bloom = Math.max(0, bloom - BLOOM_DECAY * dt);

    // Reload completion: top the magazine up from reserve.
    if (state.reloadLeft > 0) {
      state.reloadLeft -= dt;
      if (state.reloadLeft <= 0) {
        state.reloadLeft = 0;
        const def = WEAPONS[state.weaponId];
        if (def) {
          const need = def.mag - state.mag;
          const take = Math.min(need, state.reserve);
          state.mag += take;
          state.reserve -= take;
        }
      }
    }

    // Muzzle flash follows the flash timer.
    flashMesh.visible = state.flash > 0;
    flashMat.opacity = state.flash;
    flashLight.intensity = state.flash * 2.5;

    // Viewmodel bob + sway; bob grows with speed, kick pushes the gun back
    // and up briefly. No allocation: scalars only.
    const moveFactor = Math.min(1, moveSpeed / 5.2);
    bobPhase += dt * (4 + moveSpeed * 1.6);
    const bobX = Math.sin(bobPhase * 2) * 0.006 * moveFactor;
    const bobY = Math.abs(Math.sin(bobPhase)) * 0.008 * moveFactor;
    const idleY = Math.sin(time * 1.4) * 0.0015;
    group.position.x = BASE_POS.x + bobX;
    group.position.y = BASE_POS.y + bobY + idleY;
    group.position.z = BASE_POS.z + state.kick * 1.2;
    group.rotation.x = state.kick * 2.2;
    group.rotation.z = bobX * 0.6;
    return state;
  }

  rebuild();

  return {
    state,
    WEAPONS,
    GRENADE,
    equip,
    ready,
    takeRound,
    reload,
    pullTrigger,
    step,
    spread,
    throwGrenade,
    addGrenades,
    refillAll,
    get group() { return group; },
    get muzzle() { return muzzle; },
    get bloom() { return bloom; },
  };
}
