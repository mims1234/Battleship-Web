const GRID_SIZE = 10;
const SHIP_ASSET_BASE = (() => {
    const script = document.querySelector('script[src*="gameJS.js"]');
    if (script?.src) return script.src.replace(/scripts\/gameJS\.js.*$/, "assets/ships/");
    return "public/assets/ships/";
})();

const SHIPS = [
    { name: "Carrier", size: 5, asset: "carrier.svg" },
    { name: "Battleship", size: 4, asset: "battleship.svg" },
    { name: "Cruiser", size: 3, asset: "cruiser.svg" },
    { name: "Submarine", size: 3, asset: "submarine.svg" },
    { name: "Destroyer", size: 2, asset: "destroyer.svg" }
];

const ACHIEVEMENTS = [
    { id: "first_win", title: "First Blood", desc: "Win a match" },
    { id: "hard_win", title: "Iron Captain", desc: "Win on Hard" },
    { id: "salvo_win", title: "Volley Master", desc: "Win a Salvo match" },
    { id: "perfect_acc", title: "Deadeye", desc: "Win with 70%+ accuracy (8+ shots)" },
    { id: "streak3", title: "On Fire", desc: "Reach a 3-win streak" },
    { id: "radar_win", title: "Sonar Ace", desc: "Win after using Radar" },
    { id: "daily_win", title: "Daily Orders", desc: "Win today's challenge" },
    { id: "untouchable", title: "Ghost Fleet", desc: "Win with no-touch placement" }
];

function shipAssetUrl(filename) {
    return `${SHIP_ASSET_BASE}${filename}`;
}

let playerGrid = [];
let aiGrid = [];
let playerShips = [];
let aiShips = [];
let currentShipIndex = 0;
let isPlacingShips = true;
let isPlayerTurn = true;
let gameOver = false;
let isHorizontal = true;
let aiLastHit = null;
let aiHuntMode = false;
let aiHuntQueue = [];
let playerSunkShips = 0;
let aiSunkShips = 0;
let playerScore = 0;
let aiScore = 0;

let difficulty = "easy";
let salvoMode = false;
let soundOn = true;
let noTouchMode = false;
let dailyMode = false;
let playerShotsFired = 0;
let playerHitsLanded = 0;
let gameStartTime = 0;
let battleActive = false;
let turnBusy = false;
let salvoTargets = [];
let gridAbort = null;
let modalPreviousFocus = null;
let radarCharges = 1;
let radarUsed = false;
let radarAiming = false;
let usedNoTouchThisGame = false;
let seededRandom = null;
let dockDraggables = [];
let lastResultSummary = null;

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ===== Anime.js v4 motion adapter (safe fallbacks) ===== */
const Mot = (() => {
    function api() {
        return typeof anime !== "undefined" && typeof anime.animate === "function" ? anime : null;
    }

    function mapEase(easing) {
        if (!easing) return "outCubic";
        const s = String(easing);
        if (s.startsWith("ease")) {
            const rest = s.slice(4);
            return rest.charAt(0).toLowerCase() + rest.slice(1);
        }
        return s;
    }

    function can() {
        return !!api() && !prefersReducedMotion;
    }

    function to(targets, params = {}) {
        const a = api();
        if (!a || prefersReducedMotion || !targets) return null;
        const { easing, ...rest } = params;
        const payload = { ...rest };
        if (easing) payload.ease = mapEase(easing);
        else if (!payload.ease) payload.ease = "outCubic";
        try {
            return a.animate(targets, payload);
        } catch (err) {
            return null;
        }
    }

    function stagger(value, opts) {
        const a = api();
        if (!a || typeof a.stagger !== "function") return 0;
        try {
            return opts ? a.stagger(value, opts) : a.stagger(value);
        } catch (err) {
            return 0;
        }
    }

    function remove(targets) {
        const a = api();
        if (!a || typeof a.remove !== "function") return;
        try { a.remove(targets); } catch (err) { /* ignore */ }
    }

    function timeline(params) {
        const a = api();
        if (!a || typeof a.createTimeline !== "function" || prefersReducedMotion) return null;
        try { return a.createTimeline(params || {}); } catch (err) { return null; }
    }

    function scramble(el, text, duration = 650) {
        if (!el) return;
        const finalText = String(text);
        const a = api();
        if (!a || prefersReducedMotion || typeof a.scrambleText !== "function") {
            el.textContent = finalText;
            return;
        }
        try {
            a.animate(el, {
                textContent: a.scrambleText({ text: finalText, chars: "uppercase" }),
                duration
            });
        } catch (err1) {
            try {
                a.animate(el, {
                    scrambleText: { text: finalText, chars: "uppercase" },
                    duration
                });
            } catch (err2) {
                el.textContent = finalText;
                to(el, { opacity: [0.35, 1], scale: [0.96, 1], duration: 360, easing: "easeOutBack" });
            }
        }
    }

    function createDraggable(target, params) {
        const a = api();
        if (!a || typeof a.createDraggable !== "function") return null;
        try { return a.createDraggable(target, params); } catch (err) { return null; }
    }

    return { api, can, to, stagger, remove, timeline, scramble, createDraggable };
})();

function canAnimate() {
    return Mot.can();
}

function runIntroAnimations() {
    if (!canAnimate()) {
        document.querySelectorAll(".anim-enter").forEach((el) => {
            el.style.opacity = "1";
            el.style.transform = "none";
        });
        return;
    }

    Mot.to(".anim-enter", {
        opacity: [0, 1],
        translateY: [24, 0],
        duration: 720,
        delay: Mot.stagger(90, { start: 80 }),
        easing: "easeOutCubic"
    });

    Mot.to(".brand-title", {
        letterSpacing: ["0.28em", "0.12em"],
        duration: 1100,
        easing: "easeOutExpo"
    });
}

function animateStatus() {
    const el = document.getElementById("status");
    if (!el || !canAnimate()) return;
    Mot.remove(el);
    Mot.to(el, {
        scale: [0.96, 1],
        opacity: [0.35, 1],
        duration: 380,
        easing: "easeOutBack"
    });
}

function animateScoreBump(id) {
    const el = document.getElementById(id);
    if (!el || !canAnimate()) return;
    Mot.to(el, {
        scale: [1, 1.35, 1],
        duration: 480,
        easing: "easeOutElastic(1, .6)"
    });
}

function animateCellImpact(cell, kind) {
    if (!cell || !canAnimate()) return;
    if (kind === "hit") {
        Mot.to(cell, { scale: [1, 1.35, 1], duration: 420, easing: "easeOutExpo" });
    } else if (kind === "miss") {
        Mot.to(cell, { opacity: [0.4, 1], scale: [0.85, 1], duration: 320, easing: "easeOutQuad" });
    } else if (kind === "sunk") {
        Mot.to(cell, {
            scale: [1, 1.2, 1],
            rotate: [0, 3, -3, 0],
            duration: 520,
            easing: "easeOutQuad"
        });
    }
}

function animateShipPlacement(cells) {
    if (!cells.length || !canAnimate()) return;
    Mot.to(cells, {
        scale: [0.7, 1],
        opacity: [0.4, 1],
        delay: Mot.stagger(45),
        duration: 360,
        easing: "easeOutBack"
    });
}

function animateRotateButton() {
    const btn = document.getElementById("rotate-ship");
    if (!btn || !canAnimate()) return;
    Mot.to(btn, { rotate: "+=90", duration: 320, easing: "easeOutBack" });
}

function shakeBoard(gridId) {
    const el = document.getElementById(gridId)?.closest(".grid-container");
    if (!el || !canAnimate()) return;
    Mot.to(el, {
        translateX: [0, -4, 4, -3, 3, 0],
        duration: 420,
        easing: "easeOutQuad"
    });
}

function celebrateWin(playerWon) {
    if (typeof confetti === "undefined" || prefersReducedMotion) return;
    const colors = playerWon
        ? ["#1f6f8b", "#a7d7e0", "#c8a24a", "#e8f2f4"]
        : ["#e24a3b", "#94a3b8", "#64748b"];

    confetti({ particleCount: playerWon ? 120 : 50, spread: 70, origin: { y: 0.65 }, colors });
    if (playerWon) {
        setTimeout(() => {
            confetti({ particleCount: 80, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors });
            confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors });
        }, 220);
    }
}

