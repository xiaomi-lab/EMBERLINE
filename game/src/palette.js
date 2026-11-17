// palette.js — EMBERLINE: Saltworks Yard
// Single source of truth for every UI and in-world accent colour.
// All values are flat hex strings so the HUD, menus and the 3D
// scene can share one palette without importing each other.
//
// Colour roles:
//   canvas  — page / HUD backdrop, darkest tone.
//   surface — panels, cards and raised HUD chrome.
//   hairline — 1px borders and dividers on surfaces.
//   ink     — primary text on dark surfaces.
//   muted   — secondary text, timers and hints.
//   accent  — the warm amber used for highlights and Site A.
//   danger  — damage flashes, low-health and errors.
//   teamA   — attacking side (amber, matches accent).
//   teamB   — defending side (cool blue, contrasts amber).
//
// Usage: import { PALETTE, shade } from './palette.js';
// shade('accent') returns PALETTE.accent, or undefined for
// an unknown key — callers should fall back to a default.
// Keep this file free of DOM / WebGL imports so it can be
// reused by tests, the HUD and the renderer alike.

export const PALETTE = {
  canvas: '#101318',
  surface: '#1b2027',
  hairline: '#2e353f',
  ink: '#ece7db',
  muted: '#9aa3ad',
  accent: '#f0a830',
  danger: '#e0524d',
  teamA: '#f0a830',
  teamB: '#4d9de0',
};

export function shade(name) {
  return PALETTE[name];
}
