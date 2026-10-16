// Battleship v2 — app controller: menus, modes, placement, targeting, HUD, progression.
import {
    GRID, SHIPS, SHIP_BY_ID, ABILITIES, ABILITY_ORDER, DIFFICULTIES, RULE_INFO, CLASSIC_RULES, TACTICAL_RULES,
    THEMES, THEME_ORDER, ADMIRALS, CAMPAIGN, GAUNTLET_ROUNDS, UPGRADES, ACHIEVEMENTS
} from "./config.js";
import { Board, Intel, idx, inBounds } from "./board.js";
import { Game, HumanAgent, ScriptedAgent } from "./game.js";
import { AIAgent, heatMap } from "./ai.js";
import { Stage, webglAvailable } from "./render/stage.js";
import { Audio } from "./audio.js";
import { Net, RemoteAgent } from "./net.js";
import { mulberry32, hashString, randomSeed, dateKey, store, coordLabel, sleep, shuffle, prefersReducedMotion, isTouch } from "./util.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const h = (tag, attrs = {}, html = "") => {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
        if (k === "class") e.className = v;
        else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
        else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v === true ? "" : v);
    });
    if (html) e.innerHTML = html;
    return e;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const PRESETS = {
    classic: { ...CLASSIC_RULES },
    tactical: { ...TACTICAL_RULES },
    chaos: { difficulty: "normal", abilities: true, islands: true, mines: true, fog: true, maneuver: true, salvo: false, noTouch: false }
};

// ---------- persistent state ----------
const touch = isTouch();
const DEFAULT_SETTINGS = {
    theme: "atlantic", quality: touch ? "medium" : "high", weather: "auto", camera: "auto",
    master: 0.8, music: 0.45, sfx: 0.9, sound: true, haptics: true,
    reduced: prefersReducedMotion(), confirmShots: touch, callsign: "",
    quick: { ...TACTICAL_RULES }
};
const settings = { ...DEFAULT_SETTINGS, ...store.get("bsv2-settings", {}) };
settings.quick = { ...TACTICAL_RULES, ...(settings.quick || {}) };
const saveSettings = () => store.set("bsv2-settings", settings);

let stats = store.get("bsv2-stats", null) || { games: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0, shots: 0, hits: 0, fastest: null };
const achievements = new Set(store.get("bsv2-ach", []));
const campaignStore = store.get("bsv2-campaign", null) || { stars: {} };
let gauntlet = store.get("bsv2-gauntlet", null) || { active: false, round: 0, mods: [], best: 0 };
const dailyStore = store.get("bsv2-daily", null) || {};

let stage = null;
let audio = null;
let M = null; // current match
let online = null; // { net, isHost, oppName, meReady, themReady, rules }
let lastScreen = "menu";

