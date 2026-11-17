// rounds.js — buy / live / round-end / match-end flow for EMBERLINE.
// Pure logic: no DOM, no rendering, no network. main.js owns the frame
// loop and calls update(dt, ctx) every frame with:
//   ctx = { playerAlive, enemiesAlive, bombCarrierAlive, playerAtSite,
//           playerDefusing, botDefusing, time }
// playerAtSite is a site id ('A' | 'B') or null. Phase changes and money
// awards go through hooks: { onPhase, onRoundEnd, onMatchEnd, onMoney,
// onBombPlanted, onBombDefused, onBombExploded }.

import {
  PHASE_TIMES,
  ECONOMY,
  BOMB_PLANT_TIME,
  BOMB_DEFUSE_TIME,
  BOMB_EXPLODE_TIME,
  BOT_DEFUSE_TIME,
  resetRound,
  matchWinnerFor,
} from './state.js';

const NO_HOOKS = {};
function hook(hooks, name, ...args) {
  const fn = hooks && hooks[name];
  if (typeof fn === 'function') fn(...args);
}

export function startBuyPhase(G, hooks = NO_HOOKS) {
  G.phase = 'buy';
  G.timer = PHASE_TIMES.buy;
  hook(hooks, 'onPhase', 'buy');
  return G;
}

export function startLivePhase(G, hooks = NO_HOOKS) {
  G.phase = 'live';
  G.timer = PHASE_TIMES.live;
  hook(hooks, 'onPhase', 'live');
  return G;
}

// Plant the bomb at a site. Returns false unless the bomb is carried.
// The planter earns ECONOMY.plant when the carrier is the player.
export function plantBomb(G, site, carrier, hooks = NO_HOOKS) {
  if (G.bomb.state !== 'carried') return false;
  G.bomb.state = 'planted';
  G.bomb.site = site;
  G.bomb.plantTimer = 0;
  G.bomb.defuseTimer = 0;
  G.bomb.explodeTimer = BOMB_EXPLODE_TIME;
  G.bomb.carrier = carrier || G.bomb.carrier;
  if (G.bomb.carrier === 'player') awardPlant(G, hooks);
  hook(hooks, 'onBombPlanted', site);
  return true;
}

// Advance the player's plant progress. Returns true the moment the bomb
// is planted. `active` must be false whenever the player leaves the site.
export function plantTick(G, dt, active, site, hooks = NO_HOOKS) {
  if (G.bomb.state !== 'carried' || !active || !site) {
    G.bomb.plantTimer = 0;
    return false;
  }
  G.bomb.plantTimer += dt;
  if (G.bomb.plantTimer < BOMB_PLANT_TIME) return false;
  return plantBomb(G, site, 'player', hooks);
}

// Advance the player's defuse progress. Returns true the moment the bomb
// is defused (and marks it defused). Interrupted defusing resets progress.
export function defuseTick(G, dt, active = true) {
  if (G.bomb.state !== 'planted') return false;
  if (!active) {
    G.bomb.defuseTimer = 0;
    return false;
  }
  G.bomb.defuseTimer += dt;
  if (G.bomb.defuseTimer < BOMB_DEFUSE_TIME) return false;
  G.bomb.state = 'defused';
  G.bomb.defuseTimer = 0;
  return true;
}

// Same, for the nearest bot standing on the bomb (bots.js tracks its own
// 3.5 s progress; main.js passes bot.defusing through ctx.botDefusing).
export function botDefuseTick(G, dt, active = true) {
  if (G.bomb.state !== 'planted') return false;
  if (!active) return false;
  G.bomb.defuseTimer += dt;
  if (G.bomb.defuseTimer < BOT_DEFUSE_TIME) return false;
  G.bomb.state = 'defused';
  G.bomb.defuseTimer = 0;
  return true;
}

export function awardKill(G, hooks = NO_HOOKS) {
  G.kills.player += 1; G.money += ECONOMY.kill;
  hook(hooks, 'onMoney', ECONOMY.kill, 'kill');
  return G.money;
}

export function awardPlant(G, hooks = NO_HOOKS) {
  G.money += ECONOMY.plant;
  hook(hooks, 'onMoney', ECONOMY.plant, 'plant');
  return G.money;
}

export function awardDefuse(G, hooks = NO_HOOKS) {
  G.money += ECONOMY.defuse;
  hook(hooks, 'onMoney', ECONOMY.defuse, 'defuse');
  return G.money;
}

