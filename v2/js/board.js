// Battleship v2 — board rules (render-agnostic, deterministic).
// Board = a side's own waters (full truth). Intel = what the opponent knows about it.

import { GRID, SHIPS, SHIP_BY_ID } from "./config.js";

export const idx = (x, y) => y * GRID + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID;

const N = GRID * GRID;

function shipCells(x, y, size, horizontal) {
    const cells = [];
    for (let i = 0; i < size; i++) cells.push(horizontal ? { x: x + i, y } : { x, y: y + i });
    return cells;
}

export class Board {
    constructor() {
        this.island = new Array(N).fill(false);
        this.fog = new Array(N).fill(false);
        this.mine = new Array(N).fill(false);
        this.shipAt = new Array(N).fill(-1);
        this.hit = new Array(N).fill(false);
        this.shot = new Array(N).fill(false);
        this.blown = new Array(N).fill(false);
        this.pinged = new Set();
        this.ships = []; // { id, name, size, ability, cells:[{x,y}], horizontal, armor, sunk }
    }

    // ---------- terrain ----------
    generateTerrain(rng, { islands = false, fog = false } = {}) {
        this.island.fill(false);
        this.fog.fill(false);
        if (islands) {
            const clusters = [2, 2, 1];
            for (const size of clusters) {
                let guard = 0;
                while (guard++ < 200) {
                    const x = 1 + Math.floor(rng() * (GRID - 2));
                    const y = 1 + Math.floor(rng() * (GRID - 2));
                    if (this.island[idx(x, y)] || this._islandNear(x, y)) continue;
                    const cells = [{ x, y }];
                    if (size === 2) {
                        const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
                        const [dx, dy] = dirs[Math.floor(rng() * 4)];
                        if (!inBounds(x + dx, y + dy)) continue;
                        cells.push({ x: x + dx, y: y + dy });
                    }
                    cells.forEach((c) => { this.island[idx(c.x, c.y)] = true; });
                    break;
                }
            }
        }
        if (fog) {
            const cx = 1 + Math.floor(rng() * (GRID - 2));
            const cy = 1 + Math.floor(rng() * (GRID - 2));
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) this.fog[idx(cx + dx, cy + dy)] = true;
        }
    }

    _islandNear(x, y) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (inBounds(x + dx, y + dy) && this.island[idx(x + dx, y + dy)]) return true;
        }
        return false;
    }

    publicTerrain() {
        const islands = [];
        const fog = [];
        for (let i = 0; i < N; i++) {
            if (this.island[i]) islands.push(i);
            if (this.fog[i]) fog.push(i);
        }
        return { islands, fog };
    }

    applyPublicTerrain({ islands = [], fog = [] }) {
        this.island.fill(false);
        this.fog.fill(false);
        islands.forEach((i) => { this.island[i] = true; });
        fog.forEach((i) => { this.fog[i] = true; });
    }

    placeMines(rng, count) {
        this.mine.fill(false);
        const open = [];
        for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
            const i = idx(x, y);
            if (this.island[i] || this.shipAt[i] !== -1) continue;
            open.push(i);
        }
        for (let k = 0; k < count && open.length; k++) {
            const j = Math.floor(rng() * open.length);
            this.mine[open[j]] = true;
            open.splice(j, 1);
        }
    }

    // ---------- placement ----------
    canPlace(size, x, y, horizontal, { noTouch = false, ignore = -1 } = {}) {
        const cells = shipCells(x, y, size, horizontal);
        for (const c of cells) {
            if (!inBounds(c.x, c.y)) return false;
            const i = idx(c.x, c.y);
            if (this.island[i] || this.mine[i]) return false;
            if (this.shipAt[i] !== -1 && this.shipAt[i] !== ignore) return false;
        }
        if (noTouch) {
            for (const c of cells) {
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                    const nx = c.x + dx;
                    const ny = c.y + dy;
                    if (!inBounds(nx, ny)) continue;
                    const s = this.shipAt[idx(nx, ny)];
                    if (s !== -1 && s !== ignore) return false;
                }
            }
        }
        return true;
    }

    place(def, x, y, horizontal, opts = {}) {
        if (!this.canPlace(def.size, x, y, horizontal, opts)) return null;
        const ship = {
            id: def.id, name: def.name, size: def.size, ability: def.ability,
            cells: shipCells(x, y, def.size, horizontal), horizontal, armor: 0, sunk: false
        };
        const k = this.ships.length;
        this.ships.push(ship);
        ship.cells.forEach((c) => { this.shipAt[idx(c.x, c.y)] = k; });
        return ship;
    }

    removeLast() {
        const ship = this.ships.pop();
        if (ship) ship.cells.forEach((c) => { this.shipAt[idx(c.x, c.y)] = -1; });
        return ship;
    }

    removeShip(id) {
        const k = this.ships.findIndex((s) => s.id === id);
        if (k === -1) return null;
        const [ship] = this.ships.splice(k, 1);
        this.shipAt.fill(-1);
        this.ships.forEach((s, j) => s.cells.forEach((c) => { this.shipAt[idx(c.x, c.y)] = j; }));
        return ship;
    }

    clearShips() {
        this.ships = [];
        this.shipAt.fill(-1);
    }

    autoPlace(rng, { noTouch = false } = {}) {
        for (let attempt = 0; attempt < 80; attempt++) {
            this.clearShips();
            let ok = true;
            for (const def of SHIPS) {
                let placed = null;
                for (let g = 0; g < 400 && !placed; g++) {
                    placed = this.place(def, Math.floor(rng() * GRID), Math.floor(rng() * GRID), rng() < 0.5, { noTouch });
                }
                if (!placed) { ok = false; break; }
            }
            if (ok) return true;
        }
        if (noTouch) return this.autoPlace(rng, { noTouch: false });
        return false;
    }

    get complete() { return this.ships.length === SHIPS.length; }

    // ---------- state ----------
    shipIndexAt(x, y) { return this.shipAt[idx(x, y)]; }
    isSunk(k) { return this.ships[k]?.sunk; }
    aliveCount() { return this.ships.filter((s) => !s.sunk).length; }
    allSunk() { return this.ships.length > 0 && this.ships.every((s) => s.sunk); }
    shipAlive(id) { const s = this.ships.find((sh) => sh.id === id); return !!s && !s.sunk; }

    damagedCells() {
        const out = [];
        this.ships.forEach((s) => {
            if (s.sunk) return;
            s.cells.forEach((c) => { if (this.hit[idx(c.x, c.y)]) out.push({ x: c.x, y: c.y }); });
        });
        return out;
    }

    isUndamaged(k) {
        const s = this.ships[k];
        return !!s && !s.sunk && s.cells.every((c) => !this.hit[idx(c.x, c.y)]);
    }

    _strike(x, y) {
        const i = idx(x, y);
        if (this.island[i]) return { x, y, r: "blocked" };
        if (this.shot[i]) return { x, y, r: "repeat" };
        const k = this.shipAt[i];
        if (k !== -1) {
            const ship = this.ships[k];
            if (ship.sunk || this.hit[i]) return { x, y, r: "repeat" };
            if (ship.armor > 0) {
                ship.armor--;
                return { x, y, r: "armor", shipId: ship.id };
            }
            this.shot[i] = true;
            this.hit[i] = true;
            if (ship.cells.every((c) => this.hit[idx(c.x, c.y)])) {
                ship.sunk = true;
                return { x, y, r: "sunk", ship: { id: ship.id, name: ship.name, cells: ship.cells.map((c) => ({ ...c })), horizontal: ship.horizontal } };
            }
            return { x, y, r: "hit", shipId: ship.id };
        }
        this.shot[i] = true;
        if (this.mine[i]) {
            this.mine[i] = false;
            this.blown[i] = true;
            return { x, y, r: "mine" };
        }
        return { x, y, r: "miss" };
    }

    // Resolve an incoming attack-type action against this board.
    receive(action) {
        switch (action.type) {
            case "fire": {
                const cells = [];
                (action.cells || []).forEach(({ x, y }) => {
                    if (inBounds(x, y)) cells.push(this._strike(x, y));
                });
                return { type: "fire", cells };
            }
            case "sonar": {
                const r = action.radius || 1;
                const cells = [];
                for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                    const x = action.x + dx;
                    const y = action.y + dy;
                    if (!inBounds(x, y)) continue;
                    const i = idx(x, y);
                    if (this.island[i]) continue;
                    if (this.fog[i]) { cells.push({ x, y, r: "fog" }); continue; }
                    const k = this.shipAt[i];
                    const intact = k !== -1 && !this.hit[i] && !this.ships[k].sunk;
                    if (intact) this.pinged.add(i);
                    cells.push({ x, y, r: intact ? "contact" : "clear" });
                }
                return { type: "sonar", x: action.x, y: action.y, radius: r, cells };
            }
            case "recon": {
                let count = 0;
                let fogged = 0;
                for (let t = 0; t < GRID; t++) {
                    const x = action.axis === "row" ? t : action.index;
                    const y = action.axis === "row" ? action.index : t;
                    const i = idx(x, y);
                    if (this.fog[i]) { fogged++; continue; }
                    const k = this.shipAt[i];
                    if (k !== -1 && !this.hit[i] && !this.ships[k].sunk) {
                        count++;
                        this.pinged.add(i);
                    }
                }
                return { type: "recon", axis: action.axis, index: action.index, count, fogged };
            }
            case "torpedo": {
                let pierce = action.pierce || 1;
                const path = [];
                const hits = [];
                const cleared = [];
                let end = { r: "edge" };
                for (let t = 0; t < GRID; t++) {
                    const x = action.axis === "row" ? t : action.index;
                    const y = action.axis === "row" ? action.index : t;
                    const i = idx(x, y);
                    path.push({ x, y });
                    if (this.island[i]) { end = { x, y, r: "blocked" }; break; }
                    if (this.mine[i]) {
                        this.mine[i] = false;
                        this.blown[i] = true;
                        this.shot[i] = true;
                        end = { x, y, r: "mine-cleared" };
                        hits.push({ x, y, r: "mine-cleared" });
                        break;
                    }
                    const k = this.shipAt[i];
                    if (k !== -1 && !this.hit[i] && !this.ships[k].sunk) {
                        const res = this._strike(x, y);
                        hits.push(res);
                        if (res.r === "armor") { end = { x, y, r: "armor" }; break; }
                        pierce--;
                        if (pierce <= 0) { end = { x, y, r: res.r }; break; }
                        continue;
                    }
                    if (k === -1 && !this.shot[i]) cleared.push({ x, y });
                }
                return { type: "torpedo", axis: action.axis, index: action.index, path, hits, cleared, end };
            }
            default:
                return { type: action.type, invalid: true };
        }
    }

    repair(x, y) {
        const i = idx(x, y);
        const k = this.shipAt[i];
        if (k === -1 || !this.hit[i] || this.ships[k].sunk) return null;
        this.hit[i] = false;
        this.shot[i] = false;
        return { x, y, shipId: this.ships[k].id };
    }

    moveTargets(k, dir, noTouch = false) {
        const ship = this.ships[k];
        if (!ship || !this.isUndamaged(k)) return null;
        const cells = ship.cells.map((c) => (ship.horizontal ? { x: c.x + dir, y: c.y } : { x: c.x, y: c.y + dir }));
        for (const c of cells) {
            if (!inBounds(c.x, c.y)) return null;
            const i = idx(c.x, c.y);
            if (this.island[i] || this.mine[i] || this.shot[i]) return null;
            if (this.shipAt[i] !== -1 && this.shipAt[i] !== k) return null;
        }
        if (noTouch) {
            const start = cells[0];
            if (!this.canPlace(ship.size, start.x, start.y, ship.horizontal, { noTouch: true, ignore: k })) return null;
        }
        return cells;
    }

    moveShip(k, dir, noTouch = false) {
        const cells = this.moveTargets(k, dir, noTouch);
        if (!cells) return null;
        const ship = this.ships[k];
        const from = ship.cells;
        from.forEach((c) => { this.shipAt[idx(c.x, c.y)] = -1; });
        cells.forEach((c) => { this.shipAt[idx(c.x, c.y)] = k; });
        ship.cells = cells;
        from.forEach((c) => this.pinged.delete(idx(c.x, c.y)));
        return { shipId: ship.id, index: k, from, to: cells };
    }

    pingedShips() {
        const out = new Set();
        this.pinged.forEach((i) => {
            const k = this.shipAt[i];
            if (k !== -1 && this.isUndamaged(k)) out.add(k);
        });
        return [...out];
    }

    // What this side sees on its own waters (for rendering).
    homeStates() {
        const out = new Array(N).fill("none");
        for (let i = 0; i < N; i++) {
            if (this.island[i]) continue;
            if (this.blown[i]) { out[i] = "mine"; continue; }
            const k = this.shipAt[i];
            if (k !== -1) out[i] = this.ships[k].sunk ? "sunk" : this.hit[i] ? "hit" : "none";
            else if (this.shot[i]) out[i] = "miss";
        }
        return out;
    }

    serialize() {
        return {
            island: this.island.slice(), fog: this.fog.slice(), mine: this.mine.slice(),
            hit: this.hit.slice(), shot: this.shot.slice(), blown: this.blown.slice(),
            ships: this.ships.map((s) => ({ id: s.id, cells: s.cells.map((c) => ({ ...c })), horizontal: s.horizontal, armor: s.armor, sunk: s.sunk }))
        };
    }

    static from(data) {
        const b = new Board();
        b.island = data.island.slice();
        b.fog = data.fog.slice();
        b.mine = data.mine.slice();
        b.hit = data.hit.slice();
        b.shot = data.shot.slice();
        b.blown = (data.blown || new Array(N).fill(false)).slice();
        data.ships.forEach((s, k) => {
            const def = SHIP_BY_ID[s.id];
            b.ships.push({ ...def, cells: s.cells.map((c) => ({ ...c })), horizontal: s.horizontal, armor: s.armor, sunk: s.sunk });
            s.cells.forEach((c) => { b.shipAt[idx(c.x, c.y)] = k; });
        });
        return b;
    }
}

