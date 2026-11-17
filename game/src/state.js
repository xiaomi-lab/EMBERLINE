// state.js — central game state for EMBERLINE: Saltworks Yard.
// Pure data + helpers. No DOM, no rendering, no network.
// The player fights for team 'ember' (attackers); bots defend as 'tide'.

export const PHASE_TIMES = {
  buy: 12,
  live: 100,
  roundEnd: 5,
};

// Seconds / credits used by the round economy. All values are in credits.
export const ECONOMY = {
  win: 3250,
  loss: 1900,
  kill: 300,
  plant: 300,
  defuse: 300,
  roundWinBonus: 0,
};

export const BOMB_PLANT_TIME = 3.2;
export const BOMB_DEFUSE_TIME = 5.0;
export const BOMB_EXPLODE_TIME = 40;
export const BOT_DEFUSE_TIME = 3.5;

export function createGameState() {
  const G = {
    phase: 'menu', // 'menu' | 'buy' | 'live' | 'roundEnd' | 'matchEnd'
    round: 1, // 1..13
    maxRounds: 13,
    firstTo: 7,
    score: { ember: 0, tide: 0 },
    roundWins: { ember: 0, tide: 0 },
    money: 800,
    timer: 0, // seconds left in the current phase
    bomb: {
      state: 'none', // 'none' | 'carried' | 'planted' | 'defused' | 'exploded'
      site: null, // site id ('A' | 'B') once planted, else null
      plantTimer: 0, // continuous plant progress (0..BOMB_PLANT_TIME)
      defuseTimer: 0, // continuous defuse progress (0..BOMB_DEFUSE_TIME)
      explodeTimer: 0, // counts down from BOMB_EXPLODE_TIME once planted
      carrier: 'player', // 'player' | 'bot' | null
    },
    kills: { player: 0, deaths: 0 },
    lastRoundReason: null, // e.g. 'elimination' | 'detonation' | 'defuse' | 'time'
    matchWinner: null, // 'ember' | 'tide' | 'draw' | null
  };
  return G;
}

// Reset everything for a fresh match. Keeps the same object reference so
// modules holding G keep working.
export function resetMatch(G) {
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
  resetRound(G);
  return G;
}

// Reset per-round state only: bomb, timer and phase. Score, money, kills
// and the round number survive — callers advance G.round themselves.
export function resetRound(G) {
  G.phase = 'buy';
  G.timer = PHASE_TIMES.buy;
  G.bomb.state = 'carried';
  G.bomb.site = null;
  G.bomb.plantTimer = 0;
  G.bomb.defuseTimer = 0;
  G.bomb.explodeTimer = 0;
  G.bomb.carrier = 'player';
  return G;
}

// True once either side has reached firstTo, or all rounds are played.
export function isMatchOver(G) {
  if (G.score.ember >= G.firstTo || G.score.tide >= G.firstTo) return true;
  return G.round >= G.maxRounds;
}

// Winner by score, or 'draw' on a tie. Null while the match is live.
export function matchWinnerFor(G) {
  if (G.score.ember > G.score.tide) return 'ember';
  if (G.score.tide > G.score.ember) return 'tide';
  return 'draw';
}

// Convenience predicates, kept here so main.js and rounds.js agree.
export function isBombPlanted(G) {
  return G.bomb.state === 'planted';
}

export function isLive(G) {
  return G.phase === 'live';
}

// Clear only the bomb, leaving phase, timer, score and money untouched.
// Used when a round ends while the bomb is still carried or planted.
export function resetBomb(G) {
  G.bomb.state = 'none';
  G.bomb.site = null;
  G.bomb.plantTimer = 0;
  G.bomb.defuseTimer = 0;
  G.bomb.explodeTimer = 0;
  G.bomb.carrier = null;
  return G;
}

// Credits the player may still spend this round. main.js owns the shop;
// this is a read helper, not a purchase.
export function canAfford(G, cost) {
  return G.money >= cost;
}