// =====================================================================
// Boot
// =====================================================================
async function boot() {
    applyThemeDom(settings.theme);
    if (!webglAvailable()) {
        $("#boot").classList.add("hidden");
        $("#nogl").classList.remove("hidden");
        return;
    }
    audio = new Audio(settings);
    stage = new Stage($("#stage"), { quality: settings.quality, theme: settings.theme, reducedMotion: settings.reduced, weather: settings.weather });
    try {
        await stage.init();
    } catch (err) {
        console.error(err);
        $("#boot").classList.add("hidden");
        $("#nogl").classList.remove("hidden");
        return;
    }
    stage.setCameraMode(settings.camera);
    if (new URLSearchParams(location.search).has("debug")) window.__bsv2 = { stage, get match() { return M; } };
    stage.onThunder = () => audio.thunder();
    stage.onImpact = onStageImpact;

    buildMenu();
    buildQuick();
    buildSettings();
    buildHowto();
    bindHud();
    bindInput();
    syncWeatherAudio();

    const unlock = () => { audio.resume(); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    $("#boot").classList.add("fade");
    setTimeout(() => $("#boot").classList.add("hidden"), 700);

    const params = new URLSearchParams(location.search);
    if (params.get("join")) {
        go("online");
        $("#join-code").value = params.get("join").toUpperCase().slice(0, 5);
        history.replaceState(null, "", location.pathname);
    } else if (params.get("mode") === "daily") {
        startDaily();
    } else {
        go("menu");
    }
}

function onStageImpact(kind, key) {
    if (!audio || M?.attract) return;
    switch (kind) {
        case "fire": audio.cannon(); audio.whistle(); break;
        case "miss": case "repeat": audio.splash(); break;
        case "hit": audio.explosion(false); break;
        case "sunk": audio.explosion(true); break;
        case "mine": case "mine-cleared": audio.mine(); break;
        case "armor": audio.deflect(); break;
        case "blocked": audio.splash(); break;
        case "sonar": audio.sonar(); break;
        case "plane": audio.plane(); break;
        case "torpedo": audio.torpedo(); break;
        case "repair": audio.repair(); break;
        case "move": audio.move(); break;
        default: break;
    }
}

// =====================================================================
// Screens
// =====================================================================
const SCREENS = ["menu", "quick", "campaign", "gauntlet", "online", "records", "settings", "howto"];

function go(id) {
    if (id === "daily") { startDaily(); return; }
    if (id === "hotseat") { startHotseat(); return; }
    SCREENS.forEach((s) => $(`#${s}`).classList.toggle("hidden", s !== id));
    $("#hud").classList.add("hidden");
    hideModal();
    if (id !== "settings") lastScreen = id;
    if (id === "menu") { refreshMenu(); if (!M || !M.attract) startAttract(); }
    if (id === "campaign") renderCampaign();
    if (id === "gauntlet") renderGauntlet();
    if (id === "records") renderRecords();
    if (id === "online") $("#callsign").value = settings.callsign || "";
    if (id === "settings") buildSettings();
    stage?.setInsets(0, 0);
}

function backTarget() {
    return M && !M.attract && M.phase !== "over" ? "battle" : "menu";
}

function buildMenu() {
    $$("[data-go]").forEach((b) => b.addEventListener("click", () => { audio.click(); go(b.dataset.go); }));
    $$("[data-back]").forEach((b) => b.addEventListener("click", () => {
        audio.click();
        if (b.closest("#settings") && backTarget() === "battle") { resumeHud(); return; }
        go("menu");
    }));
    $$(".mode-btn").forEach((b) => b.addEventListener("pointermove", (e) => {
        const r = b.getBoundingClientRect();
        b.style.setProperty("--mx", `${e.clientX - r.left}px`);
        b.style.setProperty("--my", `${e.clientY - r.top}px`);
    }));
    $("#classic-link").addEventListener("click", () => { try { localStorage.setItem("battleship-version", "v1"); } catch (e) { /* ignore */ } });
    const row = $(".theme-row");
    THEME_ORDER.forEach((t) => {
        const b = h("button", { type: "button", class: "theme-dot-btn", "data-theme": t, onclick: () => { audio.click(); setTheme(t); } },
            `<span class="theme-dot ${t}"></span>${THEMES[t].label}`);
        row.appendChild(b);
    });
    $("#online-host").addEventListener("click", hostOnline);
    $("#online-join").addEventListener("click", () => joinOnline($("#join-code").value));
    $("#join-code").addEventListener("keydown", (e) => { if (e.key === "Enter") joinOnline($("#join-code").value); });
    $("#callsign").addEventListener("change", (e) => { settings.callsign = e.target.value.trim().slice(0, 16); saveSettings(); });
    $$("#online-preset button").forEach((b) => b.addEventListener("click", () => {
        $$("#online-preset button").forEach((x) => x.classList.toggle("active", x === b));
    }));
}

function refreshMenu() {
    const total = Object.values(campaignStore.stars).reduce((a, b) => a + b, 0);
    $("#campaign-progress").textContent = `${CAMPAIGN.length} admirals · ${total}/24 ★`;
    const d = dailyStore[dateKey()];
    $("#daily-sub").textContent = d?.won ? `Won today in ${d.best} shots · try to beat it` : "Same seas for everyone today";
    $$(".theme-dot-btn").forEach((b) => b.classList.toggle("active", b.dataset.theme === settings.theme));
}

function setTheme(t) {
    settings.theme = t;
    saveSettings();
    applyThemeDom(t);
    stage?.setTheme(t);
    syncWeatherAudio();
    refreshMenu();
    if (M && !M.attract) syncFull();
}

function applyThemeDom(t) {
    document.body.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#041426");
}

function syncWeatherAudio() {
    if (!audio || !stage) return;
    audio.setRain(stage.storm && !settings.reduced);
}

// ----- quick battle -----
function buildQuick() {
    const diff = $("#quick-diff");
    Object.entries(DIFFICULTIES).forEach(([k, d]) => {
        diff.appendChild(h("button", { type: "button", "data-diff": k, onclick: () => { settings.quick.difficulty = k; saveSettings(); renderQuick(); } },
            `${d.label}<small>${d.desc}</small>`));
    });
    $$("#quick-preset button").forEach((b) => b.addEventListener("click", () => {
        settings.quick = { ...PRESETS[b.dataset.preset], difficulty: settings.quick.difficulty };
        saveSettings();
        renderQuick();
    }));
    const grid = $("#quick-rules");
    Object.entries(RULE_INFO).forEach(([k, r]) => {
        grid.appendChild(h("button", {
            type: "button", class: "rule-toggle", "data-rule": k, "aria-pressed": "false",
            onclick: () => { settings.quick[k] = !settings.quick[k]; saveSettings(); audio.click(); renderQuick(); }
        }, `<i class="fa-solid ${r.icon}"></i><div><b>${r.label}</b><small>${r.desc}</small></div><span class="sw"></span>`));
    });
    $("#quick-start").addEventListener("click", () => { audio.click(); startQuick(); });
    renderQuick();
}

function renderQuick() {
    const q = settings.quick;
    $$("#quick-diff button").forEach((b) => b.classList.toggle("active", b.dataset.diff === q.difficulty));
    $$("#quick-rules .rule-toggle").forEach((b) => b.setAttribute("aria-pressed", String(!!q[b.dataset.rule])));
    const match = Object.entries(PRESETS).find(([, p]) => Object.keys(RULE_INFO).every((k) => !!p[k] === !!q[k]));
    $$("#quick-preset button").forEach((b) => b.classList.toggle("active", match?.[0] === b.dataset.preset));
}

// ----- campaign -----
function renderCampaign() {
    const list = $("#mission-list");
    list.innerHTML = "";
    let total = 0;
    CAMPAIGN.forEach((m, i) => {
        const a = ADMIRALS[m.admiral];
        const stars = campaignStore.stars[m.id] || 0;
        total += stars;
        const unlocked = i === 0 || (campaignStore.stars[CAMPAIGN[i - 1].id] || 0) > 0;
        const li = h("li");
        const btn = h("button", { type: "button", class: "mission", disabled: !unlocked, onclick: () => { audio.click(); showBriefing(i); } },
            `<span class="portrait" style="color:${a.color}"><i class="fa-solid ${unlocked ? a.icon : "fa-lock"}"></i></span>
             <span><b>${i + 1}. ${esc(m.title)}</b><small>${esc(a.name)} — ${esc(a.title)}</small></span>
             <span class="stars">${starStr(stars)}</span>`);
        li.appendChild(btn);
        list.appendChild(li);
    });
    $("#campaign-stars").textContent = `${total}/24 ★`;
}

const starStr = (n) => [0, 1, 2].map((i) => (i < n ? "★" : '<span class="off">★</span>')).join("");

function ruleChips(rules) {
    const chips = [`<span class="rule-chip"><i class="fa-solid fa-gauge"></i>${DIFFICULTIES[rules.difficulty].label}</span>`];
    Object.entries(RULE_INFO).forEach(([k, r]) => { if (rules[k]) chips.push(`<span class="rule-chip"><i class="fa-solid ${r.icon}"></i>${r.label}</span>`); });
    if (!Object.keys(RULE_INFO).some((k) => rules[k])) chips.push('<span class="rule-chip"><i class="fa-solid fa-anchor"></i>Classic rules</span>');
    return `<div class="brief-rules">${chips.join("")}</div>`;
}

function showBriefing(i) {
    const m = CAMPAIGN[i];
    const a = ADMIRALS[m.admiral];
    showModal(`
        <div class="result-icon" style="color:${a.color}"><i class="fa-solid ${a.icon}"></i></div>
        <p class="eyebrow">Mission ${i + 1} of ${CAMPAIGN.length}</p>
        <h2>${esc(m.title)}</h2>
        <p><b>${esc(a.name)}</b> — ${esc(a.title)}</p>
        <p>“${esc(a.lines.intro[0])}”</p>
        ${ruleChips(m.rules)}
        <p>${esc(m.brief)}</p>
        <p class="tip"><i class="fa-solid fa-lightbulb"></i>${esc(m.tip)}</p>
        <div class="modal-actions">
            <button class="btn" type="button" data-act="close">Back</button>
            <button class="btn primary" type="button" data-act="start"><i class="fa-solid fa-play"></i> Set sail</button>
        </div>`, { close: hideModal, start: () => { hideModal(); startCampaign(i); } });
}

// ----- gauntlet -----
function renderGauntlet() {
    const body = $("#gauntlet-body");
    if (gauntlet.active) {
        const mods = gauntlet.mods.map((id) => UPGRADES.find((u) => u.id === id)).filter(Boolean);
        body.innerHTML = `
            <p class="muted">Run in progress. Win 5 escalating battles in a row; after each win you draft an upgrade.</p>
            <div class="result-stats"><div><b>${gauntlet.round + 1}/5</b><span>Next round</span></div><div><b>${mods.length}</b><span>Upgrades</span></div><div><b>${gauntlet.best}</b><span>Best</span></div></div>
            <div class="mods-row">${mods.map((u) => `<span class="rule-chip"><i class="fa-solid ${u.icon}"></i>${esc(u.name)}</span>`).join("") || '<span class="muted">No upgrades yet</span>'}</div>
            <div class="modal-actions">
                <button class="btn danger" type="button" id="g-abandon">Abandon run</button>
                <button class="btn primary" type="button" id="g-continue"><i class="fa-solid fa-play"></i> Continue</button>
            </div>`;
        $("#g-continue").onclick = () => { audio.click(); startGauntletRound(); };
        $("#g-abandon").onclick = () => {
            gauntlet.best = Math.max(gauntlet.best, gauntlet.round);
            gauntlet.active = false;
            store.set("bsv2-gauntlet", gauntlet);
            renderGauntlet();
        };
    } else {
        body.innerHTML = `
            <p class="muted">Five battles in a row against tougher and tougher fleets: more mines, fog, armored hulls, ships that move. Lose once and the run is over. After each win you choose 1 of 3 upgrades.</p>
            <div class="result-stats"><div><b>5</b><span>Rounds</span></div><div><b>${UPGRADES.length}</b><span>Upgrades</span></div><div><b>${gauntlet.best || 0}</b><span>Best run</span></div></div>
            <button class="btn primary big" type="button" id="g-start"><i class="fa-solid fa-skull"></i> Start a run</button>`;
        $("#g-start").onclick = () => {
            audio.click();
            gauntlet = { active: true, round: 0, mods: [], best: gauntlet.best || 0 };
            store.set("bsv2-gauntlet", gauntlet);
            startGauntletRound();
        };
    }
}

// ----- records -----
function renderRecords() {
    const acc = stats.shots ? Math.round((stats.hits / stats.shots) * 100) : 0;
    const fastest = stats.fastest ? fmtTime(stats.fastest) : "—";
    const totalStars = Object.values(campaignStore.stars).reduce((a, b) => a + b, 0);
    $("#stat-grid").innerHTML = [
        ["Battles", stats.games], ["Wins", stats.wins], ["Losses", stats.losses], ["Win rate", stats.games ? `${Math.round((stats.wins / stats.games) * 100)}%` : "—"],
        ["Best streak", stats.bestStreak], ["Accuracy", `${acc}%`], ["Fastest win", fastest], ["Campaign", `${totalStars}/24 ★`]
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join("");
    $("#ach-grid").innerHTML = ACHIEVEMENTS.map((a) =>
        `<li class="ach ${achievements.has(a.id) ? "on" : ""}"><i class="fa-solid ${a.icon}"></i><div><b>${esc(a.title)}</b><small>${esc(a.desc)}</small></div></li>`).join("");
    $("#ach-count").textContent = `${achievements.size}/${ACHIEVEMENTS.length}`;
}

// ----- settings -----
function buildSettings() {
    const body = $("#settings-body");
    body.innerHTML = "";
    const seg = (key, opts, onChange) => {
        const d = h("div", { class: "seg" });
        opts.forEach(([v, label]) => d.appendChild(h("button", {
            type: "button", class: settings[key] === v ? "active" : "",
            onclick: () => { settings[key] = v; saveSettings(); onChange?.(v); audio.click(); buildSettings(); }
        }, label)));
        return d;
    };
    const toggle = (key, onChange) => {
        const b = h("button", { type: "button", class: "rule-toggle", "aria-pressed": String(!!settings[key]), style: "padding:6px 10px" }, '<span class="sw"></span>');
        b.style.gridTemplateColumns = "auto";
        b.onclick = () => { settings[key] = !settings[key]; saveSettings(); onChange?.(settings[key]); audio.click(); buildSettings(); };
        return b;
    };
    const range = (key) => {
        const r = h("input", { type: "range", min: "0", max: "1", step: "0.05", value: settings[key], "aria-label": key });
        r.oninput = () => { settings[key] = Number(r.value); saveSettings(); audio.applyVolumes(); };
        return r;
    };
    const row = (title, desc, control) => {
        const d = h("div", { class: "set-row" }, `<div><b>${title}</b>${desc ? `<small>${desc}</small>` : ""}</div>`);
        d.appendChild(control);
        body.appendChild(d);
    };
    row("Theme", "", seg("theme", THEME_ORDER.map((t) => [t, THEMES[t].label]), (v) => setTheme(v)));
    row("Graphics", "Low skips bloom and lowers resolution.", seg("quality", [["low", "Low"], ["medium", "Medium"], ["high", "High"]], (v) => stage.setQuality(v)));
    row("Weather", "Auto = storms on Atlantic.", seg("weather", [["auto", "Auto"], ["clear", "Clear"], ["storm", "Storm"]], (v) => { stage.setWeather(v); syncWeatherAudio(); }));
    row("Camera", "Auto shows both boards on wide screens.", seg("camera", [["auto", "Auto"], ["both", "Both"], ["focus", "Focus"]], (v) => stage.setCameraMode(v)));
    row("Master volume", "", range("master"));
    row("Music &amp; ambience", "", range("music"));
    row("Effects", "", range("sfx"));
    row("Sound", "", toggle("sound", () => audio.applyVolumes()));
    row("Haptics", "Vibrate on hits (mobile).", toggle("haptics"));
    row("Confirm shots", "Tap a cell twice to fire (recommended on touch).", toggle("confirmShots"));
    row("Reduced motion", "Shorter effects, no camera shake or slow-mo.", toggle("reduced", (v) => { stage.reducedMotion = v; stage.setWeather(settings.weather); syncWeatherAudio(); }));
    const reset = h("button", { type: "button", class: "btn danger" }, '<i class="fa-solid fa-trash"></i> Reset');
    reset.onclick = () => showModal(`<h2>Reset progress?</h2><p>This clears v2 stats, achievements, campaign stars and the Gauntlet. Classic v1 is not affected.</p>
        <div class="modal-actions"><button class="btn" data-act="close" type="button">Cancel</button><button class="btn danger" data-act="ok" type="button">Reset</button></div>`, {
        close: hideModal,
        ok: () => {
            ["bsv2-stats", "bsv2-ach", "bsv2-campaign", "bsv2-gauntlet", "bsv2-daily"].forEach((k) => store.set(k, null));
            location.reload();
        }
    });
    row("Reset v2 progress", "", reset);
}

function buildHowto() {
    const ab = ABILITY_ORDER.map((id) => {
        const a = ABILITIES[id];
        return `<section><h3><i class="fa-solid ${a.icon}"></i>${a.name} <small class="muted">· ${SHIP_BY_ID[a.ship].name} · <kbd>${a.key}</kbd></small></h3><p>${a.desc} Cooldown ${a.cooldown} turns.</p></section>`;
    }).join("");
    const rules = Object.values(RULE_INFO).map((r) => `<section><h3><i class="fa-solid ${r.icon}"></i>${r.label}</h3><p>${r.desc}</p></section>`).join("");
    $("#howto-body").innerHTML = `
        <section><h3><i class="fa-solid fa-anchor"></i>The basics</h3><p>Same game as v1: hide 5 ships (Carrier 5, Battleship 4, Cruiser 3, Submarine 3, Destroyer 2) on a 10×10 grid and sink the enemy fleet first. Red = hit, white = miss.</p></section>
        <section><h3><i class="fa-solid fa-hand-pointer"></i>Placing ships</h3><p>Hover or drag over your grid and tap to drop a ship. <kbd>R</kbd>, right-click or the mouse wheel rotates. Tap a placed ship to pick it up again, or use Auto.</p></section>
        ${ab}${rules}
        <section><h3><i class="fa-solid fa-brain"></i>Coach</h3><p>Overlays the Hard AI's probability heat map on enemy waters, so you can learn how it hunts.</p></section>
        <section><h3><i class="fa-solid fa-keyboard"></i>Keyboard</h3><p>Arrow keys move the cursor and <kbd>Enter</kbd> fires. <kbd>1</kbd>–<kbd>5</kbd> pick abilities, <kbd>M</kbd> maneuver, <kbd>F</kbd> fire mode / fire salvo, <kbd>C</kbd> coach, <kbd>V</kbd> camera, <kbd>L</kbd> log, <kbd>Esc</kbd> cancel.</p></section>`;
}

// =====================================================================
// Modal / toast / callouts
// =====================================================================
function showModal(html, actions = {}) {
    const card = $("#modal-card");
    card.innerHTML = html;
    $("#modal").classList.remove("hidden");
    card.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => { audio?.click(); actions[b.dataset.act]?.(b); }));
    const first = card.querySelector(".btn.primary") || card.querySelector("button");
    first?.focus({ preventScroll: true });
}
function hideModal() { $("#modal").classList.add("hidden"); }
const modalOpen = () => !$("#modal").classList.contains("hidden");

function toast(html, cls = "", ms = 2600) {
    const t = h("div", { class: `toast ${cls}` }, html);
    $("#toast-stack").appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, ms);
}

function callout(text, cls) {
    if (M?.attract) return;
    $$(".callout").forEach((c) => c.remove());
    const c = h("div", { class: `callout ${cls}` }, esc(text));
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1300);
}

function fmtTime(ms) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// =====================================================================
// Match setup
// =====================================================================
function teardownMatch({ keepNet = false } = {}) {
    if (M?.game) M.game.abort();
    if (M?.restartTimer) clearTimeout(M.restartTimer);
    M = null;
    if (!keepNet && online) { online.net.close(); online = null; }
    stage?.resetAll();
    $$(".callout").forEach((c) => c.remove());
}

function startAttract() {
    teardownMatch({ keepNet: true });
    const seed = randomSeed();
    const rng = mulberry32(seed);
    const rules = { ...PRESETS.chaos, maneuver: false, difficulty: "hard" };
    const boards = [new Board(), new Board()];
    const agents = [0, 1].map((i) => new AIAgent({ difficulty: i ? "hard" : "normal", rng: mulberry32(seed + i), pers: { think: 900, aggression: 0.7 } }));
    boards.forEach((b, i) => { b.generateTerrain(rng, rules); agents[i].placeFleet(b, rules); b.placeMines(rng, 3); });
    const sides = [0, 1].map((i) => ({ name: i ? "Blue" : "Red", kind: "ai", agent: agents[i], board: boards[i], intel: new Intel(boards[1 - i].publicTerrain()) }));
    M = { attract: true, mode: "attract", rules, viewer: 0, sides, revealEnemy: true, phase: "battle" };
    syncFull();
    stage.focus("menu");
    audio.setMusicState("menu");
    const game = new Game({ rules, sides, presenter });
    M.game = game;
    M.sides = game.sides;
    game.run().catch((e) => console.error(e));
}

function admiralFor(key) { return ADMIRALS[key] || ADMIRALS.quick; }