function confettiAtCell(cell, particleCount = 28) {
    if (!cell || typeof confetti === "undefined" || prefersReducedMotion) return;
    const rect = cell.getBoundingClientRect();
    const x = (rect.left + rect.width / 2) / window.innerWidth;
    const y = (rect.top + rect.height / 2) / window.innerHeight;
    confetti({
        particleCount,
        spread: 46,
        startVelocity: 22,
        origin: { x, y },
        colors: ["#1f6f8b", "#c8a24a", "#e24a3b", "#e8f2f4"]
    });
}

function pulseRestartButton(targetId = "restart") {
    const btn = document.getElementById(targetId);
    if (!btn || !canAnimate()) return;
    Mot.to(btn, { scale: [0.85, 1], opacity: [0, 1], duration: 500, easing: "easeOutBack" });
}

function setPlacementHintVisible(visible) {
    const hint = document.getElementById("placement-hint");
    if (!hint) return;
    hint.classList.toggle("hidden", !visible);
}

function playerShipsRemaining() {
    return SHIPS.length - aiSunkShips;
}

function aiShipsRemaining() {
    return SHIPS.length - playerSunkShips;
}

function coordKey(x, y) {
    return `${x},${y}`;
}

function rand() {
    if (typeof seededRandom === "function") return seededRandom();
    return Math.random();
}

function dateSeed() {
    const d = new Date();
    return Number(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`);
}

function makeSeededRandom(seed) {
    const a = Mot.api();
    if (a && typeof a.createSeededRandom === "function") {
        try {
            // Anime defaults decimalLength=0 (only 0/1). Force fractional [0,1).
            const rng = a.createSeededRandom(seed >>> 0, 0, 1, 12);
            return function seededAnime() {
                return rng(0, 1, 12);
            };
        } catch (err) { /* fall through */ }
    }
    let t = seed >>> 0;
    return function seeded() {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), t | 1);
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

/* ===== Safe storage ===== */
const bsStore = (() => {
    let ok = true;
    try {
        const k = "__bs_test__";
        window.localStorage.setItem(k, "1");
        window.localStorage.removeItem(k);
    } catch (e) {
        ok = false;
    }
    const mem = {};
    return {
        getItem(key) {
            if (ok) { try { return window.localStorage.getItem(key); } catch (e) {} }
            return key in mem ? mem[key] : null;
        },
        setItem(key, val) {
            if (ok) { try { window.localStorage.setItem(key, val); return; } catch (e) {} }
            mem[key] = val;
        }
    };
})();

/* ===== Procedural Sound ===== */
const Sound = (() => {
    let ctx = null;
    let master = null;
    let noiseBuffer = null;

    function ensure() {
        if (ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
        const frames = Math.floor(ctx.sampleRate * 0.5);
        noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    }

    function resume() {
        ensure();
        if (ctx && ctx.state === "suspended") ctx.resume();
    }

    function tone(freq, dur, type = "sine", vol = 0.3, slideTo = null) {
        if (!soundOn) return;
        ensure();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + dur);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(vol, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        osc.connect(gain).connect(master);
        osc.start(now);
        osc.stop(now + dur + 0.02);
    }

    function noise(dur, vol = 0.3, cutoff = 1200) {
        if (!soundOn) return;
        ensure();
        if (!ctx || !noiseBuffer) return;
        const now = ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(cutoff, now);
        filter.frequency.exponentialRampToValueAtTime(200, now + dur);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        src.connect(filter).connect(gain).connect(master);
        src.start(now);
        src.stop(now + dur);
    }

    function haptic(pattern) {
        if (soundOn && navigator.vibrate) navigator.vibrate(pattern);
    }

    return {
        resume,
        fire() { tone(680, 0.12, "square", 0.18, 220); haptic(12); },
        hit() { tone(180, 0.18, "sawtooth", 0.3, 60); noise(0.22, 0.25, 900); haptic([20, 30, 20]); },
        miss() { tone(320, 0.1, "sine", 0.16, 180); haptic(8); },
        sunk() { tone(140, 0.3, "sawtooth", 0.35, 50); noise(0.4, 0.35, 700); haptic([30, 40, 30, 40, 60]); },
        place() { tone(520, 0.08, "triangle", 0.2, 720); },
        rotate() { tone(440, 0.06, "square", 0.14); },
        radar() { tone(880, 0.16, "sine", 0.18, 220); noise(0.2, 0.12, 1800); },
        win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.22, "triangle", 0.28), i * 110)); haptic([40, 60, 40, 60, 120]); },
        lose() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.26, "sawtooth", 0.26), i * 130)); haptic([60, 80, 140]); },
        click() { tone(600, 0.04, "sine", 0.12); },
        achieve() { [660, 880, 990].forEach((f, i) => setTimeout(() => tone(f, 0.12, "triangle", 0.22), i * 70)); }
    };
})();

/* ===== Theme ===== */
const THEME_ALIASES = { abyss: "atlantic", volt: "brass", arctic: "regatta", iceberg: "regatta" };
const VALID_THEMES = ["atlantic", "brass", "regatta"];

function resolveTheme(theme) {
    const mapped = THEME_ALIASES[theme] || theme;
    return VALID_THEMES.includes(mapped) ? mapped : "atlantic";
}

function applyTheme(theme) {
    const next = resolveTheme(theme);
    document.body.setAttribute("data-theme", next);
    bsStore.setItem("battleship-theme", next);
    document.querySelectorAll(".theme-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.theme === next);
    });
}

function initThemeSwitcher() {
    applyTheme(bsStore.getItem("battleship-theme") || "atlantic");
    document.querySelectorAll(".theme-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            applyTheme(btn.dataset.theme);
            if (canAnimate()) Mot.to("body", { opacity: [0.85, 1], duration: 280, easing: "easeOutQuad" });
        });
    });
}

/* ===== Game Core ===== */
function initGrid(grid) {
    for (let i = 0; i < GRID_SIZE; i++) grid[i] = new Array(GRID_SIZE).fill(0);
}

function ensureShipLayer(gridId) {
    const gridElement = document.getElementById(gridId);
    let stage = gridElement.closest(".grid-stage");
    if (!stage) {
        stage = document.createElement("div");
        stage.className = "grid-stage";
        gridElement.parentNode.insertBefore(stage, gridElement);
        stage.appendChild(gridElement);
    }
    const layerId = `${gridId}-ships-layer`;
    let layer = document.getElementById(layerId);
    if (!layer) {
        layer = document.createElement("div");
        layer.id = layerId;
        layer.className = "ships-layer";
        layer.setAttribute("aria-hidden", "true");
        stage.insertBefore(layer, gridElement);
    }
    return layer;
}

function createGridDOM(gridId) {
    const gridElement = document.getElementById(gridId);
    gridElement.innerHTML = "";
    const layer = ensureShipLayer(gridId);
    layer.innerHTML = "";
    gridElement.appendChild(createCell("label", ""));
    for (let i = 0; i < GRID_SIZE; i++) gridElement.appendChild(createCell("label", String.fromCharCode(65 + i)));
    for (let i = 0; i < GRID_SIZE; i++) {
        gridElement.appendChild(createCell("label", i + 1));
        for (let j = 0; j < GRID_SIZE; j++) {
            const cell = createCell("cell");
            cell.dataset.x = j;
            cell.dataset.y = i;
            gridElement.appendChild(cell);
        }
    }
}

function renderShipOverlays(gridId, ships, visible) {
    const gridElement = document.getElementById(gridId);
    const layer = ensureShipLayer(gridId);
    layer.innerHTML = "";
    if (!visible || !ships.length) return;
    const gridRect = gridElement.getBoundingClientRect();

    ships.forEach((ship) => {
        if (!ship.positions?.length || !ship.asset) return;
        const first = ship.positions[0];
        const last = ship.positions[ship.positions.length - 1];
        const horizontal = first.y === last.y;
        const startCell = gridElement.querySelector(`.cell[data-x="${first.x}"][data-y="${first.y}"]`);
        const endCell = gridElement.querySelector(`.cell[data-x="${last.x}"][data-y="${last.y}"]`);
        if (!startCell || !endCell) return;
        const startRect = startCell.getBoundingClientRect();
        const endRect = endCell.getBoundingClientRect();
        const sprite = document.createElement("img");
        sprite.className = "ship-sprite";
        sprite.src = shipAssetUrl(ship.asset);
        sprite.alt = ship.name;
        sprite.draggable = false;
        if (ship.isSunk) sprite.classList.add("is-sunk");
        else if (ship.positions.some((pos) => {
            const value = gridId === "player-grid" ? playerGrid[pos.y][pos.x] : aiGrid[pos.y][pos.x];
            return value >= 3;
        })) sprite.classList.add("is-damaged");

        if (horizontal) {
            sprite.style.left = `${startRect.left - gridRect.left}px`;
            sprite.style.top = `${startRect.top - gridRect.top}px`;
            sprite.style.width = `${endRect.right - startRect.left}px`;
            sprite.style.height = `${startRect.height}px`;
        } else {
            const width = endRect.bottom - startRect.top;
            const height = startRect.width;
            sprite.style.left = `${startRect.left - gridRect.left - (width - height) / 2}px`;
            sprite.style.top = `${startRect.top - gridRect.top + (width - height) / 2}px`;
            sprite.style.width = `${width}px`;
            sprite.style.height = `${height}px`;
            sprite.classList.add("vertical");
        }
        layer.appendChild(sprite);
    });
}

function createCell(className, text = "") {
    const cell = document.createElement("div");
    cell.classList.add(className);
    cell.textContent = text;
    return cell;
}

function neighborsOccupied(grid, x, y, ignore) {
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
            if (ignore && ignore.has(coordKey(nx, ny))) continue;
            if (grid[ny][nx] === 1) return true;
        }
    }
    return false;
}

function canPlaceShip(grid, size, x, y, horizontal, enforceNoTouch = noTouchMode) {
    const cells = [];
    for (let i = 0; i < size; i++) {
        const cx = horizontal ? x + i : x;
        const cy = horizontal ? y : y + i;
        if (cx < 0 || cy < 0 || cx >= GRID_SIZE || cy >= GRID_SIZE) return false;
        if (grid[cy][cx] !== 0) return false;
        cells.push({ x: cx, y: cy });
    }
    if (enforceNoTouch) {
        const self = new Set(cells.map((c) => coordKey(c.x, c.y)));
        for (const c of cells) {
            if (neighborsOccupied(grid, c.x, c.y, self)) return false;
        }
    }
    return true;
}

function placeShip(grid, ships, ship, x, y, horizontal) {
    if (!canPlaceShip(grid, ship.size, x, y, horizontal)) return false;
    const newShip = { ...ship, positions: [], isSunk: false };
    for (let i = 0; i < ship.size; i++) {
        if (horizontal) {
            grid[y][x + i] = 1;
            newShip.positions.push({ x: x + i, y });
        } else {
            grid[y + i][x] = 1;
            newShip.positions.push({ x, y: y + i });
        }
    }
    ships.push(newShip);
    return true;
}

function aiCanPlaceHypothesis(grid, size, x, y, horizontal, requireHitCover) {
    let coversHit = false;
    for (let i = 0; i < size; i++) {
        const cx = horizontal ? x + i : x;
        const cy = horizontal ? y : y + i;
        if (cx < 0 || cx >= GRID_SIZE || cy < 0 || cy >= GRID_SIZE) return false;
        const v = grid[cy][cx];
        if (v === 2 || v === 4) return false;
        if (v === 3) coversHit = true;
    }
    if (requireHitCover && !coversHit) return false;
    return true;
}

function placeAIShips() {
    SHIPS.forEach((ship) => {
        let placed = false;
        let guard = 0;
        while (!placed && guard < 2000) {
            guard++;
            const x = Math.floor(rand() * GRID_SIZE);
            const y = Math.floor(rand() * GRID_SIZE);
            const horizontal = rand() < 0.5;
            placed = placeShip(aiGrid, aiShips, ship, x, y, horizontal);
        }
        if (!placed) {
            // Fallback without no-touch if daily seed gets stuck
            while (!placed) {
                const x = Math.floor(Math.random() * GRID_SIZE);
                const y = Math.floor(Math.random() * GRID_SIZE);
                const horizontal = Math.random() < 0.5;
                const prev = noTouchMode;
                noTouchMode = false;
                placed = placeShip(aiGrid, aiShips, ship, x, y, horizontal);
                noTouchMode = prev;
            }
        }
    });
}

function updateGrid(gridId, grid, showShips = true) {
    const cells = document.querySelectorAll(`#${gridId} .cell`);
    cells.forEach((cell) => {
        const x = parseInt(cell.dataset.x, 10);
        const y = parseInt(cell.dataset.y, 10);
        const pending = cell.classList.contains("salvo-pending");
        const radarContact = cell.classList.contains("radar-contact");
        const radarClear = cell.classList.contains("radar-clear");
        cell.className = "cell";
        if (grid[y][x] === 1 && (showShips || gridId === "player-grid")) cell.classList.add("ship");
        if (grid[y][x] === 2) cell.classList.add("miss");
        if (grid[y][x] === 3) cell.classList.add("hit");
        if (grid[y][x] === 4) cell.classList.add("sunk");
        if (pending && gridId === "ai-grid") cell.classList.add("salvo-pending");
        if (radarContact && gridId === "ai-grid" && grid[y][x] <= 1) cell.classList.add("radar-contact");
        if (radarClear && gridId === "ai-grid" && grid[y][x] === 0) cell.classList.add("radar-clear");
    });

    if (gridId === "player-grid") renderShipOverlays("player-grid", playerShips, true);
    else renderShipOverlays("ai-grid", aiShips.filter((ship) => ship.isSunk), true);
}

function playerAttack(x, y) {
    if (aiGrid[y][x] === 0) {
        aiGrid[y][x] = 2;
        return "miss";
    }
    if (aiGrid[y][x] === 1) {
        aiGrid[y][x] = 3;
        const sunk = checkSunk(aiGrid, aiShips, x, y);
        if (sunk) playerSunkShips++;
        return sunk ? "sunk" : "hit";
    }
    return "invalid";
}

function cellOpenForShot(grid, x, y) {
    return grid[y][x] <= 1;
}

function randomOpenCell(grid, excluded) {
    const open = [];
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (!cellOpenForShot(grid, x, y)) continue;
            if (excluded && excluded.has(coordKey(x, y))) continue;
            open.push([x, y]);
        }
    }
    if (!open.length) return null;
    return open[Math.floor(rand() * open.length)];
}

