// effects.js — pooled tracers, impact particles and explosion flashes for
// EMBERLINE: Saltworks Yard. All meshes, geometries and materials are created
// once up front; step() only moves and fades pooled objects, allocating nothing.
import * as THREE from 'three';

const TRACER_COUNT = 8;
const TRACER_LIFE = 0.08;
const PARTICLE_COUNT = 24;

export function createEffects(scene) {
  // Tracer pool: one Line per slot, two points each, additive fading.
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i++) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerSlot = 0;

  // Particle pool: shared geometry, four shared materials, per-particle
  // velocity and life kept in preallocated arrays.
  const particleGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
  const particleMats = [0xcfc8b8, 0xff8c2e, 0xffd27a, 0x8a7f6a].map(
    (c) => new THREE.MeshBasicMaterial({ color: c }),
  );
  const particles = [];
  const vel = new Float32Array(PARTICLE_COUNT * 3);
  const life = new Float32Array(PARTICLE_COUNT);
  const maxLife = new Float32Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const mesh = new THREE.Mesh(particleGeo, particleMats[0]);
    mesh.visible = false;
    scene.add(mesh);
    particles.push(mesh);
  }
  let particleSlot = 0;

  // Reused explosion flash light.
  const flashLight = new THREE.PointLight(0xff8c2e, 0, 14, 2);
  scene.add(flashLight);
  let flashLife = 0;

  function nextParticle() {
    const i = particleSlot;
    particleSlot = (particleSlot + 1) % PARTICLE_COUNT;
    return i;
  }

  function launchParticle(i, x, y, z, vx, vy, vz, ttl, matIndex) {
    const mesh = particles[i];
    mesh.position.set(x, y, z);
    mesh.material = particleMats[matIndex % particleMats.length];
    mesh.visible = true;
    mesh.scale.setScalar(1);
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    life[i] = ttl; maxLife[i] = ttl;
  }

  function spawnTracer(from, to, color = 0xffd27a) {
    const slot = tracers[tracerSlot];
    tracerSlot = (tracerSlot + 1) % TRACER_COUNT;
    const pos = slot.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    slot.line.material.color.setHex(color);
    slot.line.material.opacity = 1;
    slot.line.visible = true;
    slot.life = TRACER_LIFE;
  }

  function spawnImpact(point, normal, color = 0xcfc8b8) {
    const matIndex = color === 0xcfc8b8 ? 0 : 3;
    for (let n = 0; n < 4; n++) {
      const i = nextParticle();
      launchParticle(i, point.x, point.y, point.z,
        normal.x * 2 + (Math.random() - 0.5) * 1.6,
        normal.y * 2 + Math.random() * 1.5,
        normal.z * 2 + (Math.random() - 0.5) * 1.6,
        0.3 + Math.random() * 0.3, matIndex);
    }
  }

  function spawnExplosion(point) {
    flashLight.position.copy(point);
    flashLight.intensity = 24;
    flashLife = 0.25;
    for (let n = 0; n < 12; n++) {
      const i = nextParticle();
      const a = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      launchParticle(i, point.x, point.y, point.z,
        Math.cos(a) * speed, Math.random() * 3 + 1, Math.sin(a) * speed,
        0.4 + Math.random() * 0.4, 1 + (n % 2));
    }
  }

  function step(dt) {
    if (dt <= 0) return;
    if (dt > 0.05) dt = 0.05;
    for (let i = 0; i < TRACER_COUNT; i++) {
      const slot = tracers[i];
      if (slot.life <= 0) continue;
      slot.life -= dt;
      slot.line.material.opacity = Math.max(0, slot.life / TRACER_LIFE);
      if (slot.life <= 0) slot.line.visible = false;
    }
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const mesh = particles[i];
      if (life[i] <= 0) { mesh.visible = false; continue; }
      vel[i * 3 + 1] -= 6 * dt;
      mesh.position.x += vel[i * 3] * dt;
      mesh.position.y += vel[i * 3 + 1] * dt;
      mesh.position.z += vel[i * 3 + 2] * dt;
      if (mesh.position.y < 0.03) { mesh.position.y = 0.03; vel[i * 3 + 1] = 0; }
      mesh.scale.setScalar(Math.max(0.1, life[i] / maxLife[i]));
    }
    if (flashLife > 0) {
      flashLife -= dt;
      flashLight.intensity = flashLife > 0 ? (flashLife / 0.25) * 24 : 0;
    }
  }

  return { spawnTracer, spawnImpact, spawnExplosion, step };
}
