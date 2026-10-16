// Battleship v2 — AI. Works only from its Intel (what it legitimately knows),
// plus its own board for defensive choices (repairs, evasive maneuvers).

import { GRID } from "./config.js";
import { idx, inBounds } from "./board.js";
import { shuffle, sleep } from "./util.js";

const BLOCKING = new Set(["miss", "sunk", "mine", "clear"]);

// Probability density of ship sections over the opponent's waters.
export function heatMap(intel) {
    const heat = new Float32Array(GRID * GRID);
    const ships = intel.remainingShips();
    const hits = intel.openHits();
    const targeting = hits.length > 0;

    const accumulate = (requireHit) => {
        let total = 0;
        for (const ship of ships) {
            for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
                for (const h of [true, false]) {
                    let hc = 0;
                    let cc = 0;
                    let ok = true;
                    for (let k = 0; k < ship.size; k++) {
                        const cx = h ? x + k : x;
                        const cy = h ? y : y + k;
                        if (!inBounds(cx, cy)) { ok = false; break; }
                        const i = idx(cx, cy);
                        if (intel.island[i]) { ok = false; break; }
                        const s = intel.state[i];
                        if (BLOCKING.has(s)) { ok = false; break; }
                        if (s === "hit") hc++;
                        else if (s === "contact") cc++;
                    }
                    if (!ok || (requireHit && hc === 0)) continue;
                    const w = (1 + hc * 24) * (1 + cc * 3);
                    for (let k = 0; k < ship.size; k++) {
                        const cx = h ? x + k : x;
                        const cy = h ? y : y + k;
                        const i = idx(cx, cy);
                        if (intel.state[i] === "unknown" || intel.state[i] === "contact") {
                            heat[i] += w;
                            total += w;
                        }
                    }
                }
            }
        }
        return total;
    };

    if (accumulate(targeting) === 0 && targeting) accumulate(false);

    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        const i = idx(x, y);
        const r = intel.lines.row[y];
        const c = intel.lines.col[x];
        if (r) heat[i] *= 1 + 0.12 * r;
        if (c) heat[i] *= 1 + 0.12 * c;
    }
    return heat;
}

function shootableCells(intel, excluded) {
    const out = [];
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        if (!intel.shootable(x, y)) continue;
        if (excluded?.has(idx(x, y))) continue;
        out.push({ x, y });
    }
    return out;
}

function bestByHeat(heat, intel, excluded, rng) {
    let best = [];
    let score = -1;
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        if (!intel.shootable(x, y) || excluded?.has(idx(x, y))) continue;
        const v = heat[idx(x, y)];
        if (v > score) { score = v; best = [{ x, y }]; }
        else if (v === score) best.push({ x, y });
    }
    if (!best.length) return null;
    return best[Math.floor(rng() * best.length)];
}

// Normal-mode hunt: extend lines of hits, then neighbors of hits.
function huntCandidates(intel, excluded) {
    const hits = intel.openHits();
    const isHit = (x, y) => inBounds(x, y) && intel.get(x, y) === "hit";
    const ok = (x, y) => intel.shootable(x, y) && !excluded?.has(idx(x, y)) && intel.get(x, y) !== "clear";
    const strong = [];
    const weak = [];
    for (const h of hits) {
        if (isHit(h.x - 1, h.y) || isHit(h.x + 1, h.y)) {
            let a = h.x; while (isHit(a - 1, h.y)) a--;
            let b = h.x; while (isHit(b + 1, h.y)) b++;
            if (ok(a - 1, h.y)) strong.push({ x: a - 1, y: h.y });
            if (ok(b + 1, h.y)) strong.push({ x: b + 1, y: h.y });
        }
        if (isHit(h.x, h.y - 1) || isHit(h.x, h.y + 1)) {
            let a = h.y; while (isHit(h.x, a - 1)) a--;
            let b = h.y; while (isHit(h.x, b + 1)) b++;
            if (ok(h.x, a - 1)) strong.push({ x: h.x, y: a - 1 });
            if (ok(h.x, b + 1)) strong.push({ x: h.x, y: b + 1 });
        }
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
            if (ok(h.x + dx, h.y + dy)) weak.push({ x: h.x + dx, y: h.y + dy });
        });
    }
    return strong.length ? strong : weak;
}

function contacts(intel, excluded) {
    const out = [];
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        if (intel.get(x, y) === "contact" && !excluded?.has(idx(x, y))) out.push({ x, y });
    }
    return out;
}

export class AIAgent {
    constructor({ difficulty = "normal", pers = {}, rng = Math.random, speed = 1 } = {}) {
        this.kind = "ai";
        this.difficulty = difficulty;
        this.pers = { aggression: 0.5, repair: 0.4, evade: 0.3, think: 650, ...pers };
        this.rng = rng;
        this.speed = speed;
    }

    placeFleet(board, rules) {
        const noTouch = rules.noTouch || (this.difficulty === "hard" && this.rng() < 0.7);
        board.autoPlace(this.rng, { noTouch });
    }

    async chooseAction(game, i) {
        await sleep(this.pers.think * this.speed);
        return this.decide(game, i);
    }