function setupMatch(cfg) {
    teardownMatch({ keepNet: cfg.mode === "online" });
    const rules = { ...cfg.rules };
    const seed = cfg.seed ?? randomSeed();
    const rng = mulberry32(seed);
    const admiral = admiralFor(cfg.admiral);
    const tSeeds = cfg.terrainSeeds || [seed ^ 0x9e3779b9, seed ^ 0x85ebca6b];
    const b0 = new Board();
    b0.generateTerrain(mulberry32(tSeeds[0]), rules);
    let b1 = null;
    let terrain1;
    if (cfg.opponent === "remote") {
        const tmp = new Board();
        tmp.generateTerrain(mulberry32(tSeeds[1]), rules);
        terrain1 = tmp.publicTerrain();
    } else {
        b1 = new Board();
        b1.generateTerrain(mulberry32(tSeeds[1]), rules);
        terrain1 = b1.publicTerrain();
    }
    const names = cfg.names || ["You", admiral.name];
    const sides = [
        { name: names[0], kind: "human", agent: new HumanAgent(), board: b0, intel: new Intel(terrain1), mods: new Set(cfg.playerMods || []) },
        null
    ];
    if (cfg.opponent === "ai") {
        const ai = new AIAgent({ difficulty: rules.difficulty, pers: admiral.pers, rng: mulberry32(seed ^ 0x2545f491) });
        ai.placeFleet(b1, rules);
        if (rules.mines) b1.placeMines(rng, 3 + (cfg.enemyExtraMines ?? admiral.pers.extraMines ?? 0));
        (cfg.enemyArmor ?? admiral.pers.armor ?? []).forEach((id) => { const s = b1.ships.find((x) => x.id === id); if (s) s.armor = 1; });
        sides[1] = { name: names[1], kind: "ai", agent: ai, board: b1, intel: new Intel(b0.publicTerrain()), mods: new Set(cfg.enemyMods || []) };
    } else if (cfg.opponent === "human") {
        sides[1] = { name: names[1], kind: "human", agent: new HumanAgent(), board: b1, intel: new Intel(b0.publicTerrain()), mods: new Set() };
    } else {
        sides[1] = { name: names[1], kind: "remote", agent: new RemoteAgent(online.net), board: null, intel: new Intel(b0.publicTerrain()), mods: new Set() };
    }
    M = {
        ...cfg, rules, seed, rng, admiral, admiralKey: cfg.admiral || "quick", sides, viewer: 0, phase: "placement",
        coach: false, revealEnemy: false, busy: false, startedAt: 0, targeting: null, replaySpeed: 1, flags: {}
    };
    $("#hud-mode").textContent = cfg.title || "Battle";
    $("#hud-sub").textContent = cfg.sub || `${DIFFICULTIES[rules.difficulty]?.label || ""} · vs ${names[1]}`;
    $("#log-list").innerHTML = "";
    SCREENS.forEach((s) => $(`#${s}`).classList.add("hidden"));
    hideModal();
    $("#hud").classList.remove("hidden");
    $("#replay-bar").classList.add("hidden");
    $("#emotes").classList.toggle("hidden", cfg.mode !== "online");
    stage.resetAll();
    enterPlacement(0);
}

function startQuick() {
    const rules = { ...settings.quick };
    setupMatch({ mode: "quick", opponent: "ai", rules, admiral: "quick", title: "Quick Battle" });
}

function startCampaign(i) {
    const m = CAMPAIGN[i];
    setupMatch({ mode: "campaign", opponent: "ai", rules: { ...m.rules }, admiral: m.admiral, missionIdx: i, title: `Mission ${i + 1} · ${m.title}`, sub: `${ADMIRALS[m.admiral].name}` });
    setTimeout(() => toast(`<i class="fa-solid fa-lightbulb"></i> ${esc(m.tip)}`, "", 5200), 600);
}

function startGauntletRound() {
    const r = GAUNTLET_ROUNDS[gauntlet.round];
    const rules = { difficulty: r.difficulty, abilities: true, islands: r.islands, mines: r.mines, fog: r.fog, maneuver: r.maneuver, salvo: false, noTouch: false };
    setupMatch({
        mode: "gauntlet", opponent: "ai", rules, admiral: "gauntlet", title: `Gauntlet · Round ${gauntlet.round + 1}/5`,
        sub: `${DIFFICULTIES[r.difficulty].label} · ${gauntlet.mods.length} upgrades`,
        playerMods: gauntlet.mods, enemyExtraMines: r.enemyMines, enemyArmor: r.enemyArmor || []
    });
}

function startDaily() {
    const key = dateKey();
    const seed = hashString(`bsv2-daily-${key}`);
    const rules = { difficulty: "normal", abilities: true, islands: true, mines: true, fog: true, maneuver: false, salvo: false, noTouch: false };
    setupMatch({ mode: "daily", opponent: "ai", rules, admiral: "quick", seed, title: "Daily Challenge", sub: key });
}

function startHotseat() {
    const rules = { ...settings.quick };
    setupMatch({ mode: "hotseat", opponent: "human", rules, names: ["Captain 1", "Captain 2"], title: "Pass & Play", sub: "Captain 1 vs Captain 2" });
}

// =====================================================================
// Rendering sync
// =====================================================================
function viewerSide() { return M.sides[M.viewer]; }
function oppSide() { return M.sides[1 - M.viewer]; }

function syncFull() {
    const me = viewerSide();
    stage.setTerrain("home", { island: me.board.island, fog: me.board.fog });
    stage.setTerrain("enemy", { island: me.intel.island, fog: me.intel.fog });
    syncDynamic();
}

function shipView(s) {
    return { id: s.id, size: s.size || s.cells.length, cells: s.cells, horizontal: s.horizontal ?? (s.cells.length < 2 || s.cells[0].y === s.cells[1].y), sunk: !!s.sunk };
}

function syncDynamic() {
    if (!M) return;
    const me = viewerSide();
    const opp = oppSide();
    stage.syncShips("home", me.board.ships.map(shipView));
    stage.setMines("home", me.board.mine);
    stage.syncMarkers("home", me.board.homeStates());
    const enemyShips = me.intel.sunk.map((s) => ({ ...shipView(s), sunk: true }));
    if (M.revealEnemy && opp.board) {
        opp.board.ships.filter((s) => !s.sunk).forEach((s) => enemyShips.push(shipView(s)));
    }
    stage.syncShips("enemy", enemyShips, { reveal: M.revealEnemy });
    if (M.revealEnemy && opp.board) stage.setMines("enemy", opp.board.mine);
    else stage.setMines("enemy", null);
    const states = me.intel.state.map((s, i) => (me.intel.island[i] ? "none" : s));
    stage.syncMarkers("enemy", states);
    stage.syncLines("enemy", me.intel.lines);
    if (!M.attract) updateFleetCards();
}

function updateFleetCards() {
    const me = viewerSide();
    const g = M.game;
    const rules = M.rules;
    const homeRows = SHIPS.map((def) => {
        const s = me.board.ships.find((x) => x.id === def.id);
        let pips = "";
        if (!s) pips = Array.from({ length: def.size }, () => '<i class="pip unknown"></i>').join("");
        else pips = s.cells.map((c) => `<i class="pip ${s.sunk ? "dead" : me.board.hit[idx(c.x, c.y)] ? "hit" : ""}"></i>`).join("");
        const armor = s?.armor ? '<i class="fa-solid fa-shield-halved armor-tag" title="Armored"></i>' : "";
        return `<div class="ship-row ${s?.sunk ? "sunk" : ""}"><span class="ship-name">${def.name}${armor}</span><span class="pips">${pips}</span></div>`;
    }).join("");
    const alive = me.board.ships.filter((s) => !s.sunk).length;
    $("#fleet-home").innerHTML = `<h3><span>${esc(me.name === "You" ? "Your fleet" : me.name)}</span><span>${alive}/${SHIPS.length}</span></h3>${homeRows}`;
    const sunkIds = new Set(me.intel.sunk.map((s) => s.id));
    const oppIdx = 1 - M.viewer;
    const enemyRows = SHIPS.map((def) => {
        const sunk = sunkIds.has(def.id);
        const pips = Array.from({ length: def.size }, () => `<i class="pip ${sunk ? "hit" : "unknown"}"></i>`).join("");
        let cd = "";
        if (g && rules.abilities && !sunk) {
            const v = g.sides[oppIdx].cooldowns[def.ability];
            cd = v > 0 ? ` <small class="muted" title="${ABILITIES[def.ability].name} cooldown">${v}</small>` : ` <i class="fa-solid ${ABILITIES[def.ability].icon}" style="color:var(--enemy);font-size:0.7rem" title="${ABILITIES[def.ability].name} ready"></i>`;
        }
        return `<div class="ship-row ${sunk ? "sunk" : ""}"><span class="ship-name">${def.name}${cd}</span><span class="pips">${pips}</span></div>`;
    }).join("");
    const oppName = oppSide().name;
    $("#fleet-enemy").innerHTML = `<h3><span>${esc(oppName)}</span><span>${SHIPS.length - sunkIds.size}/${SHIPS.length}</span></h3>${enemyRows}`;
}

function updateInsets() {
    if (!stage || $("#hud").classList.contains("hidden")) { stage?.setInsets(0, 0); return; }
    const top = $("#hud-top").getBoundingClientRect().bottom;
    let bottomEdge = $("#hud-bottom").getBoundingClientRect().top + 24;
    if (window.innerWidth <= 860) {
        ["#fleet-home", "#fleet-enemy"].forEach((s) => {
            const r = $(s).getBoundingClientRect();
            if (r.height && r.top > window.innerHeight / 2) bottomEdge = Math.min(bottomEdge, r.top + 6);
        });
    }
    stage.setInsets(Math.max(0, top - 6), Math.max(0, window.innerHeight - bottomEdge));
}

function setBanner(text, who = "") {
    const b = $("#turn-banner");
    b.textContent = text;
    b.className = `turn-banner ${who}`;
    void b.offsetWidth;
    b.classList.add("pop");
}

function setHint(text) { $("#hint").innerHTML = text || ""; }

// =====================================================================
// Placement
// =====================================================================
function firstUnplaced(board) {
    return SHIPS.find((s) => !board.ships.some((b) => b.id === s.id))?.id ?? null;
}

function enterPlacement(sideIdx) {
    M.phase = "placement";
    M.viewer = sideIdx;
    const board = M.sides[sideIdx].board;
    M.placement = { side: sideIdx, current: firstUnplaced(board), horizontal: true, hover: null };
    stage.resetAll();
    syncFull();
    stage.focus("home", { force: true });
    $("#placement-bar").classList.remove("hidden");
    $("#action-bar").classList.add("hidden");
    renderDock();
    updatePlacementButtons();
    const who = M.mode === "hotseat" ? `${M.sides[sideIdx].name}: deploy your fleet` : "Deploy your fleet";
    setBanner(who, "you");
    setHint(touch ? "Drag over your grid to aim · release to drop · Rotate to turn" : "Hover your grid · click to drop · R / right-click / wheel to rotate");
    audio.setMusicState("placement");
    requestAnimationFrame(updateInsets);
}

function renderDock() {
    const dock = $("#dock");
    dock.innerHTML = "";
    const board = M.sides[M.placement.side].board;
    SHIPS.forEach((def) => {
        const placed = board.ships.some((s) => s.id === def.id);
        const chip = h("button", {
            type: "button",
            class: `dock-chip ${placed ? "placed" : ""} ${M.placement.current === def.id ? "current" : ""}`,
            title: placed ? `${def.name} — tap to pick up` : def.name,
            onclick: () => {
                audio.click();
                if (placed) {
                    const s = board.removeShip(def.id);
                    M.placement.horizontal = s.horizontal;
                }
                M.placement.current = def.id;
                afterPlacementChange();
            }
        }, `<span class="len">${Array.from({ length: def.size }, () => "<i></i>").join("")}</span><span>${def.name}</span>`);
        dock.appendChild(chip);
    });
}

function updatePlacementButtons() {
    const board = M.sides[M.placement.side].board;
    $("#pl-ready").disabled = !board.complete;
    $("#pl-undo").disabled = board.ships.length === 0;
    $("#pl-clear").disabled = board.ships.length === 0;
}