function aiPickHard(excluded) {
    const heat = Array.from({ length: GRID_SIZE }, () => new Array(GRID_SIZE).fill(0));
    const shipsLeft = playerShips.filter((ship) => ship && !ship.isSunk);
    let hasHits = false;
    for (let y = 0; y < GRID_SIZE && !hasHits; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (playerGrid[y][x] === 3) { hasHits = true; break; }
        }
    }

    for (const ship of shipsLeft) {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                for (const horizontal of [true, false]) {
                    if (!aiCanPlaceHypothesis(playerGrid, ship.size, x, y, horizontal, hasHits)) continue;
                    for (let i = 0; i < ship.size; i++) {
                        const cx = horizontal ? x + i : x;
                        const cy = horizontal ? y : y + i;
                        heat[cy][cx] += 1;
                    }
                }
            }
        }
    }

    let best = [];
    let bestScore = -1;
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (!cellOpenForShot(playerGrid, x, y)) continue;
            if (excluded && excluded.has(coordKey(x, y))) continue;
            const score = heat[y][x];
            if (score > bestScore) {
                bestScore = score;
                best = [[x, y]];
            } else if (score === bestScore) best.push([x, y]);
        }
    }
    if (best.length) return best[Math.floor(rand() * best.length)];
    return randomOpenCell(playerGrid, excluded) || [0, 0];
}

function aiChooseTarget(excluded) {
    if (difficulty === "hard") return aiPickHard(excluded);
    if (difficulty === "normal" && aiHuntMode) {
        while (aiHuntQueue.length > 0) {
            const [x, y] = aiHuntQueue.shift();
            if (!cellOpenForShot(playerGrid, x, y)) continue;
            if (excluded && excluded.has(coordKey(x, y))) continue;
            return [x, y];
        }
        aiHuntMode = false;
        aiLastHit = null;
    }
    return randomOpenCell(playerGrid, excluded) || [0, 0];
}

function applyAiShotResult(x, y, result) {
    const cell = document.querySelector(`#player-grid .cell[data-x="${x}"][data-y="${y}"]`);
    if (cell) {
        cell.classList.add("firing");
        setTimeout(() => cell.classList.remove("firing"), 500);
    }
    if (result === "miss") {
        animateCellImpact(cell, "miss");
        Sound.miss();
        logMove("ai", x, y, "miss");
        return;
    }
    if (result === "sunk") {
        animateCellImpact(cell, "sunk");
        Sound.sunk();
        shakeBoard("player-grid");
        confettiAtCell(cell, 18);
        logMove("ai", x, y, "sunk");
        animateSinkFlood("player-grid", playerShips, x, y);
    } else {
        animateCellImpact(cell, "hit");
        Sound.hit();
        logMove("ai", x, y, "hit");
    }
    if (difficulty === "normal") {
        aiHuntMode = true;
        aiLastHit = { x, y };
        updateAIHuntQueue(x, y);
    }
}

