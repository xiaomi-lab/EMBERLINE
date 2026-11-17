// hud.js — DOM heads-up display for Emberline: Saltworks Yard.
// Owns health, ammo, timer, score, money, bomb status, killfeed,
// grenades, hint, crosshair, overlay and the buy menu. No three.js,
// no network. main.js calls these methods when state changes.
// Every setter caches its last value and only touches the DOM
// when something actually changed.
export function createHud() {
  const $ = (id) => document.getElementById(id);

  // Grab every element by id; all of these exist in index.html.
  const el = {
    game: $("game"), hud: $("hud"), crosshair: $("crosshair"),
    hitmarker: $("hitmarker"), health: $("health"),
    healthNum: $("health-num"), healthFill: null,
    ammo: $("ammo"), ammoMag: $("ammo-mag"),
    ammoReserve: $("ammo-reserve"), weaponName: $("weapon-name"),
    timer: $("timer"), timerValue: $("timer-value"),
    score: $("score"), scoreEmber: $("score-ember"),
    scoreTide: $("score-tide"), roundLabel: $("round-label"),
    money: $("money"), moneyValue: $("money-value"),
    bombStatus: $("bomb-status"), killfeed: $("killfeed"),
    grenades: $("grenades"), grenadeCount: $("grenade-count"),
    hint: $("hint"), vignette: $("vignette"),
    overlay: $("overlay"), overlayTitle: $("overlay-title"),
    overlayCopy: $("overlay-copy"), playButton: $("play"),
    buyMenu: $("buy-menu"), buyList: $("buy-list"),
    buyMoney: $("buy-money"), buyClose: $("buy-close"),
    buyTimer: $("buy-timer"),
  };
  if (el.health) el.healthFill = el.health.querySelector(".health-fill");

  // Last values written. A setter returns early when the new
  // value matches the cached one, so idle frames cost nothing.
  const last = {};
  const changed = (key, value) => {
    if (last[key] === value) return false;
    last[key] = value;
    return true;
  };
  const setText = (node, key, value) => {
    if (!node || !changed(key, value)) return;
    node.textContent = value;
  };
  const moneyText = (n) => "$" + Number(n || 0).toLocaleString("en-US");

  // Buy-menu state, owned by this module.
  let buyOpen = false;
  let currentWeapons = [];
  let playHandler = null;
  let buyHandler = null;
  let hitTimer = 0;
  let flashTimer = 0;

  function setHealth(hp) {
    const value = Math.max(0, Math.min(100, Math.round(hp)));
    setText(el.healthNum, "health", String(value));
    if (el.healthFill && changed("healthFill", value)) {
      el.healthFill.style.width = value + "%";
    }
    if (el.health) el.health.classList.toggle("low", value <= 30);
  }

  function setAmmo(mag, reserve, weaponName) {
    setText(el.ammoMag, "mag", String(mag));
    setText(el.ammoReserve, "reserve", String(reserve));
    setText(el.weaponName, "weapon", String(weaponName || ""));
    if (el.ammo) el.ammo.classList.toggle("low", Number(mag) === 0);
  }

  function setGrenades(n) {
    const value = Math.max(0, Math.round(n));
    setText(el.grenadeCount, "grenades", String(value));
    if (el.grenades) el.grenades.classList.toggle("empty", value === 0);
  }

  // seconds -> "m:ss"; the timer turns red under 10 seconds.
  function setTimer(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const text = Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
    setText(el.timerValue, "timer", text);
    if (el.timer) el.timer.classList.toggle("low", total < 10);
  }

  function setScore(ember, tide, round) {
    setText(el.scoreEmber, "scoreEmber", String(ember));
    setText(el.scoreTide, "scoreTide", String(tide));
    setText(el.roundLabel, "round", "Round " + round + " · Ember vs Tide");
  }

  function setMoney(n) {
    setText(el.moneyValue, "money", moneyText(n));
  }

  // kind: 'none' | 'carried' | 'planted' | 'defused'.
  // 'none' hides the pill via CSS ([data-kind="none"]).
  function setBomb(text, kind) {
    const safeKind = ["none", "carried", "planted", "defused"].includes(kind) ? kind : "none";
    if (!el.bombStatus) return;
    if (changed("bombKind", safeKind)) el.bombStatus.dataset.kind = safeKind;
    setText(el.bombStatus, "bombText", String(text || ""));
  }

  // Newest line first, at most 5 lines, each fades after 5 seconds.
  function killfeed(text) {
    if (!el.killfeed || !text) return;
    const line = document.createElement("div");
    line.className = "feed-line";
    line.textContent = text;
    el.killfeed.prepend(line);
    while (el.killfeed.children.length > 5) {
      el.killfeed.removeChild(el.killfeed.lastChild);
    }
    window.setTimeout(() => line.classList.add("fade"), 5000);
    window.setTimeout(() => line.remove(), 5700);
  }

  // Four-tick marker; red when the hit was a kill.
  function hitMarker(killed, holdMs) {
    if (!el.hitmarker) return;
    const hold = typeof holdMs === "number" && holdMs > 0 ? holdMs : 150;
    el.hitmarker.classList.add("on");
    el.hitmarker.classList.toggle("killed", Boolean(killed));
    window.clearTimeout(hitTimer);
    hitTimer = window.setTimeout(() => {
      el.hitmarker.classList.remove("on", "killed");
    }, hold);
  }

  // Brief red vignette at the screen edges.
  function damageFlash() {
    if (!el.vignette) return;
    el.vignette.classList.add("flash");
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      el.vignette.classList.remove("flash");
    }, 180);
  }

  // Overlay presets: start / pause / round end / match end.
  // data overrides title, copy and action text.
  const OVERLAY_DEFAULTS = {
    start: {
      title: "EMBERLINE",
      copy: "Saltworks Yard — plant the charge at the marked site, or stop Tide from doing it. First crew to 7 rounds takes the yard.",
      action: "Deploy",
    },
    paused: { title: "PAUSED", copy: "Take a breath. The yard will wait.", action: "Resume" },
    roundEnd: { title: "ROUND OVER", copy: "", action: "Next Round" },
    matchEnd: { title: "MATCH OVER", copy: "", action: "Play Again" },
  };

  function showOverlay(mode, data) {
    const preset = OVERLAY_DEFAULTS[mode] || OVERLAY_DEFAULTS.start;
    const info = data || {};
    setText(el.overlayTitle, "overlayTitle", info.title || preset.title);
    setText(el.overlayCopy, "overlayCopy", info.copy || preset.copy);
    setText(el.playButton, "overlayAction", info.action || preset.action);
    if (el.overlay) el.overlay.classList.remove("hidden");
    if (el.game) el.game.classList.add("menu-open");
  }

  function hideOverlay() {
    if (el.overlay) el.overlay.classList.add("hidden");
    if (el.game) el.game.classList.remove("menu-open");
  }

  function onPlay(handler) {
    playHandler = handler;
  }
  if (el.playButton) {
    el.playButton.addEventListener("click", () => {
      if (playHandler) playHandler();
    });
  }

  // Buy menu: weapons [{ id, name, price, desc, owned? }] in
  // key order 1-5. Unaffordable rows are dimmed, owned rows marked.
  function showBuy(weapons, money, timeLeft) {
    currentWeapons = Array.isArray(weapons) ? weapons.slice() : [];
    if (el.buyList) {
      el.buyList.textContent = "";
      currentWeapons.forEach((w, index) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "buy-row";
        row.dataset.weapon = w.id;
        if (Number(w.price) > Number(money)) row.classList.add("cant-afford");
        if (w.owned) row.classList.add("owned");
        const key = document.createElement("span");
        key.className = "buy-key";
        key.textContent = String(index + 1);
        const name = document.createElement("span");
        name.className = "buy-name";
        name.textContent = w.name;
        const desc = document.createElement("span");
        desc.className = "buy-desc";
        desc.textContent = w.desc || "";
        const price = document.createElement("span");
        price.className = "buy-price";
        price.textContent = moneyText(w.price);
        row.append(key, name, desc, price);
        if (w.owned) {
          const owned = document.createElement("span");
          owned.className = "buy-owned";
          owned.textContent = "OWNED";
          row.append(owned);
        }
        el.buyList.append(row);
      });
    }
    if (el.buyMoney) {
      const value = el.buyMoney.querySelector(".value");
      if (value) setText(value, "buyMoney", moneyText(money));
      else setText(el.buyMoney, "buyMoney", "Credits: " + moneyText(money));
    }
    setBuyTimer(timeLeft);
    if (el.buyMenu) el.buyMenu.classList.remove("hidden");
    if (el.game) el.game.classList.add("menu-open");
    buyOpen = true;
  }

  function hideBuy() {
    if (el.buyMenu) el.buyMenu.classList.add("hidden");
    if (el.game) el.game.classList.remove("menu-open");
    buyOpen = false;
  }

  function isBuyOpen() {
    return buyOpen;
  }

  function onBuy(handler) {
    buyHandler = handler;
  }

  function setBuyTimer(s) {
    const total = Math.max(0, Math.floor(s));
    setText(el.buyTimer, "buyTimer", total + "s");
    if (el.buyTimer) el.buyTimer.classList.toggle("low", total <= 5);
  }

  // Row clicks: resolve the weapon id from data-weapon.
  if (el.buyList) {
    el.buyList.addEventListener("click", (event) => {
      const row = event.target.closest("[data-weapon]");
      if (row && buyHandler) buyHandler(row.dataset.weapon);
    });
  }
  if (el.buyClose) el.buyClose.addEventListener("click", hideBuy);

  // Buy-menu keyboard: 1-5 buy the matching row, B closes.
  // Only active while the menu is open; opening with B lives in
  // main.js, which owns the buy-phase timing. Digit keys are the
  // row order shown, so they match the keys printed on the rows.
  document.addEventListener("keydown", (event) => {
    if (!buyOpen) return;
    if (event.code === "KeyB") {
      event.preventDefault();
      hideBuy();
      return;
    }
    const keys = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"];
    const index = keys.indexOf(event.code);
    if (index >= 0 && currentWeapons[index]) {
      event.preventDefault();
      if (buyHandler) buyHandler(currentWeapons[index].id);
    }
  });

  function setHint(text) {
    setText(el.hint, "hint", String(text || ""));
  }

  // Crosshair spread in pixels; CSS reads it as --gap.
  function setCrosshairGap(px) {
    const value = Math.max(2, Math.round(px));
    if (!el.crosshair || !changed("gap", value)) return;
    el.crosshair.style.setProperty("--gap", value + "px");
  }

  return {
    setHealth, setAmmo, setGrenades, setTimer, setScore,
    setMoney, setBomb, killfeed, hitMarker, damageFlash,
    showOverlay, hideOverlay, onPlay, showBuy, hideBuy,
    onBuy, setBuyTimer, setHint, setCrosshairGap, isBuyOpen,
  };
}