function afterPlacementChange() {
    syncDynamic();
    renderDock();
    updatePlacementButtons();
    previewPlacement();
}

function placementAnchor(def, x, y, horizontal) {
    const off = Math.floor((def.size - 1) / 2);
    let ax = horizontal ? x - off : x;
    let ay = horizontal ? y : y - off;
    ax = Math.max(0, Math.min(ax, horizontal ? GRID - def.size : GRID - 1));
    ay = Math.max(0, Math.min(ay, horizontal ? GRID - 1 : GRID - def.size));
    return { x: ax, y: ay };
}

function previewPlacement() {
    const pl = M.placement;
    if (!pl?.hover || !pl.current) {
        stage.clearGhost();
        stage.setHighlights("home", "hover", pl?.hover ? [{ ...pl.hover, color: 0x7fe3d2 }] : []);
        return;
    }
    const def = SHIP_BY_ID[pl.current];
    const board = M.sides[pl.side].board;
    const a = placementAnchor(def, pl.hover.x, pl.hover.y, pl.horizontal);
    const ok = board.canPlace(def.size, a.x, a.y, pl.horizontal, { noTouch: M.rules.noTouch });
    stage.setGhost("home", def, a.x, a.y, pl.horizontal, ok);
    const cells = [];
    for (let i = 0; i < def.size; i++) cells.push({ x: pl.horizontal ? a.x + i : a.x, y: pl.horizontal ? a.y : a.y + i, color: ok ? 0x7fe3d2 : 0xff4d3d });
    stage.setHighlights("home", "hover", cells);
}

function placeAt(x, y) {
    const pl = M.placement;
    const board = M.sides[pl.side].board;
    const k = board.shipIndexAt(x, y);
    if (!pl.current || (k !== -1 && pl.current)) {
        if (k !== -1) {
            const s = board.removeShip(board.ships[k].id);
            if (pl.current === null || pl.current !== s.id) {
                pl.current = s.id;
                pl.horizontal = s.horizontal;
            }
            audio.rotate();
            afterPlacementChange();
        }
        return;
    }
    const def = SHIP_BY_ID[pl.current];
    const a = placementAnchor(def, x, y, pl.horizontal);
    if (board.place(def, a.x, a.y, pl.horizontal, { noTouch: M.rules.noTouch })) {
        audio.place();
        pl.current = firstUnplaced(board);
        afterPlacementChange();
        if (board.complete) setHint("Fleet deployed! Tap a ship to move it, or press <b>Ready</b>.");
    } else {
        audio.invalid();
        setHint(M.rules.noTouch ? "Can't place there: ships must not touch, and islands block placement." : "Can't place there: that spot is blocked or out of bounds.");
    }
}

function rotatePlacement() {
    if (M?.phase !== "placement") return;
    M.placement.horizontal = !M.placement.horizontal;
    audio.rotate();
    previewPlacement();
}

function finishPlacement() {
    const board = M.sides[M.placement.side].board;
    if (!board.complete) return;
    stage.clearGhost();
    stage.clearHighlights("home");
    if (M.mode === "hotseat" && M.placement.side === 0) {
        showCurtain(`<i class="fa-solid fa-users" style="font-size:2rem;color:var(--accent)"></i><h2>Pass the device</h2>
            <p>${esc(M.sides[1].name)}, it's your turn to deploy. ${esc(M.sides[0].name)}, look away!</p>`, "I'm Captain 2", () => enterPlacement(1));
        stage.resetAll();
        return;
    }
    if (M.mode === "hotseat") {
        stage.resetAll();
        showCurtain(`<i class="fa-solid fa-flag-checkered" style="font-size:2rem;color:var(--accent)"></i><h2>Fleets deployed</h2>
            <p>Hand the device back to ${esc(M.sides[0].name)}. ${esc(M.sides[0].name)} fires first.</p>`, `I'm ${esc(M.sides[0].name)}`, () => beginBattle());
        return;
    }
    if (M.mode === "online") {
        online.meReady = true;
        online.net.send({ t: "ready" });
        $("#placement-bar").classList.add("hidden");
        if (online.themReady) beginBattle();
        else { setBanner("Waiting for opponent…", ""); setHint(`${esc(online.oppName)} is still deploying.`); }
        return;
    }
    beginBattle();
}

// =====================================================================
// Battle
// =====================================================================
function beginBattle() {
    M.sides.forEach((s) => {
        if (!s.board || s.kind === "ai") return;
        if (M.rules.mines) s.board.placeMines(M.mode === "daily" ? mulberry32(M.seed ^ 0x51ed) : Math.random, 3 + (s.mods.has("extraMines") ? 2 : 0));
        if (s.mods.has("armorCarrier")) { const c = s.board.ships.find((x) => x.id === "carrier"); if (c) c.armor = 1; }
        if (s.mods.has("armorBattleship")) { const c = s.board.ships.find((x) => x.id === "battleship"); if (c) c.armor = 1; }
    });
    M.phase = "battle";
    M.startedAt = Date.now();
    M.viewer = M.mode === "hotseat" ? 0 : M.viewer;
    if (online) { online.net.resetTurnState(); }
    const game = new Game({ rules: M.rules, sides: M.sides, presenter, first: M.first ?? 0, transport: online?.net || null });
    M.game = game;
    M.sides = game.sides;
    $("#placement-bar").classList.add("hidden");
    $("#action-bar").classList.remove("hidden");
    renderActionBar();
    stage.clearGhost();
    if (M.mode === "hotseat") { stage.resetAll(); }
    syncFull();
    requestAnimationFrame(updateInsets);
    game.run().catch((e) => console.error(e));
}

function wait(ms) {
    const k = M?.replay ? M.replaySpeed : 1;
    return sleep(ms / k);
}

async function presenter(ev, game) {
    if (!M || M.game !== game || game.aborted) return;
    switch (ev.type) {
        case "battle-start": await onBattleStart(); break;
        case "turn": await onTurn(ev.side); break;
        case "skip": await onSkip(ev.side); break;
        case "action": await animateAction(ev); break;
        case "over": await onOver(ev.winner); break;
        default: break;
    }
}

async function onBattleStart() {
    if (M.attract) return;
    audio.setMusicState("battle");
    updateTension();
    if (M.sides[1].kind === "ai") {
        say(pickLine("intro"));
    } else if (M.mode === "online") {
        toast(`<i class="fa-solid fa-globe"></i> Battle vs ${esc(online.oppName)} — ${M.first === 0 ? "you fire first" : "they fire first"}`);
    }
    await wait(500);
}

async function onTurn(s) {
    const side = M.game.sides[s];
    if (M.attract) {
        stage.focus("menu");
        return;
    }
    if (M.mode === "hotseat" && !M.replay && s !== M.viewer) await passCurtain(s);
    if (!M || M.game.sides[s] !== side) return;
    const mine = s === M.viewer && side.kind === "human" && !M.replay;
    M.busy = !mine;
    document.body.classList.toggle("busy", !mine);
    updateFleetCards();
    updateTension();
    if (mine) {
        setBanner(M.mode === "hotseat" ? `${side.name}: fire!` : "Your turn — fire!", "you");
        stage.focus("enemy");
        audio.turn();
        setTargeting("fire");
        renderActionBar();
    } else {
        const opp = M.game.sides[s];
        const who = opp.name === "You" ? "Your" : `${opp.name}'s`;
        setBanner(M.replay ? `${who} turn` : `${opp.name} is taking aim…`, s === M.viewer ? "you" : "enemy");
        stage.focus(s === M.viewer ? "enemy" : "home");
        clearTargetVisuals();
        renderActionBar();
        setHint(M.replay ? "" : side.kind === "remote" ? "Waiting for your opponent…" : "");
    }
}

async function onSkip(s) {
    if (M.attract) return;
    const name = M.game.sides[s].name;
    toast(`<i class="fa-solid fa-bomb"></i> ${esc(name)} ${s === M.viewer ? "are" : "is"} still reeling from a mine. Turn skipped!`, "bad");
    logLine(s, "Turn skipped (mine)", "warn");
    await wait(900);
}

function pickLine(kind, vars = {}) {
    const lines = M.admiral?.lines?.[kind];
    if (!lines?.length) return null;
    let l = lines[Math.floor(Math.random() * lines.length)];
    Object.entries(vars).forEach(([k, v]) => { l = l.replace(`{${k}}`, v); });
    return l;
}

let sayTimer = null;
function say(line, who = null) {
    if (!line || M?.attract) return;
    const a = who || M.admiral;
    $("#admiral").classList.remove("hidden");
    $("#admiral-portrait").innerHTML = `<i class="fa-solid ${a.icon}" style="color:${a.color}"></i>`;
    $("#admiral-name").textContent = a.name;
    $("#admiral-line").textContent = line;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => $("#admiral").classList.add("hidden"), 3200);
}

function describe(result) {
    switch (result.type) {
        case "fire": return result.cells.map((c) => `${coordLabel(c.x, c.y)} <span class="tag ${tagCls(c.r)}">${tagText(c)}</span>`).join(", ");
        case "sonar": {
            const n = result.cells.filter((c) => c.r === "contact").length;
            return `Sonar ${coordLabel(result.x, result.y)} <span class="tag info">${n} contact${n === 1 ? "" : "s"}</span>`;
        }
        case "recon": return `Recon ${result.axis === "row" ? `row ${result.index + 1}` : `col ${String.fromCharCode(65 + result.index)}`} <span class="tag info">${result.count} section${result.count === 1 ? "" : "s"}${result.fogged ? ", fog" : ""}</span>`;
        case "torpedo": {
            const lane = result.axis === "row" ? `row ${result.index + 1}` : `col ${String.fromCharCode(65 + result.index)}`;
            if (!result.hits.length) return `Torpedo ${lane} <span class="tag miss">${result.end.r === "blocked" ? "HIT ISLAND" : "NO CONTACT"}</span>`;
            return `Torpedo ${lane} → ${result.hits.map((c) => `${coordLabel(c.x, c.y)} <span class="tag ${tagCls(c.r)}">${tagText(c)}</span>`).join(", ")}`;
        }
        case "repair": return `Repaired ${coordLabel(result.x, result.y)} <span class="tag info">PATCHED</span>`;
        case "move": return 'Fleet maneuvered <span class="tag info">MOVE</span>';
        default: return "Passed";
    }
}
const tagCls = (r) => (r === "hit" || r === "sunk" ? r : r === "miss" || r === "repeat" || r === "blocked" ? "miss" : "warn");
const tagText = (c) => (c.r === "sunk" ? `SUNK ${c.ship.name.toUpperCase()}` : c.r === "mine" ? "MINE!" : c.r === "mine-cleared" ? "MINE CLEARED" : c.r === "armor" ? "DEFLECTED" : c.r.toUpperCase());

function logLine(s, html, cls = "") {
    if (M.attract) return;
    const li = h("li", { class: s === M.viewer ? "me" : "them" },
        `<span class="log-side">${s === M.viewer ? (M.mode === "hotseat" ? esc(M.game.sides[s].name) : "YOU") : esc(M.game.sides[s].name).toUpperCase()}</span><span class="${cls}">${html}</span>`);
    const list = $("#log-list");
    list.prepend(li);
    while (list.children.length > 60) list.lastChild.remove();
}