function resolveAiShot(x, y) {
    if (playerGrid[y][x] === 0) {
        playerGrid[y][x] = 2;
        applyAiShotResult(x, y, "miss");
        return "miss";
    }
    if (playerGrid[y][x] === 1) {
        playerGrid[y][x] = 3;
        const sunk = checkSunk(playerGrid, playerShips, x, y);
        if (sunk) {
            aiSunkShips++;
            applyAiShotResult(x, y, "sunk");
            return "sunk";
        }
        applyAiShotResult(x, y, "hit");
        return "hit";
    }
    return "invalid";
}

function aiAttack() {
    const [x, y] = aiChooseTarget(null);
    return resolveAiShot(x, y);
}

function updateAIHuntQueue(x, y) {
    const directions = [
        { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
    ];
    for (const dir of directions) {
        const newX = x + dir.dx;
        const newY = y + dir.dy;
        if (
            newX >= 0 && newX < GRID_SIZE &&
            newY >= 0 && newY < GRID_SIZE &&
            cellOpenForShot(playerGrid, newX, newY) &&
            !aiHuntQueue.some(([qx, qy]) => qx === newX && qy === newY)
        ) {
            aiHuntQueue.push([newX, newY]);
        }
    }
}

function checkSunk(grid, ships, x, y) {
    const hitShip = ships.find((ship) => ship.positions.some((pos) => pos.x === x && pos.y === y));
    if (!hitShip) return false;
    const allHit = hitShip.positions.every((pos) => grid[pos.y][pos.x] === 3);
    if (!allHit) return false;
    hitShip.positions.forEach((pos) => { grid[pos.y][pos.x] = 4; });
    hitShip.isSunk = true;
    if (grid === playerGrid) {
        aiHuntMode = false;
        aiLastHit = null;
        aiHuntQueue = [];
    }
    updateShipStatus();
    return true;
}

function isGameOver() {
    return playerSunkShips === SHIPS.length || aiSunkShips === SHIPS.length;
}

function animateSinkFlood(gridId, ships, x, y) {
    const ship = ships.find((s) => s.positions.some((p) => p.x === x && p.y === y));
    if (!ship || !canAnimate()) return;
    const cells = ship.positions
        .map((p) => document.querySelector(`#${gridId} .cell[data-x="${p.x}"][data-y="${p.y}"]`))
        .filter(Boolean);
    Mot.to(cells, {
        scale: [1, 1.15, 1],
        delay: Mot.stagger(55),
        duration: 420,
        easing: "easeOutQuad"
    });
}

function playShotTravel(fromSide, x, y, onDone) {
    const done = typeof onDone === "function" ? onDone : () => {};
    if (!canAnimate()) {
        done();
        return;
    }
    const targetGrid = fromSide === "you" ? "ai-grid" : "player-grid";
    const target = document.querySelector(`#${targetGrid} .cell[data-x="${x}"][data-y="${y}"]`);
    const originPanel = document.getElementById(fromSide === "you" ? "player-panel" : "ai-panel");
    if (!target || !originPanel) {
        done();
        return;
    }
    const tRect = target.getBoundingClientRect();
    const oRect = originPanel.getBoundingClientRect();
    const bolt = document.createElement("div");
    bolt.className = "shot-bolt";
    bolt.style.left = `${oRect.left + oRect.width / 2}px`;
    bolt.style.top = `${oRect.top + oRect.height / 2}px`;
    document.body.appendChild(bolt);
    const dx = tRect.left + tRect.width / 2 - (oRect.left + oRect.width / 2);
    const dy = tRect.top + tRect.height / 2 - (oRect.top + oRect.height / 2);
    const anim = Mot.to(bolt, {
        translateX: dx,
        translateY: dy,
        opacity: [1, 1, 0],
        scale: [0.6, 1, 0.4],
        duration: 280,
        easing: "easeOutQuad"
    });
    const finish = () => {
        bolt.remove();
        done();
    };
    if (anim && typeof anim.then === "function") anim.then(finish);
    else setTimeout(finish, 280);
}

function telegraphAiScan(callback) {
    const finish = typeof callback === "function" ? callback : () => {};
    document.getElementById("ai-panel")?.classList.add("is-thinking");
    document.getElementById("player-panel")?.classList.add("is-scanned");
    Mot.scramble(document.getElementById("status"), "AI SCANNING…", 500);
    if (!canAnimate()) {
        setTimeout(() => {
            document.getElementById("ai-panel")?.classList.remove("is-thinking");
            document.getElementById("player-panel")?.classList.remove("is-scanned");
            finish();
        }, 450);
        return;
    }
    const cells = document.querySelectorAll("#player-grid .cell");
    Mot.to(cells, {
        opacity: [1, 0.55, 1],
        delay: Mot.stagger(8, { grid: [10, 10], from: "center" }),
        duration: 420,
        easing: "easeOutQuad"
    });
    setTimeout(() => {
        document.getElementById("ai-panel")?.classList.remove("is-thinking");
        document.getElementById("player-panel")?.classList.remove("is-scanned");
        finish();
    }, 520);
}

function revealEnemyFleet() {
    renderShipOverlays("ai-grid", aiShips, true);
    document.querySelectorAll("#ai-grid .cell").forEach((cell) => {
        const x = parseInt(cell.dataset.x, 10);
        const y = parseInt(cell.dataset.y, 10);
        if (aiGrid[y][x] === 1) cell.classList.add("ship", "revealed");
    });
}

function setOptionsLocked(locked) {
    document.querySelectorAll(".seg-btn").forEach((btn) => {
        btn.disabled = locked || dailyMode;
        btn.title = locked || dailyMode
            ? "Locked during battle / daily"
            : (btn.dataset.difficulty === "easy" ? "Random shots"
                : btn.dataset.difficulty === "normal" ? "Hunt after hits" : "Probability hunt");
    });
    ["salvo-toggle", "notouch-toggle", "daily-toggle"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === "daily-toggle") el.disabled = locked;
        else el.disabled = locked || dailyMode;
    });
    document.getElementById("game-container")?.classList.toggle("options-locked", locked);
}

function bindGridListeners() {
    if (gridAbort) gridAbort.abort();
    gridAbort = new AbortController();
    const opts = { signal: gridAbort.signal };
    const playerGridEl = document.getElementById("player-grid");
    const aiGridEl = document.getElementById("ai-grid");
    playerGridEl.addEventListener("click", handlePlayerGridClick, opts);
    playerGridEl.addEventListener("mousemove", handlePlayerGridHover, opts);
    playerGridEl.addEventListener("wheel", handlePlayerGridWheel, { passive: false, signal: gridAbort.signal });
    playerGridEl.addEventListener("pointerdown", handlePlayerGridPointerDown, opts);
    aiGridEl.addEventListener("click", handleAIGridClick, opts);
}

function destroyDockDraggables() {
    dockDraggables.forEach((d) => {
        try { d.revert?.(); d.disable?.(); } catch (err) { /* ignore */ }
    });
    dockDraggables = [];
}

function renderShipDock() {
    const dock = document.getElementById("ship-dock");
    if (!dock) return;
    destroyDockDraggables();
    dock.innerHTML = "";
    dock.classList.toggle("hidden", !isPlacingShips);
    if (!isPlacingShips) return;

    SHIPS.forEach((ship, index) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "dock-chip";
        chip.dataset.shipIndex = String(index);
        if (index < currentShipIndex) chip.classList.add("is-placed");
        if (index === currentShipIndex) chip.classList.add("is-current");
        chip.innerHTML = `<img src="${shipAssetUrl(ship.asset)}" alt=""><span>${ship.name}</span>`;
        chip.title = index === currentShipIndex ? "Drag onto your grid to place" : ship.name;
        dock.appendChild(chip);

        if (index !== currentShipIndex || !Mot.api()) return;
        const drag = Mot.createDraggable(chip, {
            cursor: false,
            releaseEase: "outQuad",
            onRelease: () => {
                const rect = chip.getBoundingClientRect();
                const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                const cell = el?.closest?.("#player-grid .cell");
                try { drag.reset?.(); } catch (err) { /* ignore */ }
                if (cell) handlePlayerGridClick({ target: cell });
            }
        });
        if (drag) dockDraggables.push(drag);
    });
}

