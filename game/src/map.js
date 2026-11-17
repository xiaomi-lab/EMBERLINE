// map.js — EMBERLINE: Saltworks Yard
// Original outdoor industrial saltworks yard, roughly 56 x 44 m.
// Built only from BoxGeometry / CylinderGeometry meshes with
// MeshStandardMaterial — no textures and no external assets.
// Layout (coordinate convention: +Z south, -Z north):
//   attack spawn  z ~ +19 (south)      defend spawn z ~ -19 (north)
//   Site A "Crane Yard" north-west, Site B "Pump House" north-east
//   west lane x ~ -22, mid lane x ~ 0, east lane x ~ +22
// Every lane is at least 3 m wide and every route connects
// through a doorway or an open gap — there are no dead ends.
// The raised platform is 0.5 m high so it is a walkable step;
// its ramp is a sloped box, visual only, beside the step.

import * as THREE from 'three';

const WALL_H = 5;
const COL_GROUND = 0x8a7f6a;
const COL_WALL = 0x6b6257;
const COL_DARK = 0x4a443c;
const COL_CRATE = 0x9a7b46;
const COL_CRATE2 = 0x7d6a4a;
const COL_METAL = 0x5d6b74;
const COL_RUST = 0x8a5a3c;
const COL_SALT = 0xe8e4d8;
const COL_SILO = 0xb8bcc0;
const COL_ACCENT = 0xf0a830;