// End the current round. Scores, money and the match-end check live here.
// Guarded: a second call while the round is already over is a no-op.
export function endRound(G, winner, reason, hooks = NO_HOOKS) {
  if (G.phase === 'roundEnd' || G.phase === 'matchEnd') return null;
  if (winner !== 'ember' && winner !== 'tide') return null;
  G.lastRoundReason = reason;
  G.score[winner] += 1; G.roundWins[winner] += 1;
  const amount = winner === 'ember' ? ECONOMY.win : ECONOMY.loss;
  G.money += amount + ECONOMY.roundWinBonus;
  hook(hooks, 'onMoney', amount, winner === 'ember' ? 'round-win' : 'round-loss');
  G.phase = 'roundEnd'; G.timer = PHASE_TIMES.roundEnd;
  hook(hooks, 'onRoundEnd', winner, reason);
  if (G.score.ember >= G.firstTo || G.score.tide >= G.firstTo || G.round >= G.maxRounds) {
    G.matchWinner = matchWinnerFor(G);
  }
  return winner;
}

// Advance to the next round. Returns false when the match is already over
// (main.js should show the match-end screen instead).
export function nextRound(G, hooks = NO_HOOKS) {
  if (G.matchWinner) return false;
  G.round += 1;
  resetRound(G);
  hook(hooks, 'onPhase', 'buy');
  return true;
}

export function update(G, dt, ctx, hooks = NO_HOOKS) {
  if (!G || dt <= 0) return;
  const c = ctx || {};
  if (G.phase === 'roundEnd') {
    G.timer -= dt;
    if (G.timer <= 0) {
      G.timer = 0;
      if (G.matchWinner) { G.phase = 'matchEnd'; hook(hooks, 'onPhase', 'matchEnd'); hook(hooks, 'onMatchEnd', G.matchWinner); }
      else nextRound(G, hooks);
    }
    return;
  }
  if (G.phase === 'buy') {
    G.timer -= dt;
    if (G.timer <= 0) startLivePhase(G, hooks);
    return;
  }
  if (G.phase !== 'live') return;

  // Bomb planted: the fuse decides the round; the live clock is paused.
  if (G.bomb.state === 'planted') {
    G.bomb.explodeTimer -= dt;
    if (G.bomb.explodeTimer <= 0) {
      G.bomb.state = 'exploded';
      G.bomb.explodeTimer = 0;
      hook(hooks, 'onBombExploded');
      endRound(G, 'ember', 'detonation', hooks);
      return;
    }
    // A bot standing on the bomb defuses it in BOT_DEFUSE_TIME. The
    // player-defuse branch below is skipped while a bot is defusing, so
    // the shared defuseTimer is never reset under the bot's progress.
    if (c.botDefusing) {
      if (botDefuseTick(G, dt, true)) {
        hook(hooks, 'onBombDefused');
        endRound(G, 'tide', 'defuse', hooks);
      }
      return;
    }
    // The player defusing their own planted bomb also ends the round
    // for the defenders (see the live-phase defuse branch below).
    if (c.playerDefusing && c.playerAlive && c.playerAtSite === G.bomb.site) {
      if (defuseTick(G, dt, true)) {
        awardDefuse(G, hooks);
        hook(hooks, 'onBombDefused');
        endRound(G, 'tide', 'defuse', hooks);
        return;
      }
    } else {
      defuseTick(G, dt, false);
    }
    // All defenders dead with a planted bomb still ends on detonation,
    // so the round is not cut short here — the fuse above decides it.
    return;
  }

  // Live clock: expiry hands the round to the defenders.
  G.timer -= dt;
  if (G.timer <= 0) {
    G.timer = 0;
    endRound(G, 'tide', 'time', hooks);
    return;
  }
  // Elimination: no defenders left, or the (lone) attacker is dead.
  if (c.enemiesAlive === 0) { endRound(G, 'ember', 'elimination', hooks); return; }
  if (c.playerAlive === false) { endRound(G, 'tide', 'elimination', hooks); return; }
  // Planting: standing in a site with the bomb for 3.2 s plants it.
  if (G.bomb.state === 'carried' && G.bomb.carrier === 'player' && c.playerAlive) {
    plantTick(G, dt, !!c.playerAtSite, c.playerAtSite, hooks);
  } else {
    G.bomb.plantTimer = 0;
  }
}

export function createRounds(G, hooks = NO_HOOKS) {
  return {
    startBuyPhase: () => startBuyPhase(G, hooks), startLivePhase: () => startLivePhase(G, hooks),
    plantBomb: (site, carrier) => plantBomb(G, site, carrier, hooks),
    plantTick: (dt, active, site) => plantTick(G, dt, active, site, hooks),
    defuseTick: (dt, active) => defuseTick(G, dt, active),
    botDefuseTick: (dt, active) => botDefuseTick(G, dt, active),
    awardKill: () => awardKill(G, hooks), awardPlant: () => awardPlant(G, hooks),
    awardDefuse: () => awardDefuse(G, hooks),
    endRound: (winner, reason) => endRound(G, winner, reason, hooks),
    nextRound: () => nextRound(G, hooks), update: (dt, ctx) => update(G, dt, ctx, hooks),
  };
}
