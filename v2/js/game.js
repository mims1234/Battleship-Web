// Battleship v2 — turn controller. Symmetric two-sided game; each side has an agent
// (human UI, AI, remote peer, or scripted replay). Rendering happens through `presenter`.

import { ABILITIES, MANEUVER_COOLDOWN, SHIPS } from "./config.js";
import { Emitter } from "./util.js";

const ATTACKS = new Set(["fire", "sonar", "recon", "torpedo"]);

export class HumanAgent {
    constructor() { this.kind = "human"; this._resolve = null; }
    chooseAction() {
        return new Promise((resolve) => { this._resolve = resolve; });
    }
    get waiting() { return !!this._resolve; }
    submit(action) {
        const r = this._resolve;
        this._resolve = null;
        if (r) r(action);
    }
}

export class ScriptedAgent {
    constructor(actions) { this.kind = "scripted"; this.actions = actions.slice(); }
    async chooseAction() { return this.actions.shift() || { type: "pass" }; }
}

export function effectiveCooldown(abilityId, mods) {
    const base = ABILITIES[abilityId].cooldown;
    return Math.max(2, base - (mods?.has("quickCrew") ? 1 : 0));
}

export class Game extends Emitter {
    /**
     * sides: [{ name, kind, agent, board, intel, mods:Set }]
     * board: own Board (null when remote) — intel: knowledge of the opponent.
     */
    constructor({ rules, sides, presenter, first = 0, transport = null }) {
        super();
        this.rules = rules;
        this.presenter = presenter || (async () => {});
        this.transport = transport;
        this.first = first;
        this.current = first;
        this.over = false;
        this.aborted = false;
        this.winner = null;
        this.turn = 0;
        this.startedAt = Date.now();
        this.log = [];
        this.sides = sides.map((s) => {
            const mods = s.mods || new Set();
            const cooldowns = {};
            Object.keys(ABILITIES).forEach((a) => {
                cooldowns[a] = mods.has("readyStart") ? 0 : Math.ceil(effectiveCooldown(a, mods) / 2);
            });
            return {
                ...s, mods, cooldowns, moveCd: 1, skip: 0, turns: 0,
                stats: { shots: 0, hits: 0, abilities: 0, repairs: 0, moves: 0, minesHit: 0, torpedoSinks: 0, bestBarrage: 0, deflected: 0 }
            };
        });
        this.snapshot = null;
    }

    // ----- queries -----
    other(i) { return 1 - i; }

    aliveCount(i) {
        const s = this.sides[i];
        if (s.board) return s.board.aliveCount();
        return SHIPS.length - this.sides[1 - i].intel.sunk.length;
    }

    shipAlive(i, shipId) {
        const s = this.sides[i];
        if (s.board) return s.board.shipAlive(shipId);
        return !this.sides[1 - i].intel.sunk.some((x) => x.id === shipId);
    }

    shotsFor(i) {
        const s = this.sides[i];
        let n = this.rules.salvo ? Math.max(1, this.aliveCount(i)) : 1;
        if (s.mods.has("openingVolley") && s.turns <= 1) n = Math.max(n, 3);
        return n;
    }

    canUse(i, abilityId) {
        if (!this.rules.abilities) return false;
        const s = this.sides[i];
        const ab = ABILITIES[abilityId];
        if (!ab || s.cooldowns[abilityId] > 0) return false;
        if (!this.shipAlive(i, ab.ship)) return false;
        if (abilityId === "repair" && s.board && s.board.damagedCells().length === 0) return false;
        return true;
    }

    canManeuver(i) {
        const s = this.sides[i];
        return !!this.rules.maneuver && s.moveCd === 0;
    }

    defeated(i) {
        const s = this.sides[i];
        if (s.board) return s.board.allSunk();
        return this.sides[1 - i].intel.sunk.length >= SHIPS.length;
    }

    // ----- lifecycle -----
    abort() {
        this.aborted = true;
        this.sides.forEach((s) => { if (s.agent?.kind === "human") s.agent.submit({ type: "pass" }); });
    }

    async present(ev) {
        if (this.aborted) return;
        this.emit("event", ev);
        try { await this.presenter(ev, this); } catch (err) { console.error(err); }
    }

    takeSnapshot() {
        this.snapshot = {
            rules: { ...this.rules },
            first: this.first,
            sides: this.sides.map((s) => ({
                name: s.name, kind: s.kind, mods: [...s.mods],
                board: s.board ? s.board.serialize() : null,
                intel: s.intel.serialize()
            }))
        };
    }