function startGame() {
    seededRandom = dailyMode ? makeSeededRandom(dateSeed()) : null;
    if (dailyMode) {
        difficulty = "normal";
        salvoMode = false;
        document.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.difficulty === "normal"));
        const salvoBtn = document.getElementById("salvo-toggle");
        if (salvoBtn) {
            salvoBtn.classList.remove("active");
            salvoBtn.setAttribute("aria-pressed", "false");
        }
    }

    initGrid(playerGrid);
    initGrid(aiGrid);
    createGridDOM("player-grid");
    createGridDOM("ai-grid");
    playerShips = [];
    aiShips = [];
    const savedNoTouch = noTouchMode;
    // AI follows no-touch only when player enabled it (fair mirror)
    placeAIShips();
    noTouchMode = savedNoTouch;

    currentShipIndex = 0;
    isPlacingShips = true;
    isPlayerTurn = true;
    gameOver = false;
    battleActive = false;
    turnBusy = false;
    isHorizontal = true;
    aiLastHit = null;
    aiHuntMode = false;
    aiHuntQueue = [];
    playerSunkShips = 0;
    aiSunkShips = 0;
    playerShotsFired = 0;
    playerHitsLanded = 0;
    gameStartTime = Date.now();
    radarCharges = 1;
    radarUsed = false;
    radarAiming = false;
    usedNoTouchThisGame = noTouchMode;
    clearSalvoSelection();

    const logList = document.getElementById("move-log-list");
    if (logList) logList.innerHTML = "";
    hideResultModal();
    updateStatus(dailyMode ? "Daily Challenge — place your fleet" : "Place your ships — rotate to fit");
    setPlacementHintVisible(true);
    setOptionsLocked(false);
    updatePlacementControls();
    updateSalvoBar();
    updateRadarButton();
    renderShipDock();
    bindGridListeners();
    document.getElementById("restart").style.display = "none";
    updateGrid("player-grid", playerGrid);
    updateGrid("ai-grid", aiGrid, false);
    updateShipStatus();

    if (canAnimate()) {
        Mot.to("#player-grid .cell, #ai-grid .cell", {
            opacity: [0, 1],
            scale: [0.6, 1],
            delay: Mot.stagger(4, { grid: [10, 10], from: "center" }),
            duration: 420,
            easing: "easeOutQuad"
        });
    }
}

function beginBattle() {
    isPlacingShips = false;
    battleActive = true;
    currentShipIndex = SHIPS.length;
    usedNoTouchThisGame = noTouchMode;
    setPlacementHintVisible(false);
    updatePlacementControls();
    setOptionsLocked(true);
    clearSalvoSelection();
    updateSalvoBar();
    updateRadarButton();
    renderShipDock();
    const need = playerShipsRemaining();
    const msg = salvoMode
        ? `Your turn — select ${need} target${need === 1 ? "" : "s"}, then Fire`
        : "Your turn — fire on enemy waters!";
    Mot.scramble(document.getElementById("status"), msg, 700);
    if (!Mot.api() || prefersReducedMotion) updateStatus(msg);
    if (canAnimate()) Mot.to("#ai-panel", { scale: [0.98, 1], duration: 400, easing: "easeOutBack" });
}

function updatePlacementControls() {
    const rotate = document.getElementById("rotate-ship");
    const auto = document.getElementById("auto-place");
    const undo = document.getElementById("undo-ship");
    const clear = document.getElementById("clear-fleet");
    const show = isPlacingShips;
    if (rotate) rotate.style.display = show ? "inline-flex" : "none";
    if (auto) auto.style.display = show ? "inline-flex" : "none";
    if (undo) {
        undo.style.display = show ? "inline-flex" : "none";
        undo.disabled = !playerShips.length;
    }
    if (clear) {
        clear.style.display = show ? "inline-flex" : "none";
        clear.disabled = !playerShips.length;
    }
    renderShipDock();
}

function updateRadarButton() {
    const btn = document.getElementById("radar-btn");
    if (!btn) return;
    const show = battleActive && !gameOver;
    btn.classList.toggle("hidden", !show);
    btn.disabled = !show || radarCharges <= 0 || !isPlayerTurn || turnBusy;
    btn.classList.toggle("active", radarAiming);
    btn.setAttribute("aria-pressed", String(radarAiming));
    btn.title = radarCharges > 0 ? "Radar scout: reveal a 3×3 area (1 use)" : "Radar expended";
    const label = btn.querySelector(".toggle-label");
    if (label) label.textContent = radarCharges > 0 ? "Radar" : "Radar 0";
}

function handlePlayerGridClick(event) {
    if (justDragged) return;
    if (!isPlacingShips || !event.target.classList.contains("cell")) return;
    const x = parseInt(event.target.dataset.x, 10);
    const y = parseInt(event.target.dataset.y, 10);
    if (placeShip(playerGrid, playerShips, SHIPS[currentShipIndex], x, y, isHorizontal)) {
        updateGrid("player-grid", playerGrid);
        const placedCells = [];
        for (let i = 0; i < SHIPS[currentShipIndex].size; i++) {
            const cx = isHorizontal ? x + i : x;
            const cy = isHorizontal ? y : y + i;
            const cell = document.querySelector(`#player-grid .cell[data-x="${cx}"][data-y="${cy}"]`);
            if (cell) placedCells.push(cell);
        }
        animateShipPlacement(placedCells);
        Sound.place();
        currentShipIndex++;
        updatePlacementControls();
        if (currentShipIndex >= SHIPS.length) beginBattle();
        else updateStatus(`Place ${SHIPS[currentShipIndex].name} (${SHIPS[currentShipIndex].size})`);
        updateShipStatus();
    }
}

let dragPlacing = false;
let dragMoved = false;
let justDragged = false;

function handlePlayerGridPointerDown(event) {
    if (!isPlacingShips || !event.target.classList.contains("cell")) return;
    dragPlacing = true;
    dragMoved = false;
    Sound.resume();
    handlePlayerGridHover(event);
    window.addEventListener("pointermove", handlePlayerGridPointerMove);
    window.addEventListener("pointerup", handlePlayerGridPointerUp);
}

function handlePlayerGridPointerMove(event) {
    if (!dragPlacing) return;
    dragMoved = true;
    const cell = document.elementFromPoint(event.clientX, event.clientY);
    if (cell && cell.classList.contains("cell") && cell.closest("#player-grid")) {
        handlePlayerGridHover({ target: cell });
    }
}

function handlePlayerGridPointerUp(event) {
    if (!dragPlacing) return;
    dragPlacing = false;
    window.removeEventListener("pointermove", handlePlayerGridPointerMove);
    window.removeEventListener("pointerup", handlePlayerGridPointerUp);
    if (dragMoved) {
        const cell = document.elementFromPoint(event.clientX, event.clientY);
        if (cell && cell.classList.contains("cell") && cell.closest("#player-grid")) {
            justDragged = true;
            setTimeout(() => { justDragged = false; }, 350);
            handlePlayerGridClick({ target: cell });
        }
    }
}

function clearPlayerFleetCells() {
    playerShips.forEach((ship) => {
        ship.positions.forEach((pos) => { playerGrid[pos.y][pos.x] = 0; });
    });
    playerShips = [];
    currentShipIndex = 0;
}

function undoLastShip() {
    if (!isPlacingShips || !playerShips.length) return;
    const ship = playerShips.pop();
    ship.positions.forEach((pos) => { playerGrid[pos.y][pos.x] = 0; });
    currentShipIndex = playerShips.length;
    updateGrid("player-grid", playerGrid);
    updateShipStatus();
    updatePlacementControls();
    updateStatus(`Place ${SHIPS[currentShipIndex].name} (${SHIPS[currentShipIndex].size})`);
    Sound.click();
}

function clearFleet() {
    if (!isPlacingShips || !playerShips.length) return;
    clearPlayerFleetCells();
    updateGrid("player-grid", playerGrid);
    updateShipStatus();
    updatePlacementControls();
    updateStatus(`Place ${SHIPS[0].name} (${SHIPS[0].size})`);
    Sound.click();
}

function autoPlaceFleet() {
    if (!isPlacingShips) return;
    Sound.resume();
    let success = false;
    for (let attempt = 0; attempt < 80 && !success; attempt++) {
        clearPlayerFleetCells();
        let ok = true;
        for (const ship of SHIPS) {
            let placed = false;
            for (let guard = 0; guard < 500 && !placed; guard++) {
                const x = Math.floor(Math.random() * GRID_SIZE);
                const y = Math.floor(Math.random() * GRID_SIZE);
                const horizontal = Math.random() < 0.5;
                placed = placeShip(playerGrid, playerShips, ship, x, y, horizontal);
            }
            if (!placed) { ok = false; break; }
        }
        success = ok;
    }
    if (!success) {
        clearPlayerFleetCells();
        updateGrid("player-grid", playerGrid);
        updateShipStatus();
        updatePlacementControls();
        updateStatus("Auto-place failed — try again or place manually");
        return;
    }
    currentShipIndex = SHIPS.length;
    updateGrid("player-grid", playerGrid);
    updateShipStatus();
    Sound.place();
    beginBattle();
}