async function animateAction(ev) {
    const { side: s, action, result } = ev;
    if (!result) return;
    const game = M.game;
    const mine = s === M.viewer;
    const fromKey = mine ? "home" : "enemy";
    const toKey = mine ? "enemy" : "home";
    clearTargetVisuals();
    const strikes = result.type === "fire" ? result.cells : result.type === "torpedo" ? result.hits : [];
    const sunk = strikes.filter((c) => c.r === "sunk");
    const finalBlow = sunk.length && game.defeated(1 - s);
    if (finalBlow && !M.attract) stage.killcam(toKey, sunk[sunk.length - 1].x, sunk[sunk.length - 1].y);

    switch (result.type) {
        case "fire": await stage.shoot({ fromKey, toKey, cells: result.cells, kind: action.kind }); break;
        case "sonar": await stage.sonar({ key: toKey, x: result.x, y: result.y, radius: result.radius }); break;
        case "recon": await stage.recon({ key: toKey, axis: result.axis, index: result.index }); break;
        case "torpedo": await stage.torpedo({ toKey, axis: result.axis, path: result.path, end: result.end }); break;
        case "repair": await stage.repair({ key: mine ? "home" : "enemy", x: result.x, y: result.y }); break;
        case "move":
            if (mine && result.to) await stage.moveShip({ key: "home", id: result.shipId, to: result.to });
            else if (!M.attract) toast('<i class="fa-solid fa-arrows-up-down-left-right"></i> Enemy fleet maneuvered. Old contacts may be stale!');
            break;
        default: break;
    }
    if (!M || M.game !== game) return;
    syncDynamic();
    if (M.attract) { await sleep(250); return; }

    const hits = strikes.filter((c) => c.r === "hit");
    const mineHit = strikes.some((c) => c.r === "mine");
    const deflect = strikes.some((c) => c.r === "armor");
    if (sunk.length) {
        const name = sunk[0].ship.name;
        callout(mine ? `${name} sunk!` : `${name} lost!`, "sunk");
        if (mine) say(pickLine("sunk", { ship: name }));
        else say(pickLine("aiSunk", { ship: name }));
    } else if (mineHit) {
        callout("MINE!", "info");
    } else if (hits.length) {
        callout(hits.length > 1 ? `${hits.length} HITS` : "HIT!", "hit");
        if (Math.random() < 0.45) say(pickLine(mine ? "hit" : "aiHit"));
    } else if (deflect) {
        callout("DEFLECTED", "info");
    } else if (result.type === "fire" && mine && result.cells.length === 1) {
        callout("MISS", "miss");
        if (Math.random() < 0.25) say(pickLine("miss"));
    } else if (result.type === "recon" && mine) {
        callout(`${result.count} DETECTED`, "info");
    } else if (result.type === "sonar" && mine) {
        const n = result.cells.filter((c) => c.r === "contact").length;
        callout(n ? `${n} CONTACT${n > 1 ? "S" : ""}` : "ALL CLEAR", "info");
    }
    if (result.type === "sonar" && !mine) toast('<i class="fa-solid fa-satellite-dish"></i> Enemy sonar ping detected!');
    if (result.type === "recon" && !mine) toast('<i class="fa-solid fa-plane"></i> Enemy recon flight overhead!');
    if (result.type === "repair" && !mine) toast('<i class="fa-solid fa-screwdriver-wrench"></i> Enemy repaired a damaged section!');
    logLine(s, describe(result));
    updateTension();
    await wait(sunk.length ? 700 : 350);
}

function updateTension() {
    if (!M?.game || M.attract) return;
    const a = M.game.aliveCount(0);
    const b = M.game.aliveCount(1);
    const t = Math.max(1 - a / 5, 1 - b / 5) * 0.85 + (a <= 2 || b <= 2 ? 0.15 : 0);
    audio.setTension(t);
}

// ----- hotseat curtain -----
function showCurtain(html, btnLabel, onGo) {
    const card = $("#curtain-card");
    card.innerHTML = `${html}<div class="modal-actions"><button class="btn primary" type="button" id="curtain-go">${btnLabel}</button></div>`;
    $("#curtain").classList.remove("hidden");
    $("#curtain-go").focus();
    $("#curtain-go").onclick = () => { $("#curtain").classList.add("hidden"); audio.click(); onGo(); };
}

function passCurtain(s) {
    return new Promise((resolve) => {
        const name = M.game.sides[s].name;
        const incoming = M.game.log.filter((e) => e.side !== s).slice(-1)[0];
        stage.resetAll();
        showCurtain(`<i class="fa-solid fa-users" style="font-size:2rem;color:var(--accent)"></i><h2>${esc(name)}'s turn</h2>
            <p>Pass the device. ${incoming ? "Your opponent just fired. Check your fleet." : ""}</p>`, `I'm ${esc(name)}`, () => {
            M.viewer = s;
            syncFull();
            resolve();
        });
    });
}

// ----- over -----
async function onOver(winner) {
    if (M.attract) {
        M.revealEnemy = true;
        syncDynamic();
        M.restartTimer = setTimeout(() => { if (M?.attract) startAttract(); }, 3500);
        return;
    }
    M.phase = "over";
    M.busy = true;
    clearTargetVisuals();
    $("#action-bar").classList.add("hidden");
    const g = M.game;
    const won = winner === M.viewer;
    M.revealEnemy = M.mode !== "online";
    syncDynamic();
    audio.setMusicState("menu");
    audio.setTension(0);
    if (M.replay) {
        setBanner("Replay complete", "");
        await sleep(800);
        if (!M || M.game !== g) return;
        showModal(`<h2>Replay complete</h2><p>${esc(g.sides[winner].name)} won this battle.</p>
            <div class="modal-actions"><button class="btn" data-act="menu" type="button">Menu</button><button class="btn primary" data-act="again" type="button"><i class="fa-solid fa-film"></i> Watch again</button></div>`,
        { menu: () => go("menu"), again: () => startReplay(M.replaySource) });
        return;
    }
    if (M.mode === "hotseat") {
        setBanner(`${g.sides[winner].name} wins!`, "you");
        audio.win();
        celebrate();
        await sleep(1400);
        if (!M || M.game !== g) return;
        showModal(`<div class="result-icon"><i class="fa-solid fa-trophy"></i></div><h2>${esc(g.sides[winner].name)} wins!</h2>
            ${resultStatsHtml(g, winner)}
            <div class="modal-actions"><button class="btn" data-act="menu" type="button">Menu</button><button class="btn" data-act="replay" type="button"><i class="fa-solid fa-film"></i> Replay</button><button class="btn primary" data-act="again" type="button"><i class="fa-solid fa-rotate"></i> Rematch</button></div>`,
        { menu: () => go("menu"), replay: () => startReplay(), again: () => startHotseat() });
        return;
    }
    setBanner(won ? "Victory!" : "Defeat", won ? "you" : "enemy");
    if (won) { audio.win(); celebrate(); } else audio.lose();
    say(pickLine(won ? "lose" : "win"));
    const elapsed = Date.now() - M.startedAt;
    const me = g.sides[M.viewer];
    recordStats(won, me.stats, elapsed);
    const extra = progress(won, g, elapsed);
    evaluateAchievements(won, g, elapsed);
    await sleep(1600);
    if (!M || M.game !== g) return;
    showResult(won, g, elapsed, extra);
}

function celebrate() {
    if (settings.reduced) return;
    const p = new Array(3).fill(0);
    p.forEach((_, i) => setTimeout(() => {
        const key = "enemy";
        for (let k = 0; k < 4; k++) {
            const x = Math.floor(Math.random() * 10);
            const y = Math.floor(Math.random() * 10);
            stage.fx.sparkle(stage.cellWorld(key, x, y, 1 + Math.random() * 2), stage.fx.colors.amber, 40);
        }
    }, i * 300));
}

function resultStatsHtml(g, s) {
    const st = g.sides[s].stats;
    const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
    return `<div class="result-stats"><div><b>${st.shots}</b><span>Shots</span></div><div><b>${acc}%</b><span>Accuracy</span></div><div><b>${g.aliveCount(s)}/5</b><span>Afloat</span></div></div>`;
}

function recordStats(won, st, elapsed) {
    if (M.replay || M.mode === "hotseat") return;
    stats.games++;
    stats.shots += st.shots;
    stats.hits += st.hits;
    if (won) {
        stats.wins++;
        stats.streak++;
        stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
        if (!stats.fastest || elapsed < stats.fastest) stats.fastest = elapsed;
    } else {
        stats.losses++;
        stats.streak = 0;
    }
    store.set("bsv2-stats", stats);
}

function campaignStars(won, g) {
    if (!won) return 0;
    const st = g.sides[M.viewer].stats;
    let n = 1;
    if (st.shots && st.hits / st.shots >= 0.45) n++;
    if (g.aliveCount(M.viewer) >= 3) n++;
    return n;
}

function progress(won, g, elapsed) {
    const out = {};
    if (M.mode === "campaign") {
        const m = CAMPAIGN[M.missionIdx];
        out.stars = campaignStars(won, g);
        campaignStore.stars[m.id] = Math.max(campaignStore.stars[m.id] || 0, out.stars);
        store.set("bsv2-campaign", campaignStore);
    } else if (M.mode === "gauntlet") {
        if (won) {
            if (gauntlet.round >= GAUNTLET_ROUNDS.length - 1) {
                gauntlet.best = GAUNTLET_ROUNDS.length;
                gauntlet.active = false;
                out.gauntletDone = true;
            } else {
                out.draft = true;
            }
        } else {
            gauntlet.best = Math.max(gauntlet.best, gauntlet.round);
            gauntlet.active = false;
            out.runOver = true;
        }
        store.set("bsv2-gauntlet", gauntlet);
    } else if (M.mode === "daily") {
        const k = dateKey();
        const shots = g.sides[M.viewer].stats.shots;
        const d = dailyStore[k] || { won: false, best: null, tries: 0 };
        d.tries++;
        if (won) {
            out.newBest = !d.best || shots < d.best;
            d.won = true;
            d.best = d.best ? Math.min(d.best, shots) : shots;
        }
        dailyStore[k] = d;
        store.set("bsv2-daily", dailyStore);
        out.daily = d;
    }
    return out;
}

function unlock(id) {
    if (achievements.has(id)) return;
    achievements.add(id);
    store.set("bsv2-ach", [...achievements]);
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    setTimeout(() => {
        audio.achieve();
        toast(`<i class="fa-solid ${a.icon}"></i> <b>${esc(a.title)}</b> — ${esc(a.desc)}`, "ach", 4200);
    }, 400);
}

function evaluateAchievements(won, g, elapsed) {
    if (M.replay || M.mode === "hotseat") return;
    const v = M.viewer;
    const st = g.sides[v].stats;
    const opp = g.sides[1 - v];
    if (st.torpedoSinks > 0) unlock("torpedo_sink");
    if (st.bestBarrage >= 3) unlock("barrage3");
    if (st.repairs >= 3) unlock("repair3");
    if (opp.stats.minesHit >= 2) unlock("minefield");
    if (!won) return;
    unlock("first_win");
    if (M.rules.difficulty === "hard" && opp.kind === "ai") unlock("hard_win");
    const alive = g.aliveCount(v);
    if (alive === SHIPS.length) unlock("flawless");
    if (alive === 1) unlock("comeback");
    if (st.shots >= 10 && st.hits / st.shots >= 0.7) unlock("deadeye");
    if (elapsed < 180000) unlock("blitz");
    if (st.moves >= 3) unlock("phantom");
    if (M.mode === "daily") unlock("daily_win");
    if (M.mode === "campaign" && M.missionIdx === CAMPAIGN.length - 1) unlock("campaign_clear");
    if (M.mode === "gauntlet" && gauntlet.best >= GAUNTLET_ROUNDS.length) unlock("gauntlet_clear");
    if (M.mode === "online") unlock("online_win");
    if (Object.values(campaignStore.stars).reduce((a, b) => a + b, 0) >= 24) unlock("stars24");
}