export function createMap(scene) {
  const colliders = [];
  const shootables = [];

  function mat(color, roughness = 0.85) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.08 });
  }

  // Register a mesh as solid: it blocks movement (Box3) and
  // it can be hit by shots. Ground included, per the spec.
  function register(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    mesh.updateMatrixWorld(true);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function addBox(w, h, d, x, y, z, color, roughness) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, roughness));
    mesh.position.set(x, y, z);
    return register(mesh);
  }

  function addCylinder(rTop, rBottom, h, x, y, z, color, segments = 14) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBottom, h, segments),
      mat(color, 0.7),
    );
    mesh.position.set(x, y, z);
    return register(mesh);
  }

  // ---- Ground slab (56 x 44 m playfield, plus a small margin) ----
  addBox(58, 0.5, 46, 0, -0.25, 0, COL_GROUND, 0.95);

  // ---- Perimeter walls, height 5, inner faces at x/z = +/-28 / +/-22 ----
  addBox(58, WALL_H, 1, 0, WALL_H / 2, -22.5, COL_WALL);
  addBox(58, WALL_H, 1, 0, WALL_H / 2, 22.5, COL_WALL);
  addBox(1, WALL_H, 46, -28.5, WALL_H / 2, 0, COL_WALL);
  addBox(1, WALL_H, 46, 28.5, WALL_H / 2, 0, COL_WALL);

  // ---- Site A "Crane Yard" (north-west): tall gantry of boxes ----
  // Two legs at z = -17 with a top beam; the open yard below is
  // the plant zone, centred at (-20, -15).
  addBox(0.8, 7, 0.8, -24, 3.5, -17, COL_METAL, 0.6);
  addBox(0.8, 7, 0.8, -16, 3.5, -17, COL_METAL, 0.6);
  addBox(9.6, 1, 1, -20, 7, -17, COL_RUST, 0.6);
  addBox(1.2, 1.2, 5, -20, 6.4, -14, COL_RUST, 0.6);
  addBox(1.6, 1, 1.4, -24, 6.2, -17, COL_DARK, 0.6);
  // Salt pile marking the site, kept clear of the plant centre.
  addBox(3, 0.6, 3, -24, 0.3, -12.5, COL_SALT, 0.95);

  // ---- Site B "Pump House" (north-east): roofed structure ----
  // Footprint x 16..24, z -19..-11. Doorways: a 2 m gap in the
  // south wall (x 19..21) and a 4 m gap in the west wall
  // (z -17..-13), so the site is reachable from every lane.
  addBox(8.6, 3, 0.6, 20, 1.5, -19, COL_WALL);
  addBox(0.6, 3, 8, 24, 1.5, -15, COL_WALL);
  addBox(3, 3, 0.6, 17.5, 1.5, -11, COL_WALL);
  addBox(3, 3, 0.6, 22.5, 1.5, -11, COL_WALL);
  addBox(0.6, 3, 2, 16, 1.5, -18, COL_WALL);
  addBox(0.6, 3, 2, 16, 1.5, -12, COL_WALL);
  addBox(9, 0.4, 8.6, 20, 3.2, -15, COL_DARK, 0.9);
  // Pump block inside the house, north side, clear of the centre.
  addBox(2, 1.4, 1.4, 21.5, 0.7, -18, COL_METAL, 0.55);
  addBox(0.5, 2.2, 0.5, 21.5, 1.1, -16.8, COL_RUST, 0.6);

  // ---- Mid lane: central silo, defence wall, lane stubs ----
  // Silo at the map centre; attackers go around it, never through.
  addCylinder(2, 2, 6, 0, 3, 0, COL_SILO, 18);
  addBox(1, 1, 1, 0, 6.4, 0, COL_ACCENT, 0.5);
  // Low defence wall shielding the sites; gaps at both ends.
  addBox(10, 3, 1, 0, 1.5, -10, COL_WALL);
  // Short stubs splitting the lanes; each leaves a wide gap so
  // no waypoint link ever crosses a wall.
  addBox(1, 3, 4, -14, 1.5, -9, COL_DARK);
  addBox(1, 3, 4, 14, 1.5, -9, COL_DARK);

  // ---- Pipes along the outer walls (low cover, not blockers) ----
  addBox(0.6, 0.6, 24, -27, 0.8, 0, COL_METAL, 0.6);
  addBox(0.6, 0.6, 24, 27, 0.8, 0, COL_METAL, 0.6);

  // ---- Crates as cover (kept off waypoint lines) ----
  addBox(1.5, 1.5, 1.5, -23, 0.75, -18, COL_CRATE);
  addBox(1.2, 1.2, 1.2, -23, 2.1, -18, COL_CRATE2);
  addBox(1.2, 1.2, 1.2, -17, 0.6, -18, COL_CRATE2);
  addBox(1.8, 1.8, 1.8, -24, 0.9, -8, COL_CRATE);
  addBox(1.2, 1.2, 1.2, -18, 0.6, 2, COL_CRATE2);
  addBox(1.2, 1.2, 1.2, -8, 0.6, 12, COL_CRATE);
  addBox(1.8, 1.8, 1.8, -8, 0.9, -12, COL_CRATE2);
  addBox(1.5, 1.5, 1.5, 8, 0.75, 10, COL_CRATE);
  addBox(1.5, 1.5, 1.5, 7, 0.75, -11, COL_CRATE2);
  addBox(1.8, 1.8, 1.8, 18, 0.9, 2, COL_CRATE);
  addBox(1.2, 1.2, 1.2, 24, 0.6, -6, COL_CRATE2);
  addBox(1.5, 1.5, 1.5, 24, 0.75, 16, COL_CRATE);
  addBox(1.2, 1.2, 1.2, -25, 0.6, 10, COL_CRATE2);
  // Stacked pair near mid-south for a crossfire angle.
  addBox(1.4, 1.4, 1.4, -3, 0.7, 8, COL_CRATE);
  addBox(1.1, 1.1, 1.1, -3, 1.95, 8, COL_CRATE2);

  // ---- Barrels (cylinders) as low cover ----
  addCylinder(0.55, 0.55, 1.1, -20, 0.55, 8, COL_RUST);
  addCylinder(0.55, 0.55, 1.1, 20, 0.55, 10, COL_METAL);
  addCylinder(0.55, 0.55, 1.1, -12, 0.55, -2, COL_RUST);
  addCylinder(0.55, 0.55, 1.1, 14, 0.55, -2, COL_METAL);
  addCylinder(0.55, 0.55, 1.1, 3, 0.55, -17, COL_RUST);

  // ---- Extra mid cover: low crates guarding the silo flanks ----
  // Kept at least 2 m from every waypoint so routes stay open.
  addBox(1.3, 1.3, 1.3, -7, 0.65, -1, COL_CRATE2);
  addBox(1.3, 1.3, 1.3, 7, 0.65, -1, COL_CRATE);
  addBox(1.1, 1.1, 1.1, -7, 0.55, 4, COL_CRATE);
  addBox(1.1, 1.1, 1.1, 7, 0.55, 4, COL_CRATE2);
  // One more barrel pair flanking the defence-wall gaps.
  addCylinder(0.55, 0.55, 1.1, -6, 0.55, -8, COL_METAL);
  addCylinder(0.55, 0.55, 1.1, 6, 0.55, -8, COL_RUST);

  // ---- Site marker posts (amber) at each site entrance ----
  // Short posts only: they mark the plant zone without blocking
  // movement or sightlines across the site.
  addBox(0.3, 1.2, 0.3, -22, 0.6, -11, COL_ACCENT, 0.5);
  addBox(0.3, 1.2, 0.3, -18, 0.6, -11, COL_ACCENT, 0.5);
  addBox(0.3, 1.2, 0.3, 20, 0.6, -9.5, COL_ACCENT, 0.5);
  addBox(0.3, 1.2, 0.3, 18, 0.6, -13.5, COL_ACCENT, 0.5);
  // A spare crate stack by the east lane for late-round cover.
  addBox(1.4, 1.4, 1.4, 25, 0.7, 8, COL_CRATE2);
  addBox(1.0, 1.0, 1.0, 25, 1.9, 8, COL_CRATE);

  // ---- Salt piles (flat mounds, off the lanes) ----
  addBox(3, 0.6, 3, -2, 0.3, -18, COL_SALT, 0.95);
  addBox(3, 0.5, 3, 26, 0.25, -2, COL_SALT, 0.95);

  // ---- Raised platform + ramp (south-west, attack side) ----
  // Platform top is 0.5 m: a walkable step, not a wall.
  addBox(5, 0.5, 4, -23, 0.25, 17, COL_DARK, 0.9);
  // Sloped ramp box, visual only, descending east off the step.
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 3.6), mat(COL_METAL, 0.7));
  ramp.position.set(-19.2, 0.28, 17);
  ramp.rotation.z = -0.17;
  register(ramp);
  // Light poles at the south corners.
  addBox(0.4, 4.5, 0.4, -26, 2.25, 20, COL_METAL, 0.6);
  addBox(0.4, 4.5, 0.4, 26, 2.25, 20, COL_METAL, 0.6);

  // ---- Lighting ----
  scene.add(new THREE.HemisphereLight(0xbfd4e6, 0x3a332a, 0.55));

  const sun = new THREE.DirectionalLight(0xffe6b0, 1.6);
  sun.position.set(18, 28, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -32;
  sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 28;
  sun.shadow.camera.bottom = -28;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x4d9de0, 0.25);
  fill.position.set(-15, 12, -18);
  scene.add(fill);

  // Subtle haze so the far wall reads as distance, not a void.
  scene.fog = new THREE.Fog(0x101318, 55, 110);

  const spawns = {
    attack: [[0, 19], [-8, 19], [8, 19], [-16, 18], [16, 18]],
    defend: [[0, -19], [-8, -19], [8, -19], [-14, -17], [14, -17]],
  };

  const sites = {
    A: { center: new THREE.Vector3(-20, 0, -15), radius: 4.5, label: 'Crane Yard' },
    B: { center: new THREE.Vector3(20, 0, -15), radius: 4.5, label: 'Pump House' },
  };

  // 24 nodes: attack spawn, west / mid / east lanes, both sites,
  // defend spawn. Links are symmetric, 2-4 per node, and no link
  // crosses a wall (gaps were placed on the crossed lines).
  const waypoints = [
    { x: 0, z: 19, links: [1, 2] },
    { x: -11, z: 17, links: [0, 3, 5] },
    { x: 11, z: 17, links: [0, 4, 5] },
    { x: -22, z: 13, links: [1, 6] },
    { x: 22, z: 13, links: [2, 7] },
    { x: 0, z: 13, links: [1, 2, 8, 9] },
    { x: -22, z: 5, links: [3, 8, 12] },
    { x: 22, z: 5, links: [4, 9, 13] },
    { x: -5, z: 6, links: [5, 6, 10, 14] },
    { x: 5, z: 6, links: [5, 7, 11, 15] },
    { x: -4, z: 0, links: [8, 14] },
    { x: 4, z: 0, links: [9, 15] },
    { x: -22, z: -4, links: [6, 14, 16] },
    { x: 22, z: -4, links: [7, 15, 17] },
    { x: -10, z: -6, links: [8, 10, 12, 18] },
    { x: 10, z: -6, links: [9, 11, 13, 20] },
    { x: -22, z: -12, links: [12, 18] },
    { x: 22, z: -9, links: [13, 20] },
    { x: -15, z: -15, links: [14, 16, 19] },
    { x: -20, z: -15, links: [18, 22, 23] },
    { x: 15, z: -15, links: [15, 17, 21] },
    { x: 20, z: -15, links: [20, 22] },
    { x: 0, z: -15, links: [19, 21, 23] },
    { x: 0, z: -19, links: [22, 19] },
  ];

  return { colliders, shootables, spawns, sites, waypoints };
}
