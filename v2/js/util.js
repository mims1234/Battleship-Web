// Small shared helpers: seeded RNG, safe storage, event emitter, timing.

export function mulberry32(seed) {
    let t = seed >>> 0;
    return function rng() {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), t | 1);
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

export function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export function randomSeed() {
    if (window.crypto?.getRandomValues) {
        const a = new Uint32Array(1);
        window.crypto.getRandomValues(a);
        return a[0];
    }
    return Math.floor(Math.random() * 4294967296);
}

export function dateKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
}

export function shuffle(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export const coordLabel = (x, y) => `${String.fromCharCode(65 + x)}${y + 1}`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Emitter {
    constructor() { this._h = {}; }
    on(type, fn) { (this._h[type] ||= []).push(fn); return () => this.off(type, fn); }
    off(type, fn) { this._h[type] = (this._h[type] || []).filter((f) => f !== fn); }
    emit(type, payload) { (this._h[type] || []).slice().forEach((fn) => fn(payload)); }
}

// localStorage wrapper that never throws and falls back to memory.
export const store = (() => {
    const mem = {};
    let ok = true;
    try {
        localStorage.setItem("__bsv2__", "1");
        localStorage.removeItem("__bsv2__");
    } catch (e) { ok = false; }
    function get(key, fallback = null) {
        let raw = null;
        if (ok) { try { raw = localStorage.getItem(key); } catch (e) { raw = null; } }
        else raw = key in mem ? mem[key] : null;
        if (raw === null || raw === undefined) return fallback;
        try { return JSON.parse(raw); } catch (e) { return fallback; }
    }
    function set(key, value) {
        const raw = JSON.stringify(value);
        if (ok) { try { localStorage.setItem(key, raw); return; } catch (e) { /* fall through */ } }
        mem[key] = raw;
    }
    function getRaw(key) {
        if (ok) { try { return localStorage.getItem(key); } catch (e) { return null; } }
        return key in mem ? mem[key] : null;
    }
    function setRaw(key, value) {
        if (ok) { try { localStorage.setItem(key, value); return; } catch (e) { /* fall through */ } }
        mem[key] = value;
    }
    return { get, set, getRaw, setRaw };
})();

export const prefersReducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export const isTouch = () =>
    window.matchMedia?.("(pointer: coarse)").matches ?? ("ontouchstart" in window);