// Knowledge of the opponent's waters.
export class Intel {
    constructor(terrain = { islands: [], fog: [] }) {
        this.state = new Array(N).fill("unknown");
        this.island = new Array(N).fill(false);
        this.fog = new Array(N).fill(false);
        terrain.islands.forEach((i) => { this.island[i] = true; });
        terrain.fog.forEach((i) => { this.fog[i] = true; });
        this.lines = { row: new Array(GRID).fill(null), col: new Array(GRID).fill(null) };
        this.sunk = [];
    }

    get(x, y) { return this.state[idx(x, y)]; }

    shootable(x, y) {
        if (!inBounds(x, y)) return false;
        const i = idx(x, y);
        if (this.island[i]) return false;
        const s = this.state[i];
        return s === "unknown" || s === "contact" || s === "clear";
    }

    openHits() {
        const out = [];
        for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (this.state[idx(x, y)] === "hit") out.push({ x, y });
        return out;
    }

    remainingShips() {
        const sunkIds = new Set(this.sunk.map((s) => s.id));
        return SHIPS.filter((s) => !sunkIds.has(s.id));
    }

    _strikeResult(c) {
        const i = idx(c.x, c.y);
        switch (c.r) {
            case "miss": this.state[i] = "miss"; break;
            case "hit": this.state[i] = "hit"; break;
            case "mine": case "mine-cleared": this.state[i] = "mine"; break;
            case "armor": this.state[i] = "contact"; break;
            case "sunk":
                c.ship.cells.forEach((p) => { this.state[idx(p.x, p.y)] = "sunk"; });
                if (!this.sunk.some((s) => s.id === c.ship.id)) this.sunk.push(c.ship);
                break;
            default: break;
        }
    }