    pickShot(intel, heat, excluded) {
        const r = this.rng;
        if (this.difficulty === "hard") return bestByHeat(heat, intel, excluded, r);
        if (this.difficulty === "normal") {
            const hunt = huntCandidates(intel, excluded);
            if (hunt.length) return hunt[Math.floor(r() * hunt.length)];
            const ct = contacts(intel, excluded);
            if (ct.length) return ct[Math.floor(r() * ct.length)];
            const open = shootableCells(intel, excluded).filter((c) => intel.get(c.x, c.y) !== "clear");
            const parity = open.filter((c) => (c.x + c.y) % 2 === 0);
            const pool = parity.length ? parity : open.length ? open : shootableCells(intel, excluded);
            return pool.length ? pool[Math.floor(r() * pool.length)] : null;
        }
        // easy
        if (r() < 0.5) {
            const hunt = huntCandidates(intel, excluded);
            if (hunt.length) return hunt[Math.floor(r() * hunt.length)];
        }
        if (r() < 0.4) {
            const ct = contacts(intel, excluded);
            if (ct.length) return ct[Math.floor(r() * ct.length)];
        }
        const open = shootableCells(intel, excluded);
        return open.length ? open[Math.floor(r() * open.length)] : null;
    }

    decide(game, i) {
        const side = game.sides[i];
        const intel = side.intel;
        const rules = game.rules;
        const r = this.rng;
        const p = this.pers;
        const skill = this.difficulty === "easy" ? 0.35 : this.difficulty === "normal" ? 0.75 : 1;

        // Defensive choices.
        if (side.board && game.canUse(i, "repair") && r() < p.repair * skill) {
            const dmg = side.board.damagedCells();
            if (dmg.length) {
                const c = dmg[Math.floor(r() * dmg.length)];
                return { type: "repair", ability: "repair", x: c.x, y: c.y };
            }
        }
        if (side.board && game.canManeuver(i) && r() < p.evade * skill) {
            const pinged = side.board.pingedShips();
            for (const k of shuffle(r, pinged)) {
                for (const dir of shuffle(r, [1, -1])) {
                    if (side.board.moveTargets(k, dir, rules.noTouch)) return { type: "move", ship: k, dir };
                }
            }
        }

        const heat = heatMap(intel);
        const hits = intel.openHits();

        // Offensive abilities.
        if (rules.abilities && r() < p.aggression * skill + (this.difficulty === "hard" ? 0.15 : 0)) {
            if (hits.length && game.canUse(i, "barrage")) {
                const c = bestByHeat(heat, intel, null, r);
                if (c) {
                    const cells = [c, { x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 }]
                        .filter((q) => inBounds(q.x, q.y));
                    if (cells.filter((q) => intel.shootable(q.x, q.y)).length >= 3) {
                        return { type: "fire", kind: "barrage", ability: "barrage", cells };
                    }
                }
            }
            if (!hits.length) {
                const opts = [];
                if (game.canUse(i, "sonar")) {
                    let best = null;
                    for (let y = 1; y < GRID - 1; y++) for (let x = 1; x < GRID - 1; x++) {
                        let v = 0;
                        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                            const q = idx(x + dx, y + dy);
                            if (!intel.fog[q] && intel.state[q] === "unknown") v += heat[q];
                        }
                        if (!best || v > best.v) best = { v, x, y };
                    }
                    if (best && best.v > 0) opts.push({ v: best.v, action: { type: "sonar", ability: "sonar", x: best.x, y: best.y } });
                }
                const lineScore = (axis, index, untilIsland, skipFog) => {
                    let v = 0;
                    for (let t = 0; t < GRID; t++) {
                        const x = axis === "row" ? t : index;
                        const y = axis === "row" ? index : t;
                        const q = idx(x, y);
                        if (intel.island[q]) { if (untilIsland) break; continue; }
                        if (skipFog && intel.fog[q]) continue;
                        if (intel.state[q] === "unknown" || intel.state[q] === "contact") v += heat[q];
                    }
                    return v;
                };
                if (game.canUse(i, "torpedo")) {
                    let best = null;
                    ["row", "col"].forEach((axis) => {
                        for (let k = 0; k < GRID; k++) {
                            const v = lineScore(axis, k, true, false) * 0.9;
                            if (!best || v > best.v) best = { v, axis, index: k };
                        }
                    });
                    if (best && best.v > 0) opts.push({ v: best.v, action: { type: "torpedo", ability: "torpedo", axis: best.axis, index: best.index } });
                }
                if (game.canUse(i, "recon")) {
                    let best = null;
                    ["row", "col"].forEach((axis) => {
                        for (let k = 0; k < GRID; k++) {
                            if (intel.lines[axis][k] !== null) continue;
                            const v = lineScore(axis, k, false, true) * 0.55;
                            if (!best || v > best.v) best = { v, axis, index: k };
                        }
                    });
                    if (best && best.v > 0) opts.push({ v: best.v, action: { type: "recon", ability: "recon", axis: best.axis, index: best.index } });
                }
                if (opts.length) {
                    opts.sort((a, b) => b.v - a.v);
                    return opts[0].action;
                }
            }
        }

        // Regular fire (salvo-aware).
        const n = game.shotsFor(i);
        const excluded = new Set();
        const cells = [];
        let work = heat;
        for (let k = 0; k < n; k++) {
            const c = this.pickShot(intel, work, excluded);
            if (!c) break;
            excluded.add(idx(c.x, c.y));
            cells.push(c);
        }
        if (!cells.length) return { type: "pass" };
        return { type: "fire", kind: cells.length > 1 ? "salvo" : "shot", cells };
    }
}