    async run() {
        this.takeSnapshot();
        await this.present({ type: "battle-start", first: this.first });
        for (let i = 0; i < 2; i++) {
            if (this.sides[i].mods.has("scoutPlane")) {
                await this.perform(i, { type: "sonar", x: 4, y: 4, free: true });
            }
        }
        while (!this.over && !this.aborted) {
            const i = this.current;
            const side = this.sides[i];
            if (side.skip > 0) {
                side.skip--;
                await this.present({ type: "skip", side: i });
                this.current = 1 - i;
                continue;
            }
            side.turns++;
            this.turn++;
            if (side.turns > 1) {
                Object.keys(side.cooldowns).forEach((a) => { if (side.cooldowns[a] > 0) side.cooldowns[a]--; });
                if (side.moveCd > 0) side.moveCd--;
            }
            await this.present({ type: "turn", side: i });
            if (this.aborted) return;
            const action = await side.agent.chooseAction(this, i);
            if (this.aborted) return;
            await this.perform(i, action || { type: "pass" });
            if (this.aborted) return;
            if (this.checkOver()) break;
            this.current = 1 - i;
        }
        if (this.over && !this.aborted) await this.present({ type: "over", winner: this.winner });
    }

    checkOver() {
        for (let i = 0; i < 2; i++) {
            if (this.defeated(i)) {
                this.over = true;
                this.winner = 1 - i;
                return true;
            }
        }
        return false;
    }

    // Resolve an attack-type action against side `t`'s waters (locally or over the network).
    async resolveAgainst(t, action) {
        const target = this.sides[t];
        if (target.board) {
            const res = target.board.receive(action);
            if (this.sides[1 - t].kind === "remote") this.transport?.send({ t: "result", result: res });
            return res;
        }
        if (target.kind === "remote" && this.transport) return this.transport.request(action);
        return null;
    }

    async perform(i, action) {
        const actor = this.sides[i];
        const t = 1 - i;
        const target = this.sides[t];
        const st = actor.stats;
        let result = null;

        // Local agents can't spend abilities that aren't ready (the remote peer validates its own).
        const wanted = action.ability || ({ sonar: "sonar", recon: "recon", torpedo: "torpedo", repair: "repair" })[action.type];
        if (wanted && !action.free && actor.kind !== "remote" && !this.canUse(i, wanted)) return this.perform(i, { type: "pass" });
        if (action.type === "move" && actor.kind !== "remote" && !this.canManeuver(i)) return this.perform(i, { type: "pass" });

        if (action.type === "sonar") action.radius = actor.mods.has("wideSonar") ? 2 : 1;
        if (action.type === "torpedo") action.pierce = actor.mods.has("piercingTorpedo") ? 2 : 1;

        if (ATTACKS.has(action.type)) {
            if (action.type === "fire") {
                action.cells = (action.cells || []).filter((c) => actor.intel.shootable(c.x, c.y) || target.kind === "remote");
                if (!action.cells.length) action.cells = [];
            }
            result = await this.resolveAgainst(t, action);
            if (this.aborted || !result) return;
            actor.intel.apply(result);
            const strikes = result.type === "fire" ? result.cells : result.type === "torpedo" ? result.hits : [];
            const landed = strikes.filter((c) => c.r === "hit" || c.r === "sunk").length;
            if (result.type === "fire") {
                st.shots += result.cells.filter((c) => c.r !== "blocked" && c.r !== "repeat").length;
                st.hits += landed;
                if (action.kind === "barrage") st.bestBarrage = Math.max(st.bestBarrage, landed);
            } else if (result.type === "torpedo") {
                st.hits += landed;
                if (strikes.some((c) => c.r === "sunk")) st.torpedoSinks++;
            }
            target.stats.deflected += strikes.filter((c) => c.r === "armor").length;
            if (strikes.some((c) => c.r === "mine")) {
                actor.skip = 1;
                st.minesHit++;
            }
        } else if (action.type === "repair") {
            if (actor.board) {
                const res = actor.board.repair(action.x, action.y);
                if (!res) return this.perform(i, { type: "pass" });
                if (target.kind === "remote") this.transport?.send({ t: "action", action: { type: "repair", x: action.x, y: action.y } });
            }
            result = { type: "repair", x: action.x, y: action.y };
            target.intel.apply(result);
            st.repairs++;
        } else if (action.type === "move") {
            if (actor.board) {
                const res = actor.board.moveShip(action.ship, action.dir, this.rules.noTouch);
                if (!res) return this.perform(i, { type: "pass" });
                result = { type: "move", ...res };
                if (target.kind === "remote") this.transport?.send({ t: "action", action: { type: "move" } });
            } else {
                result = { type: "move" };
            }
            actor.moveCd = MANEUVER_COOLDOWN;
            st.moves++;
        } else {
            result = { type: "pass" };
            if (actor.kind !== "remote" && target.kind === "remote" && !action.free) this.transport?.send({ t: "action", action: { type: "pass" } });
        }

        const abilityId = action.ability || (action.type === "fire" && action.kind === "barrage" ? "barrage" : null)
            || ({ sonar: "sonar", recon: "recon", torpedo: "torpedo", repair: "repair" })[action.type];
        if (abilityId && ABILITIES[abilityId] && !action.free) {
            actor.cooldowns[abilityId] = effectiveCooldown(abilityId, actor.mods);
            st.abilities++;
        }

        if (!action.free) this.log.push({ side: i, action: JSON.parse(JSON.stringify(action)) });
        await this.present({ type: "action", side: i, action, result });
    }
}