    apply(result) {
        if (!result) return;
        switch (result.type) {
            case "fire":
                result.cells.forEach((c) => this._strikeResult(c));
                break;
            case "sonar":
                result.cells.forEach((c) => {
                    const i = idx(c.x, c.y);
                    const s = this.state[i];
                    if (c.r === "contact" && (s === "unknown" || s === "clear" || s === "contact")) this.state[i] = "contact";
                    if (c.r === "clear" && (s === "unknown" || s === "contact")) this.state[i] = "clear";
                });
                break;
            case "recon":
                this.lines[result.axis][result.index] = result.count;
                if (result.count === 0) {
                    for (let t = 0; t < GRID; t++) {
                        const x = result.axis === "row" ? t : result.index;
                        const y = result.axis === "row" ? result.index : t;
                        const i = idx(x, y);
                        if (this.fog[i] || this.island[i]) continue;
                        if (this.state[i] === "unknown" || this.state[i] === "contact") this.state[i] = "clear";
                    }
                }
                break;
            case "torpedo":
                result.cleared.forEach((c) => {
                    const i = idx(c.x, c.y);
                    if (this.state[i] === "unknown" || this.state[i] === "contact") this.state[i] = "clear";
                });
                result.hits.forEach((c) => this._strikeResult(c));
                break;
            case "repair": {
                const i = idx(result.x, result.y);
                if (this.state[i] === "hit") this.state[i] = "contact";
                break;
            }
            default: break;
        }
    }

    serialize() {
        return { state: this.state.slice(), island: this.island.slice(), fog: this.fog.slice(), lines: JSON.parse(JSON.stringify(this.lines)), sunk: JSON.parse(JSON.stringify(this.sunk)) };
    }
}