function handlePlayerGridHover(event) {
    if (!isPlacingShips || !event.target.classList.contains("cell")) return;
    if (currentShipIndex >= SHIPS.length) return;
    const x = parseInt(event.target.dataset.x, 10);
    const y = parseInt(event.target.dataset.y, 10);
    document.querySelectorAll("#player-grid .ship-preview").forEach((cell) => cell.classList.remove("ship-preview"));
    if (canPlaceShip(playerGrid, SHIPS[currentShipIndex].size, x, y, isHorizontal)) {
        for (let i = 0; i < SHIPS[currentShipIndex].size; i++) {
            const previewCell = document.querySelector(
                `#player-grid .cell[data-x="${isHorizontal ? x + i : x}"][data-y="${isHorizontal ? y : y + i}"]`
            );
            if (previewCell) previewCell.classList.add("ship-preview");
        }
    }
}

function handlePlayerGridWheel(event) {
    if (!isPlacingShips) return;
    event.preventDefault();
    isHorizontal = !isHorizontal;
    animateRotateButton();
    handlePlayerGridHover(event);
}

function clearSalvoSelection() {
    salvoTargets = [];
    document.querySelectorAll("#ai-grid .salvo-pending").forEach((cell) => cell.classList.remove("salvo-pending"));
}

function updateSalvoBar() {
    const bar = document.getElementById("salvo-bar");
    const countEl = document.getElementById("salvo-count");
    const fireBtn = document.getElementById("fire-salvo");
    const clearBtn = document.getElementById("salvo-clear");
    if (!bar || !countEl || !fireBtn) return;
    const show = battleActive && !gameOver && salvoMode && isPlayerTurn && !turnBusy;
    bar.classList.toggle("hidden", !show);
    if (!show) return;
    const need = playerShipsRemaining();
    const n = salvoTargets.length;
    countEl.textContent = `Select ${n} / ${need} target${need === 1 ? "" : "s"}`;
    fireBtn.disabled = n !== need || need < 1;
    if (clearBtn) clearBtn.disabled = n === 0;
}

function toggleSalvoTarget(x, y) {
    const need = playerShipsRemaining();
    const idx = salvoTargets.findIndex((t) => t.x === x && t.y === y);
    const cell = document.querySelector(`#ai-grid .cell[data-x="${x}"][data-y="${y}"]`);
    if (idx >= 0) {
        salvoTargets.splice(idx, 1);
        cell?.classList.remove("salvo-pending");
        Sound.click();
    } else if (salvoTargets.length < need) {
        if (aiGrid[y][x] > 1) return;
        salvoTargets.push({ x, y });
        cell?.classList.add("salvo-pending");
        Sound.click();
    } else {
        updateStatus(`Salvo full — Fire or clear a target (${need} max)`);
        return;
    }
    updateSalvoBar();
    const left = need - salvoTargets.length;
    updateStatus(left > 0 ? `Salvo: ${left} more target${left === 1 ? "" : "s"}` : "Salvo ready — press Fire");
}

function performRadarScan(cx, cy) {
    radarCharges = 0;
    radarUsed = true;
    radarAiming = false;
    updateRadarButton();
    Sound.radar();
    Mot.scramble(document.getElementById("status"), "RADAR PING…", 500);
    for (let y = cy - 1; y <= cy + 1; y++) {
        for (let x = cx - 1; x <= cx + 1; x++) {
            if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue;
            const cell = document.querySelector(`#ai-grid .cell[data-x="${x}"][data-y="${y}"]`);
            if (!cell || aiGrid[y][x] > 1) continue;
            cell.classList.add("radar-flash");
            if (aiGrid[y][x] === 1) cell.classList.add("radar-contact");
            else cell.classList.add("radar-clear");
            setTimeout(() => cell.classList.remove("radar-flash"), 900);
        }
    }
    setTimeout(() => updateStatus("Radar intel marked — resume fire"), 500);
}

function handleAIGridClick(event) {
    if (isPlacingShips || !isPlayerTurn || gameOver || turnBusy || !event.target.classList.contains("cell")) return;
    const x = parseInt(event.target.dataset.x, 10);
    const y = parseInt(event.target.dataset.y, 10);
    if (Number.isNaN(x) || Number.isNaN(y)) return;

    if (radarAiming) {
        performRadarScan(x, y);
        return;
    }
    if (salvoMode) {
        toggleSalvoTarget(x, y);
        return;
    }
    if (aiGrid[y][x] > 1) return;

    turnBusy = true;
    isPlayerTurn = false;
    updateRadarButton();
    Sound.fire();
    playShotTravel("you", x, y, () => {
        playerShoot(x, y, false);
        if (checkGameOver()) {
            turnBusy = false;
            return;
        }
        updateStatus("AI is targeting…");
        setTimeout(() => telegraphAiScan(() => aiTurn()), 350);
    });
}

function playerShoot(x, y, playFireSound = true) {
    const cell = document.querySelector(`#ai-grid .cell[data-x="${x}"][data-y="${y}"]`);
    if (cell) {
        cell.classList.add("firing");
        setTimeout(() => cell.classList.remove("firing"), 500);
    }
    if (playFireSound) Sound.fire();
    const result = playerAttack(x, y);
    cell?.classList.remove("radar-contact", "radar-clear");
    updateGrid("ai-grid", aiGrid, false);
    const target = document.querySelector(`#ai-grid .cell[data-x="${x}"][data-y="${y}"]`);
    if (result === "sunk") {
        animateCellImpact(target, "sunk");
        Sound.sunk();
        shakeBoard("ai-grid");
        confettiAtCell(target, 34);
        animateSinkFlood("ai-grid", aiShips, x, y);
        Mot.scramble(document.getElementById("status"), "SHIP SUNK!", 550);
    } else if (result === "hit") {
        animateCellImpact(target, "hit");
        Sound.hit();
        updateStatus("Hit!");
    } else if (result === "miss") {
        animateCellImpact(target, "miss");
        Sound.miss();
    } else {
        return "invalid";
    }
    logMove("you", x, y, result);
    return result;
}

function firePlayerSalvo() {
    const need = playerShipsRemaining();
    if (!salvoMode || !isPlayerTurn || turnBusy || gameOver) return;
    if (salvoTargets.length !== need || need < 1) return;
    const targets = salvoTargets.slice();
    clearSalvoSelection();
    turnBusy = true;
    isPlayerTurn = false;
    updateSalvoBar();
    updateRadarButton();
    Mot.scramble(document.getElementById("status"), "SALVO AWAY!", 500);

    targets.forEach((t, i) => {
        setTimeout(() => {
            if (gameOver) return;
            playShotTravel("you", t.x, t.y, () => {
                playerShoot(t.x, t.y, true);
                if (i === targets.length - 1) {
                    if (checkGameOver()) {
                        turnBusy = false;
                        return;
                    }
                    updateStatus("AI is targeting…");
                    setTimeout(() => telegraphAiScan(() => aiTurn()), 280);
                }
            });
        }, i * 320);
    });
}

function aiTurn() {
    if (gameOver) {
        turnBusy = false;
        return;
    }

    if (salvoMode) {
        const shots = Math.max(0, aiShipsRemaining());
        const targets = [];
        const excluded = new Set();
        let guard = 0;
        while (targets.length < shots && guard < 300) {
            guard++;
            const pick = aiChooseTarget(excluded);
            if (!pick) break;
            const [x, y] = pick;
            const key = coordKey(x, y);
            if (!cellOpenForShot(playerGrid, x, y) || excluded.has(key)) {
                excluded.add(key);
                continue;
            }
            excluded.add(key);
            targets.push({ x, y });
        }
        if (!targets.length) {
            finishAiTurn();
            return;
        }
        targets.forEach((t, i) => {
            setTimeout(() => {
                if (gameOver) return;
                playShotTravel("ai", t.x, t.y, () => {
                    resolveAiShot(t.x, t.y);
                    updateGrid("player-grid", playerGrid);
                    if (i === targets.length - 1) {
                        if (checkGameOver()) {
                            turnBusy = false;
                            return;
                        }
                        finishAiTurn();
                    }
                });
            }, i * 340);
        });
        return;
    }

    const [x, y] = aiChooseTarget(null);
    playShotTravel("ai", x, y, () => {
        resolveAiShot(x, y);
        updateGrid("player-grid", playerGrid);
        if (checkGameOver()) {
            turnBusy = false;
            return;
        }
        finishAiTurn();
    });
}