function showResult(won, g, elapsed, extra) {
    const v = M.viewer;
    const st = g.sides[v].stats;
    const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
    let headline = won ? "Victory!" : "Defeat";
    let sub = won ? `${g.sides[1 - v].name}'s fleet is at the bottom of the sea.` : `${g.sides[1 - v].name} took the seas.`;
    let extraHtml = "";
    const acts = { menu: () => go("menu"), replay: () => startReplay(), share: () => shareResult(won, g, elapsed) };
    let primary = '<button class="btn primary" data-act="again" type="button"><i class="fa-solid fa-rotate"></i> Play again</button>';

    if (M.mode === "campaign") {
        extraHtml = `<div class="result-stars">${starStr(extra.stars || 0)}</div><p class="muted">★ Win · ★ 45%+ accuracy · ★ 3+ ships afloat</p>`;
        const next = M.missionIdx + 1;
        if (won && next < CAMPAIGN.length) {
            primary = '<button class="btn primary" data-act="next" type="button"><i class="fa-solid fa-forward"></i> Next mission</button>';
            acts.next = () => { hideModal(); showBriefing(next); };
        } else if (won) {
            sub = "The Leviathan is defeated. You are a legend of the seas.";
            primary = '<button class="btn primary" data-act="camp" type="button"><i class="fa-solid fa-route"></i> Campaign</button>';
            acts.camp = () => go("campaign");
        } else {
            primary = '<button class="btn primary" data-act="again" type="button"><i class="fa-solid fa-rotate"></i> Retry</button>';
        }
        const idx = M.missionIdx;
        acts.again = () => { hideModal(); startCampaign(idx); };
    } else if (M.mode === "gauntlet") {
        if (extra.draft) {
            primary = '<button class="btn primary" data-act="draft" type="button"><i class="fa-solid fa-gift"></i> Draft upgrade</button>';
            acts.draft = () => showDraft();
        } else if (extra.gauntletDone) {
            sub = "You survived all five rounds. The arena is yours.";
            primary = '<button class="btn primary" data-act="menu" type="button"><i class="fa-solid fa-house"></i> Menu</button>';
        } else {
            sub = `Run over at round ${gauntlet.round + 1}. Best: ${gauntlet.best}.`;
            primary = '<button class="btn primary" data-act="gnt" type="button"><i class="fa-solid fa-skull"></i> New run</button>';
            acts.gnt = () => go("gauntlet");
        }
    } else if (M.mode === "daily") {
        const d = extra.daily;
        extraHtml = `<p class="muted">${won ? (extra.newBest ? "New daily best!" : `Today's best: ${d.best} shots`) : "The seas will be the same all day. Try again!"} · Attempts: ${d.tries}</p>`;
        acts.again = () => startDaily();
    } else if (M.mode === "online") {
        primary = '<button class="btn primary" data-act="rematch" type="button"><i class="fa-solid fa-rotate"></i> Rematch</button>';
        acts.rematch = () => requestRematch();
        acts.menu = () => { teardownMatch(); go("menu"); };
    } else {
        acts.again = () => startQuick();
    }
    const replayBtn = M.mode !== "online" ? '<button class="btn" data-act="replay" type="button"><i class="fa-solid fa-film"></i> Replay</button>' : "";
    showModal(`
        <div class="result-icon ${won ? "" : "lose"}"><i class="fa-solid ${won ? "fa-trophy" : "fa-skull-crossbones"}"></i></div>
        <h2>${headline}</h2>
        <p>${esc(sub)}</p>
        <div class="result-stats">
            <div><b>${st.shots}</b><span>Shots</span></div>
            <div><b>${acc}%</b><span>Accuracy</span></div>
            <div><b>${fmtTime(elapsed)}</b><span>Time</span></div>
            <div><b>${g.aliveCount(v)}/5</b><span>Afloat</span></div>
            <div><b>${st.abilities}</b><span>Abilities</span></div>
            <div><b>${stats.streak}</b><span>Streak</span></div>
        </div>
        ${extraHtml}
        <div class="modal-actions">
            <button class="btn" data-act="menu" type="button"><i class="fa-solid fa-house"></i> Menu</button>
            ${replayBtn}
            <button class="btn" data-act="share" type="button"><i class="fa-solid fa-share-nodes"></i> Share</button>
            ${primary}
        </div>`, acts);
}

function showDraft() {
    const owned = new Set(gauntlet.mods);
    const pool = shuffle(Math.random, UPGRADES.filter((u) => !owned.has(u.id))).slice(0, 3);
    const acts = {};
    const html = pool.map((u, i) => {
        acts[`u${i}`] = () => {
            gauntlet.mods.push(u.id);
            gauntlet.round++;
            store.set("bsv2-gauntlet", gauntlet);
            hideModal();
            startGauntletRound();
        };
        return `<button class="upgrade" data-act="u${i}" type="button"><i class="fa-solid ${u.icon}"></i><span><b>${esc(u.name)}</b><small>${esc(u.desc)}</small></span></button>`;
    }).join("");
    showModal(`<h2>Choose an upgrade</h2><p>Round ${gauntlet.round + 2} of 5 is next. Upgrades last for the whole run.</p><div class="upgrade-grid">${html}</div>`, acts);
}

async function shareResult(won, g, elapsed) {
    const me = g.sides[M.viewer];
    const st = me.stats;
    const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
    let grid = "";
    for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
            const i = idx(x, y);
            const s = me.intel.state[i];
            grid += me.intel.island[i] ? "🟫" : s === "hit" || s === "sunk" ? "🟥" : s === "miss" ? "⬜" : s === "mine" ? "💥" : s === "contact" ? "🟨" : "🟦";
        }
        grid += "\n";
    }
    const mode = M.mode === "daily" ? `Daily ${dateKey()}` : M.mode === "campaign" ? `Campaign M${M.missionIdx + 1}` : M.mode === "gauntlet" ? `Gauntlet R${gauntlet.round + 1}` : "Quick Battle";
    const text = `BATMAN Battleship v2 ⚓ ${mode}\n${won ? "🏆 Victory" : "☠️ Defeat"} · ${st.shots} shots · ${acc}% · ${fmtTime(elapsed)}\n${grid}`;
    const url = new URL("./", location.href).href;
    try {
        if (navigator.share) await navigator.share({ text, url });
        else {
            await navigator.clipboard.writeText(`${text}${url}`);
            toast('<i class="fa-solid fa-copy"></i> Result copied to clipboard');
        }
    } catch (e) { /* cancelled */ }
}

// ----- replay -----
function startReplay(source) {
    const src = source || { snapshot: M.game.snapshot, log: M.game.log.slice(), mode: M.mode, admiral: M.admiral, title: M.title };
    if (!src.snapshot || src.snapshot.sides.some((s) => !s.board)) return;
    teardownMatch({ keepNet: true });
    hideModal();
    const snap = src.snapshot;
    const actions = [[], []];
    src.log.forEach((e) => actions[e.side].push(e.action));
    const boards = snap.sides.map((s) => Board.from(s.board));
    const sides = snap.sides.map((s, i) => ({
        name: s.name, kind: "scripted", agent: new ScriptedAgent(actions[i]), board: boards[i],
        intel: new Intel(boards[1 - i].publicTerrain()), mods: new Set(s.mods)
    }));
    M = {
        mode: src.mode, replay: true, replaySource: src, replaySpeed: 1, admiral: src.admiral, rules: snap.rules, sides, viewer: 0,
        revealEnemy: true, phase: "battle", busy: true, flags: {}, startedAt: Date.now()
    };
    $("#hud").classList.remove("hidden");
    SCREENS.forEach((s) => $(`#${s}`).classList.add("hidden"));
    $("#placement-bar").classList.add("hidden");
    $("#action-bar").classList.add("hidden");
    $("#replay-bar").classList.remove("hidden");
    $("#replay-speed span").textContent = "2×";
    $("#hud-mode").textContent = "Replay";
    $("#hud-sub").textContent = src.title || "";
    $("#log-list").innerHTML = "";
    stage.speed = 1;
    stage.resetAll();
    const game = new Game({ rules: snap.rules, sides, presenter, first: snap.first });
    M.game = game;
    M.sides = game.sides;
    syncFull();
    requestAnimationFrame(updateInsets);
    game.run().catch((e) => console.error(e));
}

// ----- online -----
function onlineStatus(html) {
    const el = $("#online-status");
    el.classList.remove("hidden");
    el.innerHTML = html;
}

function currentOnlinePreset() {
    const b = $("#online-preset button.active");
    return { ...PRESETS[b?.dataset.preset || "tactical"], difficulty: "normal" };
}

function bindNet(net) {
    net.on("message", onNetMessage);
    net.on("closed", () => {
        if (!online || online.net !== net) return;
        toast('<i class="fa-solid fa-plug-circle-xmark"></i> Opponent disconnected', "bad", 4000);
        if (M && M.mode === "online" && M.phase !== "over") {
            M.game?.abort();
            showModal('<h2>Connection lost</h2><p>Your opponent left the duel.</p><div class="modal-actions"><button class="btn primary" data-act="menu" type="button">Menu</button></div>',
                { menu: () => { teardownMatch(); go("menu"); } });
        }
        online = null;
    });
    net.on("error", (e) => {
        console.warn(e);
        if (!M || M.mode !== "online") onlineStatus(`<p><i class="fa-solid fa-triangle-exclamation"></i> ${esc(e?.message || "Connection error")}</p>`);
    });
}

async function hostOnline() {
    audio.click();
    settings.callsign = ($("#callsign").value || "").trim().slice(0, 16);
    saveSettings();
    if (online) { online.net.close(); online = null; }
    const net = new Net();
    online = { net, isHost: true, oppName: "Opponent", meReady: false, themReady: false, rules: currentOnlinePreset() };
    bindNet(net);
    onlineStatus('<p><i class="fa-solid fa-spinner fa-spin"></i> Opening a room…</p>');
    try {
        const code = await net.host();
        const link = `${new URL("./", location.href).href}?join=${code}`;
        onlineStatus(`<p>Share this code with your friend:</p><div class="room-code">${code}</div>
            <div class="modal-actions"><button class="btn" type="button" id="copy-link"><i class="fa-solid fa-link"></i> Copy invite link</button></div>
            <p class="muted"><i class="fa-solid fa-spinner fa-spin"></i> Waiting for a challenger…</p>`);
        $("#copy-link").onclick = async () => {
            try { await navigator.clipboard.writeText(link); toast("Invite link copied"); } catch (e) { toast(esc(link)); }
        };
    } catch (e) {
        onlineStatus(`<p><i class="fa-solid fa-triangle-exclamation"></i> ${esc(e?.message || "Could not open a room.")}</p>`);
        online = null;
    }
}

async function joinOnline(code) {
    audio.click();
    code = (code || "").toUpperCase().trim();
    if (code.length < 4) { onlineStatus("<p>Enter the 5-character room code.</p>"); return; }
    settings.callsign = ($("#callsign").value || "").trim().slice(0, 16);
    saveSettings();
    if (online) { online.net.close(); online = null; }
    const net = new Net();
    online = { net, isHost: false, oppName: "Host", meReady: false, themReady: false };
    bindNet(net);
    onlineStatus('<p><i class="fa-solid fa-spinner fa-spin"></i> Joining room…</p>');
    try {
        await net.join(code);
        net.send({ t: "hello", name: settings.callsign || "Captain", v: 2 });
        onlineStatus('<p><i class="fa-solid fa-spinner fa-spin"></i> Connected. Waiting for the host…</p>');
    } catch (e) {
        onlineStatus(`<p><i class="fa-solid fa-triangle-exclamation"></i> ${esc(e?.message || "Could not join.")}</p>`);
        online = null;
    }
}

function hostSendSetup() {
    const seed = randomSeed();
    const rules = online.rules || currentOnlinePreset();
    online.net.send({ t: "setup", rules, seed, name: settings.callsign || "Captain" });
    startOnlineMatch(rules, seed);
}

function startOnlineMatch(rules, seed) {
    online.meReady = false;
    online.themReady = false;
    online.net.resetTurnState();
    const s0 = (seed ^ 0xa5a5a5a5) >>> 0;
    const s1 = (seed ^ 0x5a5a5a5a) >>> 0;
    setupMatch({
        mode: "online", opponent: "remote", rules, seed, title: "Online Duel", sub: `vs ${online.oppName}`,
        names: [settings.callsign || "You", online.oppName],
        terrainSeeds: online.isHost ? [s0, s1] : [s1, s0], first: online.isHost ? 0 : 1, admiral: "quick"
    });
    M.admiral = { ...ADMIRALS.quick, name: online.oppName, icon: "fa-user-astronaut", color: "#7fe3d2" };
}

function onNetMessage(msg) {
    if (!online) return;
    switch (msg.t) {
        case "hello":
            if (online.isHost) {
                online.oppName = String(msg.name || "Challenger").slice(0, 16);
                toast(`<i class="fa-solid fa-user"></i> ${esc(online.oppName)} joined!`);
                hostSendSetup();
            }
            break;
        case "setup":
            if (!online.isHost) {
                online.oppName = String(msg.name || "Host").slice(0, 16);
                startOnlineMatch(msg.rules, msg.seed);
            }
            break;
        case "ready":
            online.themReady = true;
            if (M?.mode === "online" && M.phase === "placement" && online.meReady) beginBattle();
            else if (M?.mode === "online" && M.phase === "placement") toast(`${esc(online.oppName)} is ready!`);
            break;
        case "emote": {
            const e = EMOTES[msg.i];
            if (e) say(e.text, { name: online.oppName, icon: "fa-user-astronaut", color: "#7fe3d2" });
            break;
        }
        case "rematch":
            if (online.isHost) {
                if (online.wantRematch) hostSendSetup();
                else toast(`${esc(online.oppName)} wants a rematch!`);
                online.theyWantRematch = true;
            } else {
                toast(`${esc(online.oppName)} wants a rematch!`);
            }
            break;
        default: break;
    }
}

