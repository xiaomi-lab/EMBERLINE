// player.js — first-person movement, gravity, jumping, crouching and
// axis-separated AABB collision for EMBERLINE: Saltworks Yard.
// Feet live at position.y; the ground plane is y = 0. A single probe Box3 is
// reused for every collision test, so step() allocates nothing per frame.
import * as THREE from 'three';

const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const RADIUS = 0.34;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;
const HEIGHT_LERP = 12;
const MAX_PITCH = 1.55;

export function createPlayer(colliders) {
  const boxes = Array.isArray(colliders) ? colliders : [];
  const probe = new THREE.Box3();
  const tmpMin = new THREE.Vector3();
  const tmpMax = new THREE.Vector3();

  const state = {
    position: new THREE.Vector3(0, 0, 8),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
  };

  function syncProbe() {
    tmpMin.set(state.position.x - RADIUS, state.position.y, state.position.z - RADIUS);
    tmpMax.set(state.position.x + RADIUS, state.position.y + state.height, state.position.z + RADIUS);
    probe.min.copy(tmpMin);
    probe.max.copy(tmpMax);
  }

  // True when the standing-height box at the current feet position is clear.
  function canStand() {
    tmpMin.set(state.position.x - RADIUS, state.position.y, state.position.z - RADIUS);
    tmpMax.set(state.position.x + RADIUS, state.position.y + STAND_HEIGHT, state.position.z + RADIUS);
    probe.min.copy(tmpMin);
    probe.max.copy(tmpMax);
    for (let i = 0; i < boxes.length; i++) {
      if (probe.intersectsBox(boxes[i])) return false;
    }
    return true;
  }

  // Resolve overlap on one axis after moving along it. `axis` is 'x' | 'z' | 'y'
  // and `delta` is the signed distance just travelled on that axis.
  function resolveAxis(axis, delta) {
    if (delta === 0) return;
    syncProbe();
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (!probe.intersectsBox(box)) continue;
      if (axis === 'x') {
        state.position.x = delta > 0 ? box.min.x - RADIUS - 0.001 : box.max.x + RADIUS + 0.001;
        state.velocity.x = 0;
      } else if (axis === 'z') {
        state.position.z = delta > 0 ? box.min.z - RADIUS - 0.001 : box.max.z + RADIUS + 0.001;
        state.velocity.z = 0;
      } else if (delta < 0) {
        // Falling onto the top face of a platform (or the ground plane's
        // collider): land on it.
        state.position.y = box.max.y + 0.001;
        state.velocity.y = 0;
        state.onGround = true;
      } else {
        // Rising into an underside: stop the jump.
        state.position.y = box.min.y - state.height - 0.001;
        state.velocity.y = 0;
      }
      syncProbe();
    }
  }

  function step(dt, keys) {
    if (dt <= 0) return state;
    if (dt > 0.05) dt = 0.05;

    // --- Crouch: hold ControlLeft or KeyC. Standing up is blocked when
    // something (e.g. a low ceiling) occupies the standing-height box.
    const wantCrouch = keys.has('ControlLeft') || keys.has('KeyC');
    if (wantCrouch) state.crouching = true;
    else if (state.crouching && canStand()) state.crouching = false;
    const targetHeight = state.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
    state.height += (targetHeight - state.height) * Math.min(1, HEIGHT_LERP * dt);
    if (Math.abs(state.height - targetHeight) < 0.002) state.height = targetHeight;
    const heightT = (state.height - CROUCH_HEIGHT) / (STAND_HEIGHT - CROUCH_HEIGHT);
    state.eye = state.position.y + CROUCH_EYE + heightT * (STAND_EYE - CROUCH_EYE);

    // --- Wish direction from WASD, relative to yaw.
    let forward = 0;
    let strafe = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;

    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    let wishX = -sin * forward + cos * strafe;
    let wishZ = -cos * forward - sin * strafe;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 0) { wishX /= wishLen; wishZ /= wishLen; }

    const maxSpeed = state.crouching ? CROUCH_SPEED : WALK_SPEED;
    const accel = state.onGround ? GROUND_ACCEL : AIR_ACCEL;

    // Friction only on the ground and only when the player is not steering:
    // it bleeds horizontal speed so the player stops instead of sliding.
    if (state.onGround && wishLen === 0) {
      const speed = Math.hypot(state.velocity.x, state.velocity.z);
      if (speed > 0) {
        const drop = Math.min(speed, FRICTION * speed * dt);
        state.velocity.x -= (state.velocity.x / speed) * drop;
        state.velocity.z -= (state.velocity.z / speed) * drop;
      }
    }

    // Accelerate toward the wish direction, capped at maxSpeed along it.
    const currentAlong = state.velocity.x * wishX + state.velocity.z * wishZ;
    const addSpeed = maxSpeed - currentAlong;
    if (addSpeed > 0 && wishLen > 0) {
      const accelSpeed = Math.min(accel * maxSpeed * dt, addSpeed);
      state.velocity.x += wishX * accelSpeed;
      state.velocity.z += wishZ * accelSpeed;
    }

    // Jump (from the ground only).
    if (keys.has('Space') && state.onGround && !state.crouching) {
      state.velocity.y = JUMP_SPEED;
      state.onGround = false;
    }

    // Gravity.
    state.velocity.y -= GRAVITY * dt;
    if (state.velocity.y < -30) state.velocity.y = -30;

    // --- Integrate one axis at a time so each collision resolves cleanly.
    state.onGround = false;
    let dx = state.velocity.x * dt;
    state.position.x += dx;
    resolveAxis('x', dx);
    let dz = state.velocity.z * dt;
    state.position.z += dz;
    resolveAxis('z', dz);
    let dy = state.velocity.y * dt;
    state.position.y += dy;
    resolveAxis('y', dy);

    // Ground plane.
    if (state.position.y <= 0) {
      state.position.y = 0;
      if (state.velocity.y < 0) state.velocity.y = 0;
      state.onGround = true;
    }

    // Recompute eye after the final position is known.
    const t = (state.height - CROUCH_HEIGHT) / (STAND_HEIGHT - CROUCH_HEIGHT);
    state.eye = state.position.y + CROUCH_EYE + t * (STAND_EYE - CROUCH_EYE);
    return state;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    state.yaw -= dx * sensitivity;
    state.pitch -= dy * sensitivity;
    if (state.pitch > MAX_PITCH) state.pitch = MAX_PITCH;
    if (state.pitch < -MAX_PITCH) state.pitch = -MAX_PITCH;
    return state;
  }

  function recoil(pitchKick, yawKick) {
    state.pitch += pitchKick;
    state.yaw += yawKick;
    if (state.pitch > MAX_PITCH) state.pitch = MAX_PITCH;
    if (state.pitch < -MAX_PITCH) state.pitch = -MAX_PITCH;
    return state;
  }

  function groundSpeed() {
    return Math.hypot(state.velocity.x, state.velocity.z);
  }

  return { state, step, look, recoil, groundSpeed };
}