function finishAiTurn() {
    if (gameOver) {
        turnBusy = false;
        return;
    }
    isPlayerTurn = true;
    turnBusy = false;
    updateSalvoBar();
    updateRadarButton();
    const need = playerShipsRemaining();
    const msg = salvoMode
        ? `Your turn — select ${need} target${need === 1 ? "" : "s"}, then Fire`
        : "Your turn to attack!";
    Mot.scramble(document.getElementById("status"), msg, 550);
    if (!Mot.api() || prefersReducedMotion) updateStatus(msg);
}

function logMove(side, x, y, result) {
    if (side === "you") playerShotsFired++;
    if (side === "you" && (result === "hit" || result === "sunk")) playerHitsLanded++;
    const list = document.getElementById("move-log-list");
    if (!list) return;
    const coord = `${String.fromCharCode(65 + x)}${y + 1}`;
    const tagText = result === "sunk" ? "SUNK" : result.toUpperCase();
    const sunkName = result === "sunk" ? shipNameAt(side === "you" ? aiShips : playerShips, x, y) : null;
    const li = document.createElement("li");
    li.className = side;
    li.innerHTML = `<span class="log-side">${side === "you" ? "YOU" : "AI"}</span>` +
        `<span>${coord}</span>` +
        `<span class="log-tag ${result}">${tagText}</span>` +
        (sunkName ? ` <span>${sunkName}</span>` : "");
    list.prepend(li);
    while (list.children.length > 30) list.removeChild(list.lastChild);
}

function shipNameAt(ships, x, y) {
    const ship = ships.find((s) => s.positions?.some((p) => p.x === x && p.y === y));
    return ship ? ship.name : null;
}

function checkGameOver() {
    if (!isGameOver()) return false;
    gameOver = true;
    turnBusy = false;
    battleActive = false;
    clearSalvoSelection();
    updateSalvoBar();
    updateRadarButton();
    setOptionsLocked(false);
    const winner = playerSunkShips === SHIPS.length ? "You" : "AI";
    if (winner === "You") {
        playerScore++;
        animateScoreBump("player-score");
    } else {
        aiScore++;
        animateScoreBump("ai-score");
        revealEnemyFleet();
    }
    updateScore();
    updateStatus(winner === "You" ? "Victory! Fleet destroyed the enemy." : "Defeat — AI took the seas.");
    celebrateWin(winner === "You");
    if (winner === "You") Sound.win(); else Sound.lose();
    recordResult(winner === "You");
    evaluateAchievements(winner === "You");
    showResultModal(winner === "You");
    return true;
}

function updateStatus(message) {
    const el = document.getElementById("status");
    if (el) el.textContent = message;
    animateStatus();
}

function updateScore() {
    document.getElementById("player-score").textContent = playerScore;
    document.getElementById("ai-score").textContent = aiScore;
}

function updateShipStatus() {
    const playerShipTable = document.getElementById("player-ships");
    const aiShipTable = document.getElementById("ai-ships");
    playerShipTable.innerHTML = "<tr><th>Ship</th><th>Status</th></tr>";
    aiShipTable.innerHTML = "<tr><th>Ship</th><th>Status</th></tr>";
    SHIPS.forEach((ship, index) => {
        const playerShipRow = playerShipTable.insertRow();
        const aiShipRow = aiShipTable.insertRow();
        const playerShipStatus = playerShips[index]?.isSunk ? "Sunk" : "Afloat";
        const aiShipStatus = aiShips[index]?.isSunk ? "Sunk" : "Afloat";
        const icon = `<img class="ship-icon" src="${shipAssetUrl(ship.asset)}" alt="" loading="lazy">`;
        playerShipRow.className = playerShipStatus === "Sunk" ? "row-sunk" : "row-afloat";
        aiShipRow.className = aiShipStatus === "Sunk" ? "row-sunk" : "row-afloat";
        playerShipRow.innerHTML = `<td><span class="ship-name">${icon}<span>${ship.name}</span></span></td><td class="${playerShipStatus.toLowerCase()}">${playerShipStatus}</td>`;
        aiShipRow.innerHTML = `<td><span class="ship-name">${icon}<span>${ship.name}</span></span></td><td class="${aiShipStatus.toLowerCase()}">${aiShipStatus}</td>`;
    });
}

/* ===== Achievements / Career / Daily ===== */
function loadStats() {
    try {
        const raw = bsStore.getItem("battleship-stats");
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { wins: 0, losses: 0, streak: 0, bestStreak: 0, achievements: [], dailyBest: {} };
}

function saveStats(s) {
    bsStore.setItem("battleship-stats", JSON.stringify(s));
}

function renderStats() {
    const s = loadStats();
    const w = document.getElementById("stat-wins");
    const l = document.getElementById("stat-losses");
    const st = document.getElementById("stat-streak");
    if (w) w.textContent = s.wins;
    if (l) l.textContent = s.losses;
    if (st) st.textContent = s.streak;
    renderAchievements(s);
    renderDailyLabel();
}

function renderAchievements(s) {
    const box = document.getElementById("achievements-list");
    if (!box) return;
    const unlocked = new Set(s.achievements || []);
    box.innerHTML = ACHIEVEMENTS.map((a) =>
        `<li class="${unlocked.has(a.id) ? "unlocked" : "locked"}" title="${a.desc}">` +
        `<i class="fa-solid ${unlocked.has(a.id) ? "fa-medal" : "fa-lock"}"></i> ${a.title}</li>`
    ).join("");
}

function renderDailyLabel() {
    const el = document.getElementById("daily-label");
    if (!el) return;
    const seed = dateSeed();
    const s = loadStats();
    const best = s.dailyBest?.[seed];
    el.textContent = best ? `Today best: ${best.acc}% / ${best.shots} shots` : `Daily #${seed}`;
}

function toastAchievement(title) {
    const host = document.getElementById("achieve-toast");
    if (!host) return;
    host.textContent = `Achievement: ${title}`;
    host.classList.add("show");
    Sound.achieve();
    Mot.to(host, { translateY: [-12, 0], opacity: [0, 1], duration: 380, easing: "easeOutBack" });
    setTimeout(() => host.classList.remove("show"), 2600);
}

function unlockAchievement(id) {
    const s = loadStats();
    s.achievements = s.achievements || [];
    if (s.achievements.includes(id)) return false;
    s.achievements.push(id);
    saveStats(s);
    const meta = ACHIEVEMENTS.find((a) => a.id === id);
    if (meta) toastAchievement(meta.title);
    renderAchievements(s);
    return true;
}

function evaluateAchievements(won) {
    if (!won) return;
    unlockAchievement("first_win");
    if (difficulty === "hard") unlockAchievement("hard_win");
    if (salvoMode) unlockAchievement("salvo_win");
    const acc = playerShotsFired ? (playerHitsLanded / playerShotsFired) * 100 : 0;
    if (playerShotsFired >= 8 && acc >= 70) unlockAchievement("perfect_acc");
    const s = loadStats();
    if (s.streak >= 3) unlockAchievement("streak3");
    if (radarUsed) unlockAchievement("radar_win");
    if (dailyMode) unlockAchievement("daily_win");
    if (usedNoTouchThisGame) unlockAchievement("untouchable");
}

function recordResult(won) {
    const s = loadStats();
    if (won) {
        s.wins++;
        s.streak++;
        s.bestStreak = Math.max(s.bestStreak || 0, s.streak);
    } else {
        s.losses++;
        s.streak = 0;
    }
    if (dailyMode) {
        const seed = String(dateSeed());
        const acc = playerShotsFired ? Math.round((playerHitsLanded / playerShotsFired) * 100) : 0;
        s.dailyBest = s.dailyBest || {};
        const prev = s.dailyBest[seed];
        if (won && (!prev || acc > prev.acc || (acc === prev.acc && playerShotsFired < prev.shots))) {
            s.dailyBest[seed] = { acc, shots: playerShotsFired, won: true };
        }
    }
    saveStats(s);
    renderStats();
}

function showResultModal(won) {
    const modal = document.getElementById("result-modal");
    if (!modal) return;
    const elapsed = Math.round((Date.now() - gameStartTime) / 1000);
    const acc = playerShotsFired ? Math.round((playerHitsLanded / playerShotsFired) * 100) : 0;
    const stats = loadStats();
    document.getElementById("result-title").textContent = won ? "Victory!" : "Defeat";
    let sub = won ? "Your fleet destroyed the enemy." : "The AI took the seas.";
    if (won && stats.streak > 1 && stats.streak === stats.bestStreak) sub = `New best streak: ${stats.streak}!`;
    if (dailyMode) sub = (won ? "Daily complete — " : "Daily failed — ") + sub;
    document.getElementById("result-sub").textContent = sub;
    const icon = modal.querySelector(".result-icon");
    icon.className = "result-icon" + (won ? "" : " defeat");
    icon.querySelector("i").className = won ? "fa-solid fa-trophy" : "fa-solid fa-skull-crossbones";
    document.getElementById("result-shots").textContent = playerShotsFired;
    document.getElementById("result-acc").textContent = acc + "%";
    document.getElementById("result-time").textContent =
        `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
    lastResultSummary = {
        won,
        shots: playerShotsFired,
        acc,
        time: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`,
        difficulty,
        salvoMode,
        dailyMode
    };
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.getElementById("restart").style.display = "none";
    modalPreviousFocus = document.activeElement;
    const restartBtn = document.getElementById("result-restart");
    setTimeout(() => restartBtn?.focus(), 30);
    pulseRestartButton("result-restart");
}