function requestRematch() {
    if (!online) { go("menu"); return; }
    hideModal();
    online.wantRematch = true;
    online.net.send({ t: "rematch" });
    if (online.isHost && online.theyWantRematch) {
        online.wantRematch = false;
        online.theyWantRematch = false;
        hostSendSetup();
    } else {
        setBanner("Waiting for rematch…", "");
    }
}

const EMOTES = [
    { label: "👍", text: "Nice shot!" },
    { label: "😅", text: "Lucky..." },
    { label: "🔥", text: "Here it comes!" },
    { label: "🫡", text: "Good game, captain." }
];

// =====================================================================
// Targeting & input
// =====================================================================
function humanTurn() {
    return M && !M.attract && !M.replay && M.phase === "battle" && M.game && M.game.current === M.viewer
        && M.game.sides[M.viewer].kind === "human" && M.game.sides[M.viewer].agent.waiting && !M.busy;
}

function renderActionBar() {
    if (!M?.game) return;
    const g = M.game;
    const v = M.viewer;
    const side = g.sides[v];
    const my = humanTurn();
    const abl = $("#abilities");
    abl.innerHTML = "";
    if (M.rules.abilities) {
        ABILITY_ORDER.forEach((id) => {
            const a = ABILITIES[id];
            const cd = side.cooldowns[id];
            const alive = g.shipAlive(v, a.ship);
            const usable = my && g.canUse(v, id);
            const b = h("button", {
                type: "button", class: `tool-btn ${M.targeting?.mode === id ? "active" : ""}`, disabled: !usable,
                title: `${a.name} (${a.key}) — ${a.desc}${!alive ? " [ship sunk]" : cd > 0 ? ` [${cd} turns]` : ""}`,
                onclick: () => { audio.click(); setTargeting(M.targeting?.mode === id ? "fire" : id); }
            }, `<i class="fa-solid ${alive ? a.icon : "fa-ban"}"></i><span>${a.name}</span><em class="cd">${alive && cd > 0 ? cd : ""}</em><span class="key">${a.key}</span>`);
            abl.appendChild(b);
        });
    }
    const mv = $("#act-move");
    mv.classList.toggle("hidden", !M.rules.maneuver);
    mv.disabled = !(my && g.canManeuver(v));
    mv.classList.toggle("active", M.targeting?.mode === "move");
    $("#move-cd").textContent = side.moveCd > 0 ? side.moveCd : "";
    const fire = $("#act-fire");
    fire.disabled = !my;
    const n = g.shotsFor(v);
    const pend = M.targeting?.pending?.length || 0;
    fire.classList.toggle("active", M.targeting?.mode === "fire");
    $("#fire-label").textContent = n > 1 ? `Fire ${pend}/${n}` : M.targeting?.armed ? "Confirm" : "Fire";
    $("#act-coach").setAttribute("aria-pressed", String(!!M.coach));
    const em = $("#emotes");
    if (M.mode === "online" && !em.childElementCount) {
        EMOTES.forEach((e, i) => em.appendChild(h("button", {
            type: "button", class: "emote-btn", title: e.text,
            onclick: () => { online?.net.send({ t: "emote", i }); say(e.text, { name: "You", icon: "fa-user", color: "var(--accent)" }); }
        }, e.label)));
    }
}

function setTargeting(mode) {
    if (!M) return;
    M.targeting = { mode, axis: M.targeting?.axis || "row", pending: [], hover: M.targeting?.hover || null, armed: null, moveShip: null };
    const g = M.game;
    const hints = {
        fire: g && g.shotsFor(M.viewer) > 1 ? `Salvo: pick ${g.shotsFor(M.viewer)} targets, then Fire.` : settings.confirmShots ? "Tap a cell to aim, tap again to fire." : "Click enemy waters to fire.",
        recon: "Air Recon: pick a row or column (R to rotate).",
        barrage: "Barrage: pick the center of the + pattern.",
        repair: "Repair: pick a damaged (burning) section of your fleet.",
        sonar: "Sonar: pick the center of the area to scan.",
        torpedo: "Torpedo: pick a lane (R to rotate). It launches from the left/top edge.",
        move: "Maneuver: pick one of your undamaged ships, then the direction to move it."
    };
    setHint(hints[mode] || "");
    if (mode === "repair" || mode === "move") stage.focus("home");
    else if (M.phase === "battle") stage.focus("enemy");
    renderActionBar();
    refreshTargetVisuals();
}

function clearTargetVisuals() {
    ["home", "enemy"].forEach((k) => stage.clearHighlights(k));
    stage.clearGhost();
}

function abilityCells(mode, x, y, axis) {
    const cells = [];
    if (mode === "barrage") [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => cells.push({ x: x + dx, y: y + dy }));
    else if (mode === "sonar") {
        const r = M.game.sides[M.viewer].mods.has("wideSonar") ? 2 : 1;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) cells.push({ x: x + dx, y: y + dy });
    } else if (mode === "recon" || mode === "torpedo") {
        for (let t = 0; t < GRID; t++) cells.push(axis === "row" ? { x: t, y } : { x, y: t });
    } else cells.push({ x, y });
    return cells.filter((c) => inBounds(c.x, c.y));
}

const COLORS = { fire: 0xffffff, bad: 0xff4d3d, barrage: 0xffb347, sonar: 0x3fbfff, recon: 0xffd36a, torpedo: 0xff7a5c, repair: 0x7dffb2, move: 0x7fe3d2, pending: 0xff5a3c };

function refreshTargetVisuals() {
    if (!M?.targeting || !stage) return;
    clearTargetVisuals();
    const t = M.targeting;
    const me = M.game?.sides[M.viewer];
    if (!me || !humanTurn()) return;
    // coach heat map
    if (M.coach && t.mode !== "repair" && t.mode !== "move") {
        const heat = heatMap(me.intel);
        let max = 0;
        heat.forEach((v) => { max = Math.max(max, v); });
        if (max > 0) {
            const cells = [];
            for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
                const v = heat[idx(x, y)] / max;
                if (v <= 0.02 || !me.intel.shootable(x, y)) continue;
                const c = v > 0.66 ? 0xff3b2f : v > 0.33 ? 0xffb347 : 0x2f7dd0;
                cells.push({ x, y, color: c });
            }
            stage.setHighlights("enemy", "heat", cells);
        }
    }
    if (t.pending.length) stage.setHighlights("enemy", "pending", t.pending.map((c) => ({ ...c, color: COLORS.pending })));
    const at = t.armed || t.hover;
    if (!at) return;
    if (t.mode === "repair") {
        if (at.key !== "home") return;
        const dmg = me.board.hit[idx(at.x, at.y)] && me.board.shipIndexAt(at.x, at.y) !== -1 && !me.board.ships[me.board.shipIndexAt(at.x, at.y)].sunk;
        stage.setHighlights("home", "hover", [{ x: at.x, y: at.y, color: dmg ? COLORS.repair : COLORS.bad }]);
        stage.setHighlights("home", "preview", me.board.damagedCells().map((c) => ({ ...c, color: COLORS.repair })));
        return;
    }
    if (t.mode === "move") {
        if (at.key !== "home") return;
        const b = me.board;
        if (t.moveShip === null || t.moveShip === undefined) {
            const k = b.shipIndexAt(at.x, at.y);
            const ok = k !== -1 && b.isUndamaged(k) && (b.moveTargets(k, 1, M.rules.noTouch) || b.moveTargets(k, -1, M.rules.noTouch));
            const cells = k !== -1 ? b.ships[k].cells : [at];
            stage.setHighlights("home", "hover", cells.map((c) => ({ ...c, color: ok ? COLORS.move : COLORS.bad })));
        } else {
            const ship = b.ships[t.moveShip];
            const dir = moveDir(ship, at);
            stage.setHighlights("home", "preview", ship.cells.map((c) => ({ ...c, color: 0x7fe3d2 })));
            if (dir) {
                const to = b.moveTargets(t.moveShip, dir, M.rules.noTouch);
                const cells = to || ship.cells.map((c) => (ship.horizontal ? { x: c.x + dir, y: c.y } : { x: c.x, y: c.y + dir }));
                stage.setHighlights("home", "hover", cells.map((c) => ({ ...c, color: to ? COLORS.move : COLORS.bad })));
            }
        }
        return;
    }
    if (at.key !== "enemy") return;
    if (t.mode === "fire") {
        const ok = me.intel.shootable(at.x, at.y);
        stage.setHighlights("enemy", "hover", [{ x: at.x, y: at.y, color: ok ? (t.armed ? 0xffc457 : COLORS.fire) : COLORS.bad }]);
        return;
    }
    const cells = abilityCells(t.mode, at.x, at.y, t.axis);
    stage.setHighlights("enemy", "preview", cells.map((c) => ({ ...c, color: COLORS[t.mode] })));
    stage.setHighlights("enemy", "hover", [{ x: at.x, y: at.y, color: t.armed ? 0xffc457 : COLORS[t.mode] }]);
}

function moveDir(ship, at) {
    const a = ship.cells[0];
    const z = ship.cells[ship.cells.length - 1];
    if (ship.horizontal) {
        if (at.y !== a.y) return 0;
        return at.x < a.x ? -1 : at.x > z.x ? 1 : 0;
    }
    if (at.x !== a.x) return 0;
    return at.y < a.y ? -1 : at.y > z.y ? 1 : 0;
}

function submit(action) {
    const side = M.game.sides[M.viewer];
    if (!side.agent.waiting) return;
    M.busy = true;
    document.body.classList.add("busy");
    M.targeting = { mode: "fire", axis: M.targeting?.axis || "row", pending: [], hover: null, armed: null };
    clearTargetVisuals();
    setHint("");
    renderActionBar();
    side.agent.submit(action);
}

function needsConfirm(x, y, key) {
    if (!settings.confirmShots) return false;
    const t = M.targeting;
    if (t.armed && t.armed.x === x && t.armed.y === y && t.armed.key === key) { t.armed = null; return false; }
    t.armed = { x, y, key };
    setHint("Tap again (or press Confirm) to commit.");
    renderActionBar();
    refreshTargetVisuals();
    return true;
}