function hideResultModal() {
    const modal = document.getElementById("result-modal");
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if (modalPreviousFocus && typeof modalPreviousFocus.focus === "function") modalPreviousFocus.focus();
    modalPreviousFocus = null;
}

async function shareResult() {
    if (!lastResultSummary) return;
    const r = lastResultSummary;
    const text = `Batman Battleship — ${r.won ? "Victory" : "Defeat"}\n` +
        `Diff: ${r.difficulty}${r.salvoMode ? " · Salvo" : ""}${r.dailyMode ? " · Daily" : ""}\n` +
        `Shots ${r.shots} · Acc ${r.acc}% · Time ${r.time}`;
    try {
        if (navigator.share) {
            await navigator.share({ title: "Batman Battleship", text });
            return;
        }
    } catch (err) {
        if (err?.name === "AbortError") return;
    }
    try {
        await navigator.clipboard.writeText(text);
        updateStatus("Result copied to clipboard");
    } catch (err) {
        window.prompt("Copy your result:", text);
    }
}

function initModalA11y() {
    const modal = document.getElementById("result-modal");
    if (!modal) return;
    document.addEventListener("keydown", (e) => {
        if (!modal.classList.contains("open")) return;
        if (e.key === "Escape") {
            e.preventDefault();
            hideResultModal();
            const restart = document.getElementById("restart");
            restart.style.display = "block";
            pulseRestartButton();
            restart.focus();
            return;
        }
        if (e.key !== "Tab") return;
        const focusable = modal.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])");
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    });
    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            hideResultModal();
            const restart = document.getElementById("restart");
            restart.style.display = "block";
            pulseRestartButton();
        }
    });
}

function initControls() {
    const savedDifficulty = bsStore.getItem("battleship-difficulty");
    if (savedDifficulty) difficulty = savedDifficulty;
    document.querySelectorAll(".seg-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.difficulty === difficulty);
        btn.addEventListener("click", () => {
            if (battleActive || dailyMode) return;
            difficulty = btn.dataset.difficulty;
            bsStore.setItem("battleship-difficulty", difficulty);
            document.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
            Sound.click();
        });
    });

    const salvoBtn = document.getElementById("salvo-toggle");
    salvoMode = false;
    if (salvoBtn) {
        salvoBtn.classList.remove("active");
        salvoBtn.setAttribute("aria-pressed", "false");
        salvoBtn.addEventListener("click", () => {
            if (battleActive || dailyMode) return;
            salvoMode = !salvoMode;
            salvoBtn.classList.toggle("active", salvoMode);
            salvoBtn.setAttribute("aria-pressed", String(salvoMode));
            clearSalvoSelection();
            updateSalvoBar();
            Sound.click();
        });
    }

    const noTouchBtn = document.getElementById("notouch-toggle");
    if (noTouchBtn) {
        noTouchMode = bsStore.getItem("battleship-notouch") === "1";
        noTouchBtn.classList.toggle("active", noTouchMode);
        noTouchBtn.setAttribute("aria-pressed", String(noTouchMode));
        noTouchBtn.addEventListener("click", () => {
            if (battleActive || dailyMode) return;
            noTouchMode = !noTouchMode;
            bsStore.setItem("battleship-notouch", noTouchMode ? "1" : "0");
            noTouchBtn.classList.toggle("active", noTouchMode);
            noTouchBtn.setAttribute("aria-pressed", String(noTouchMode));
            Sound.click();
            if (isPlacingShips && playerShips.length) {
                updateStatus(noTouchMode ? "No-touch on — clear & replace if ships touch" : "No-touch off");
            }
        });
    }

    const dailyBtn = document.getElementById("daily-toggle");
    if (dailyBtn) {
        dailyBtn.addEventListener("click", () => {
            if (battleActive) return;
            dailyMode = !dailyMode;
            dailyBtn.classList.toggle("active", dailyMode);
            dailyBtn.setAttribute("aria-pressed", String(dailyMode));
            Sound.click();
            startGame();
        });
    }

    const soundBtn = document.getElementById("sound-toggle");
    if (soundBtn) {
        const savedSound = bsStore.getItem("battleship-sound");
        if (savedSound === "0") {
            soundOn = false;
            soundBtn.classList.remove("active");
            soundBtn.setAttribute("aria-pressed", "false");
            const icon = soundBtn.querySelector("i");
            if (icon) icon.className = "fa-solid fa-volume-xmark";
        }
        soundBtn.addEventListener("click", () => {
            soundOn = !soundOn;
            bsStore.setItem("battleship-sound", soundOn ? "1" : "0");
            soundBtn.classList.toggle("active", soundOn);
            soundBtn.setAttribute("aria-pressed", String(soundOn));
            const icon = soundBtn.querySelector("i");
            if (icon) icon.className = soundOn ? "fa-solid fa-volume-high" : "fa-solid fa-volume-xmark";
            if (soundOn) { Sound.resume(); Sound.click(); }
        });
    }

    const radarBtn = document.getElementById("radar-btn");
    if (radarBtn) {
        radarBtn.addEventListener("click", () => {
            if (!battleActive || gameOver || turnBusy || !isPlayerTurn || radarCharges <= 0) return;
            radarAiming = !radarAiming;
            updateRadarButton();
            updateStatus(radarAiming ? "Radar ready — tap an enemy cell" : "Radar cancelled");
            Sound.click();
        });
    }

    window.addEventListener("pointerdown", () => Sound.resume(), { once: true });
    window.addEventListener("keydown", () => Sound.resume(), { once: true });
}

document.getElementById("restart")?.addEventListener("click", startGame);
document.getElementById("rotate-ship")?.addEventListener("click", () => {
    if (!isPlacingShips) return;
    isHorizontal = !isHorizontal;
    animateRotateButton();
    Sound.rotate();
    const hoveredCell = document.querySelector("#player-grid .ship-preview");
    if (hoveredCell) handlePlayerGridHover({ target: hoveredCell });
});
document.getElementById("auto-place")?.addEventListener("click", autoPlaceFleet);
document.getElementById("result-restart")?.addEventListener("click", startGame);
document.getElementById("undo-ship")?.addEventListener("click", undoLastShip);
document.getElementById("clear-fleet")?.addEventListener("click", clearFleet);
document.getElementById("fire-salvo")?.addEventListener("click", firePlayerSalvo);
document.getElementById("salvo-clear")?.addEventListener("click", () => {
    if (turnBusy || !isPlayerTurn) return;
    clearSalvoSelection();
    updateSalvoBar();
    const need = playerShipsRemaining();
    updateStatus(`Salvo: select ${need} target${need === 1 ? "" : "s"}`);
    Sound.click();
});
document.getElementById("result-share")?.addEventListener("click", shareResult);

let shipOverlayResizeTimer = null;
window.addEventListener("resize", () => {
    clearTimeout(shipOverlayResizeTimer);
    shipOverlayResizeTimer = setTimeout(() => {
        renderShipOverlays("player-grid", playerShips, true);
        renderShipOverlays("ai-grid", aiShips.filter((ship) => ship.isSunk), true);
    }, 120);
});

initThemeSwitcher();
initControls();
initModalA11y();
renderStats();
startGame();
runIntroAnimations();