function battleClick(p) {
    if (!humanTurn() || !p || p.outside) return;
    const t = M.targeting;
    const me = M.game.sides[M.viewer];
    const g = M.game;
    const { key, x, y } = p;
    if (t.mode === "fire") {
        if (key !== "enemy") return;
        if (!me.intel.shootable(x, y)) { audio.invalid(); return; }
        const n = g.shotsFor(M.viewer);
        if (n > 1) {
            const i = t.pending.findIndex((c) => c.x === x && c.y === y);
            if (i >= 0) t.pending.splice(i, 1);
            else if (t.pending.length < n) t.pending.push({ x, y });
            audio.click();
            renderActionBar();
            refreshTargetVisuals();
            if (t.pending.length === n) setHint(`All ${n} targets set — press Fire (F).`);
            return;
        }
        if (needsConfirm(x, y, key)) return;
        submit({ type: "fire", kind: "shot", cells: [{ x, y }] });
        return;
    }
    if (t.mode === "repair") {
        if (key !== "home") return;
        const k = me.board.shipIndexAt(x, y);
        if (k === -1 || !me.board.hit[idx(x, y)] || me.board.ships[k].sunk) { audio.invalid(); return; }
        submit({ type: "repair", ability: "repair", x, y });
        return;
    }
    if (t.mode === "move") {
        if (key !== "home") return;
        const b = me.board;
        if (t.moveShip === null || t.moveShip === undefined) {
            const k = b.shipIndexAt(x, y);
            if (k === -1 || !b.isUndamaged(k) || !(b.moveTargets(k, 1, M.rules.noTouch) || b.moveTargets(k, -1, M.rules.noTouch))) {
                audio.invalid();
                setHint("Pick an undamaged ship that has room to move.");
                return;
            }
            t.moveShip = k;
            audio.click();
            setHint("Now tap a cell just past either end of the ship to slide it that way.");
            refreshTargetVisuals();
            return;
        }
        const ship = b.ships[t.moveShip];
        const dir = moveDir(ship, { x, y });
        if (!dir || !b.moveTargets(t.moveShip, dir, M.rules.noTouch)) {
            const k = b.shipIndexAt(x, y);
            if (k !== -1 && k !== t.moveShip) { t.moveShip = null; battleClick(p); return; }
            audio.invalid();
            return;
        }
        submit({ type: "move", ship: t.moveShip, dir });
        return;
    }
    if (key !== "enemy") return;
    if (t.mode === "barrage") {
        const cells = abilityCells("barrage", x, y);
        if (!cells.some((c) => me.intel.shootable(c.x, c.y))) { audio.invalid(); return; }
        if (needsConfirm(x, y, key)) return;
        submit({ type: "fire", kind: "barrage", ability: "barrage", cells });
    } else if (t.mode === "sonar") {
        if (needsConfirm(x, y, key)) return;
        submit({ type: "sonar", ability: "sonar", x, y });
    } else if (t.mode === "recon") {
        if (needsConfirm(x, y, key)) return;
        submit({ type: "recon", ability: "recon", axis: t.axis, index: t.axis === "row" ? y : x });
    } else if (t.mode === "torpedo") {
        if (needsConfirm(x, y, key)) return;
        submit({ type: "torpedo", ability: "torpedo", axis: t.axis, index: t.axis === "row" ? y : x });
    }
}

function fireButton() {
    if (!humanTurn()) return;
    const t = M.targeting;
    if (t.mode !== "fire") { setTargeting("fire"); return; }
    const n = M.game.shotsFor(M.viewer);
    if (n > 1) {
        if (!t.pending.length) { setHint(`Pick up to ${n} targets first.`); audio.invalid(); return; }
        submit({ type: "fire", kind: "salvo", cells: t.pending.slice() });
        return;
    }
    if (t.armed) { const a = t.armed; t.armed = null; battleClick(a); return; }
    if (kb.active && kb.key === "enemy") { battleClick({ key: "enemy", x: kb.x, y: kb.y }); return; }
    setHint("Pick a target in enemy waters.");
}

function rotateTargeting() {
    if (M?.phase === "placement") { rotatePlacement(); return; }
    if (!M?.targeting) return;
    if (M.targeting.mode === "recon" || M.targeting.mode === "torpedo") {
        M.targeting.axis = M.targeting.axis === "row" ? "col" : "row";
        audio.rotate();
        refreshTargetVisuals();
    }
}

// ----- pointer + keyboard -----
const kb = { active: false, key: "enemy", x: 4, y: 4 };
let pointer = { down: false, id: null, sx: 0, sy: 0, moved: false, type: "mouse" };

function handleHover(p) {
    if (!M || M.attract) return;
    if (M.phase === "placement") {
        M.placement.hover = p && !p.outside && p.key === "home" ? { x: p.x, y: p.y } : null;
        previewPlacement();
        return;
    }
    if (M.phase === "battle" && M.targeting) {
        const prev = M.targeting.hover;
        M.targeting.hover = p && !p.outside ? p : null;
        if (prev?.x !== M.targeting.hover?.x || prev?.y !== M.targeting.hover?.y || prev?.key !== M.targeting.hover?.key) {
            if (M.targeting.hover && humanTurn()) audio.hover();
            refreshTargetVisuals();
        }
    }
}

function handleClick(p) {
    if (!M || M.attract || modalOpen()) return;
    if (M.phase === "placement") {
        if (p && !p.outside && p.key === "home") placeAt(p.x, p.y);
        return;
    }
    if (M.phase === "battle") battleClick(p);
}

function bindInput() {
    const c = $("#stage");
    c.addEventListener("pointerdown", (e) => {
        pointer = { down: true, id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, type: e.pointerType };
        kb.active = false;
        if (e.button === 2) return;
        handleHover(stage.pick(e.clientX, e.clientY));
    });
    c.addEventListener("pointermove", (e) => {
        if (pointer.down && Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 8) pointer.moved = true;
        if (e.pointerType === "mouse" || pointer.down) handleHover(stage.pick(e.clientX, e.clientY));
    });
    c.addEventListener("pointerup", (e) => {
        if (!pointer.down) return;
        pointer.down = false;
        if (e.button === 2) return;
        const p = stage.pick(e.clientX, e.clientY);
        // touch: drag-to-aim then release to drop works for placement; battle taps need little movement
        if (M?.phase === "placement" || !pointer.moved) handleClick(p);
        if (e.pointerType !== "mouse" && M?.phase === "placement") { M.placement.hover = null; previewPlacement(); }
    });
    c.addEventListener("pointerleave", () => { if (pointer.type === "mouse") handleHover(null); });
    c.addEventListener("contextmenu", (e) => { e.preventDefault(); rotateTargeting(); });
    c.addEventListener("wheel", (e) => {
        if (M?.phase === "placement" || M?.targeting?.mode === "recon" || M?.targeting?.mode === "torpedo") { e.preventDefault(); rotateTargeting(); }
    }, { passive: false });

    window.addEventListener("keydown", (e) => {
        if (e.target.matches?.("input, textarea")) return;
        if (!$("#curtain").classList.contains("hidden")) return;
        if (modalOpen()) { if (e.key === "Escape" && M && M.phase !== "over") hideModal(); return; }
        if (!M || M.attract || $("#hud").classList.contains("hidden")) return;
        const k = e.key;
        if (k === "Escape") {
            if (M.targeting && M.targeting.mode !== "fire") { setTargeting("fire"); return; }
            confirmLeave();
            return;
        }
        if (k === "r" || k === "R") { rotateTargeting(); return; }
        if (k === "v" || k === "V") { cycleCamera(); return; }
        if (k === "l" || k === "L") { toggleLog(); return; }
        if (M.phase === "battle" && humanTurn()) {
            const ab = ABILITY_ORDER.find((id) => ABILITIES[id].key === k);
            if (ab && M.game.canUse(M.viewer, ab)) { setTargeting(M.targeting?.mode === ab ? "fire" : ab); return; }
            if ((k === "m" || k === "M") && M.game.canManeuver(M.viewer)) { setTargeting("move"); return; }
            if (k === "f" || k === "F") { fireButton(); return; }
            if (k === "c" || k === "C") { toggleCoach(); return; }
        }
        if (k.startsWith("Arrow") || k === "Enter" || k === " ") {
            e.preventDefault();
            const board = M.phase === "placement" || M.targeting?.mode === "repair" || M.targeting?.mode === "move" ? "home" : "enemy";
            let fresh = false;
            if (!kb.active || kb.key !== board) { kb.active = true; kb.key = board; fresh = true; }
            else {
                if (k === "ArrowLeft") kb.x = Math.max(0, kb.x - 1);
                if (k === "ArrowRight") kb.x = Math.min(GRID - 1, kb.x + 1);
                if (k === "ArrowUp") kb.y = Math.max(0, kb.y - 1);
                if (k === "ArrowDown") kb.y = Math.min(GRID - 1, kb.y + 1);
            }
            const p = { key: kb.key, x: kb.x, y: kb.y };
            handleHover(p);
            if ((k === "Enter" || k === " ") && !fresh) handleClick(p);
        }
    });
}

function cycleCamera() {
    const order = ["auto", "both", "focus"];
    settings.camera = order[(order.indexOf(settings.camera) + 1) % order.length];
    saveSettings();
    stage.setCameraMode(settings.camera);
    toast(`<i class="fa-solid fa-video"></i> Camera: ${settings.camera === "auto" ? "Auto" : settings.camera === "both" ? "Both boards" : "Focus"}`, "", 1400);
}

function toggleLog() {
    $("#log-panel").classList.toggle("hidden");
}

function toggleCoach() {
    M.coach = !M.coach;
    M.flags.coach = true;
    audio.click();
    renderActionBar();
    refreshTargetVisuals();
    if (M.coach) toast('<i class="fa-solid fa-brain"></i> Coach: red = most likely ship positions', "", 2400);
}

function confirmLeave() {
    if (!M || M.attract) { go("menu"); return; }
    if (M.phase === "over" || M.replay) { teardownMatch(); go("menu"); return; }
    showModal(`<h2>Leave the battle?</h2><p>${M.mode === "online" ? "This ends the duel for both players." : "Progress in this battle will be lost."}</p>
        <div class="modal-actions"><button class="btn" data-act="stay" type="button">Stay</button><button class="btn danger" data-act="leave" type="button">Leave</button></div>`,
    { stay: hideModal, leave: () => { teardownMatch(); go("menu"); } });
}

function resumeHud() {
    SCREENS.forEach((s) => $(`#${s}`).classList.add("hidden"));
    $("#hud").classList.remove("hidden");
    requestAnimationFrame(updateInsets);
}

function bindHud() {
    $("#hud-home").addEventListener("click", () => { audio.click(); confirmLeave(); });
    $("#hud-view").addEventListener("click", () => { audio.click(); cycleCamera(); });
    $("#hud-log").addEventListener("click", () => { audio.click(); toggleLog(); });
    $("#hud-settings").addEventListener("click", () => {
        audio.click();
        $("#hud").classList.add("hidden");
        SCREENS.forEach((s) => $(`#${s}`).classList.toggle("hidden", s !== "settings"));
        buildSettings();
        stage.setInsets(0, 0);
    });
    const snd = $("#hud-sound");
    const paintSound = () => {
        snd.innerHTML = `<i class="fa-solid ${settings.sound ? "fa-volume-high" : "fa-volume-xmark"}"></i>`;
        snd.setAttribute("aria-pressed", String(settings.sound));
    };
    paintSound();
    snd.addEventListener("click", () => { settings.sound = !settings.sound; saveSettings(); audio.applyVolumes(); paintSound(); });
    $("#pl-rotate").addEventListener("click", () => rotatePlacement());
    $("#pl-auto").addEventListener("click", () => {
        const b = M.sides[M.placement.side].board;
        b.autoPlace(Math.random, { noTouch: M.rules.noTouch });
        M.placement.current = null;
        audio.place();
        afterPlacementChange();
        setHint("Fleet deployed! Tap a ship to move it, or press <b>Ready</b>.");
    });
    $("#pl-undo").addEventListener("click", () => {
        const b = M.sides[M.placement.side].board;
        const s = b.removeLast();
        if (s) { M.placement.current = s.id; M.placement.horizontal = s.horizontal; }
        audio.click();
        afterPlacementChange();
    });
    $("#pl-clear").addEventListener("click", () => {
        const b = M.sides[M.placement.side].board;
        b.clearShips();
        M.placement.current = firstUnplaced(b);
        audio.click();
        afterPlacementChange();
    });
    $("#pl-ready").addEventListener("click", () => { audio.click(); finishPlacement(); });
    $("#act-fire").addEventListener("click", () => { audio.click(); fireButton(); });
    $("#act-move").addEventListener("click", () => { audio.click(); setTargeting(M.targeting?.mode === "move" ? "fire" : "move"); });
    $("#act-coach").addEventListener("click", () => toggleCoach());
    $("#replay-exit").addEventListener("click", () => { audio.click(); teardownMatch(); go("menu"); });
    $("#replay-speed").addEventListener("click", () => {
        if (!M?.replay) return;
        M.replaySpeed = M.replaySpeed === 1 ? 2 : M.replaySpeed === 2 ? 4 : 1;
        stage.speed = M.replaySpeed;
        $("#replay-speed span").textContent = `${M.replaySpeed === 4 ? 1 : M.replaySpeed * 2}×`;
        toast(`Replay speed ${M.replaySpeed}×`, "", 1000);
    });
    const ro = new ResizeObserver(() => updateInsets());
    ro.observe($("#hud-top"));
    ro.observe($("#hud-bottom"));
    window.addEventListener("resize", () => requestAnimationFrame(updateInsets));
}

boot();
