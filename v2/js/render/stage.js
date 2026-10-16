// Battleship v2 — 3D stage: ocean, boards, fleets, markers, camera, and battle cinematics.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GRID, THEMES, SHIP_BY_ID } from "../config.js";
import { createOcean, createSky, waveAt } from "./ocean.js";
import { FX, Tweens, ease } from "./fx.js";
import {
    buildShip, shipMaterials, buildIsland, terrainMaterials, buildMine,
    gridTexture, cellTexture, textSprite, markerKit
} from "./models.js";

const BOARD_X = { home: -7, enemy: 7 };
const rand = (a, b) => a + Math.random() * (b - a);

export class Stage {
    constructor(canvas, { quality = "high", theme = "atlantic", reducedMotion = false, weather = "auto" } = {}) {
        this.canvas = canvas;
        this.quality = quality;
        this.themeName = theme;
        this.reducedMotion = reducedMotion;
        this.weatherMode = weather;
        this.time = 0;
        this.timeScale = 1;
        this.slowmo = 0;
        this.view = "menu";
        this.cameraMode = "auto";
        this.insets = { top: 0, bottom: 0 };
        this.shakeAmp = 0;
        this.boards = {};
        this.onThunder = null;
        this.onImpact = null;
        this.listeners = [];
        this.running = false;
    }

    async init() {
        const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.quality !== "low", powerPreference: "high-performance" });
        r.toneMapping = THREE.ACESFilmicToneMapping;
        r.toneMappingExposure = 0.9;
        r.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer = r;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1200);
        this.camera.position.set(0, 14, 24);
        this.camPos = this.camera.position.clone();
        this.camTarget = new THREE.Vector3();
        this.curTarget = new THREE.Vector3();

        this.sky = createSky();
        this.scene.add(this.sky);
        this.ocean = createOcean(this.quality === "low" ? 110 : 220);
        this.scene.add(this.ocean);
        this.scene.fog = new THREE.Fog(0x274e64, 45, 150);

        this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x0d1a22, 1.2);
        this.scene.add(this.hemi);
        this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
        this.scene.add(this.sun);
        this.scene.add(this.sun.target);

        this.fx = new FX(this.scene, this.quality);
        this.tweens = new Tweens();
        this.markerKit = markerKit();
        this.terrainMats = terrainMaterials();
        this.tex = { border: cellTexture("border"), fill: cellTexture("fill"), cross: cellTexture("cross"), soft: cellTexture("soft") };
        this.pmrem = new THREE.PMREMGenerator(r);
        this.raycaster = new THREE.Raycaster();

        try { await document.fonts?.load("700 40px Orbitron"); } catch (e) { /* ignore */ }

        ["home", "enemy"].forEach((key) => this._createBoard(key));
        this._createRain();
        this.setTheme(this.themeName);
        this._setupComposer();
        this.resize();
        this._onResize = () => this.resize();
        window.addEventListener("resize", this._onResize);
        this.clock = new THREE.Clock();
        this.running = true;
        r.setAnimationLoop(() => this._frame());
    }

    _setupComposer() {
        this.composer = null;
        if (this.quality === "low") return;
        const c = new EffectComposer(this.renderer);
        c.addPass(new RenderPass(this.scene, this.camera));
        this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.4, 0.9);
        c.addPass(this.bloom);
        c.addPass(new OutputPass());
        this.composer = c;
    }

    setQuality(q) {
        if (q === this.quality) return;
        this.quality = q;
        this._setupComposer();
        this.fx.density = q === "low" ? 0.5 : 1;
        this.resize();
    }

    resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const pr = Math.min(window.devicePixelRatio || 1, this.quality === "high" ? 2 : 1.25);
        this.renderer.setPixelRatio(pr);
        this.renderer.setSize(w, h, false);
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
        if (this.composer) {
            this.composer.setPixelRatio(pr);
            this.composer.setSize(w, h);
        }
        this.camera.aspect = w / h;
        this._applyViewOffset();
        this.fx.setScale((h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))));
        this._computeCamera(true);
    }

    setInsets(top, bottom) {
        this.insets = { top, bottom };
        this._applyViewOffset();
        this._computeCamera(false);
    }

    _applyViewOffset() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const dy = (this.insets.bottom - this.insets.top) / 2;
        if (Math.abs(dy) > 0.5) this.camera.setViewOffset(w, h, 0, dy, w, h);
        else this.camera.clearViewOffset();
        this.camera.updateProjectionMatrix();
    }

    // ---------- theme / weather ----------
    setTheme(name) {
        this.themeName = THEMES[name] ? name : "atlantic";
        const t = THEMES[this.themeName];
        this.theme = t;
        const ou = this.ocean.material.uniforms;
        const su = this.sky.material.uniforms;
        const sunDir = new THREE.Vector3(...t.sky.sunDir).normalize();
        ou.uDeep.value.setHex(t.water.deep);
        ou.uShallow.value.setHex(t.water.shallow);
        ou.uFoam.value.setHex(t.water.foam);
        ou.uZenith.value.setHex(t.sky.zenith);
        ou.uHorizon.value.setHex(t.sky.horizon);
        ou.uSun.value.setHex(t.sky.sun);
        ou.uSunDir.value.copy(sunDir);
        ou.uFogColor.value.setHex(t.fog);
        su.uZenith.value.setHex(t.sky.zenith);
        su.uHorizon.value.setHex(t.sky.horizon);
        su.uSun.value.setHex(t.sky.sun);
        su.uSunDir.value.copy(sunDir);
        su.uFogColor.value.setHex(t.fog);
        this.scene.fog.color.setHex(t.fog);
        this.hemi.color.setHex(t.sky.horizon).lerp(new THREE.Color(0xffffff), 0.4);
        this.hemi.groundColor.setHex(t.water.deep);
        this.hemi.intensity = 1.1 * t.light;
        this.sun.color.setHex(t.sky.sun);
        this.sun.intensity = 1.25 * t.light;
        this.sun.position.copy(sunDir).multiplyScalar(60);
        // environment reflections from the sky
        try {
            const envScene = new THREE.Scene();
            const s = createSky();
            Object.keys(su).forEach((k) => { if (s.material.uniforms[k]) s.material.uniforms[k].value = su[k].value; });
            envScene.add(s);
            if (this.envRT) this.envRT.dispose();
            this.envRT = this.pmrem.fromScene(envScene, 0.02);
            this.scene.environment = this.envRT.texture;
            s.geometry.dispose();
            s.material.dispose();
        } catch (e) { /* env optional */ }
        Object.values(this.boards).forEach((b) => {
            b.gridMat.map?.dispose();
            b.gridMat.map = gridTexture(b.key === "home" ? t.accent : t.enemy);
            b.gridMat.needsUpdate = true;
            b.ships.forEach((s) => this._tintShip(s));
        });
        this._applyWeather();
    }

    setWeather(mode) {
        this.weatherMode = mode;
        this._applyWeather();
    }

    _applyWeather() {
        const storm = this.weatherMode === "storm" || (this.weatherMode === "auto" && this.theme?.weather === "storm");
        this.storm = storm;
        this.rain.visible = storm && !this.reducedMotion;
        this.ocean.material.uniforms.uAmp.value = storm ? 1.45 : 1.0;
        this.nextLightning = rand(5, 10);
    }

    _createRain() {
        const count = this.quality === "low" ? 500 : 1300;
        const pos = new Float32Array(count * 6);
        this.rainData = [];
        for (let i = 0; i < count; i++) {
            this.rainData.push({ x: rand(-22, 22), y: rand(0, 16), z: rand(-16, 16), s: rand(16, 22) });
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
        this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb8c8d8, transparent: true, opacity: 0.32, depthWrite: false }));
        this.rain.frustumCulled = false;
        this.rain.visible = false;
        this.scene.add(this.rain);
    }

    _updateRain(dt) {
        if (!this.rain.visible) return;
        const p = this.rain.geometry.attributes.position.array;
        const c = this.curTarget;
        this.rainData.forEach((d, i) => {
            d.y -= d.s * dt;
            if (d.y < 0) {
                d.y = 16;
                if (Math.random() < 0.06) this.fx.ripple(new THREE.Vector3(c.x + d.x, 0.02, c.z + d.z), 0xffffff, 0.6, 0.4);
            }
            const x = c.x + d.x;
            const z = c.z + d.z;
            p.set([x, d.y, z, x - 0.05, d.y + 0.45, z + 0.02], i * 6);
        });
        this.rain.geometry.attributes.position.needsUpdate = true;
    }

    _updateLightning(dt) {
        const su = this.sky.material.uniforms;
        const ou = this.ocean.material.uniforms;
        if (!this.storm || this.reducedMotion) { su.uFlash.value = 0; ou.uFlash.value = 0; return; }
        this.nextLightning -= dt;
        if (this.nextLightning <= 0) {
            this.flashT = 0.5;
            this.nextLightning = rand(7, 16);
            setTimeout(() => this.onThunder?.(), rand(250, 900));
        }
        if (this.flashT > 0) {
            this.flashT -= dt;
            const k = this.flashT > 0.35 ? 1 : this.flashT > 0.25 ? 0.15 : this.flashT > 0.12 ? 0.8 : Math.max(this.flashT / 0.12, 0) * 0.4;
            su.uFlash.value = k * 0.6;
            ou.uFlash.value = k;
            this.hemi.intensity = 1.1 * this.theme.light + k * 2.5;
        } else {
            su.uFlash.value = 0;
            ou.uFlash.value = 0;
            this.hemi.intensity = 1.1 * this.theme.light;
        }
    }

    // ---------- boards ----------
    _createBoard(key) {
        const cx = BOARD_X[key];
        const group = new THREE.Group();
        group.position.set(cx, 0, 0);
        this.scene.add(group);
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(10.2, 10.2).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0x02101c, transparent: true, opacity: 0.28, depthWrite: false }));
        plate.position.y = 0.075;
        plate.renderOrder = 1;
        group.add(plate);
        const gridMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false });
        const grid = new THREE.Mesh(new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2), gridMat);
        grid.position.y = 0.09;
        grid.renderOrder = 2;
        group.add(grid);
        const mk = (tex, blending = THREE.AdditiveBlending) => {
            const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
                new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending, toneMapped: false }), GRID * GRID);
            m.count = 0;
            m.renderOrder = 3;
            m.frustumCulled = false;
            m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            m.setColorAt(0, new THREE.Color(1, 1, 1));
            group.add(m);
            return m;
        };
        const layers = {
            heat: mk(this.tex.fill, THREE.NormalBlending),
            preview: mk(this.tex.border),
            hover: mk(this.tex.border),
            pending: mk(this.tex.cross)
        };
        layers.heat.material.opacity = 0.42;
        const b = {
            key, cx, group, grid, gridMat, layers,
            ships: new Map(), markers: new Map(), islands: [], mines: new Map(), fog: [], labels: new Map(), ghost: null
        };
        this.boards[key] = b;
    }

    cellLocal(x, y, h = 0) { return new THREE.Vector3(x - 4.5, h, y - 4.5); }
    cellWorld(key, x, y, h = 0) { return new THREE.Vector3(BOARD_X[key] + x - 4.5, h, y - 4.5); }

    clearBoard(key) {
        const b = this.boards[key];
        b.ships.forEach((s) => this._disposeShip(b, s));
        b.ships.clear();
        b.markers.forEach((m) => this._removeMarker(b, m));
        b.markers.clear();
        b.islands.forEach((o) => b.group.remove(o));
        b.islands = [];
        b.mines.forEach((o) => b.group.remove(o));
        b.mines.clear();
        b.fog.forEach((o) => { b.group.remove(o); o.material.dispose(); });
        b.fog = [];
        b.labels.forEach((o) => { b.group.remove(o); o.material.map.dispose(); o.material.dispose(); });
        b.labels.clear();
        Object.values(b.layers).forEach((l) => { l.count = 0; });
        this.clearGhost();
    }

    resetAll() {
        this.tweens.flush();
        this.fx.clear();
        ["home", "enemy"].forEach((k) => this.clearBoard(k));
        this.timeScale = 1;
        this.speed = 1;
        this.slowmo = 0;
        this.killcamT = 0;
    }

    setTerrain(key, { island = [], fog = [] }) {
        const b = this.boards[key];
        b.islands.forEach((o) => b.group.remove(o));
        b.islands = [];
        b.fog.forEach((o) => { b.group.remove(o); o.material.dispose(); });
        b.fog = [];
        island.forEach((on, i) => {
            if (!on) return;
            const x = i % GRID;
            const y = Math.floor(i / GRID);
            const isl = buildIsland(i + (key === "home" ? 0 : 100), this.terrainMats);
            isl.position.copy(this.cellLocal(x, y, 0.02));
            b.group.add(isl);
            b.islands.push(isl);
        });
        const fogCells = [];
        fog.forEach((on, i) => { if (on) fogCells.push({ x: i % GRID, y: Math.floor(i / GRID) }); });
        if (fogCells.length) {
            const tint = new THREE.Color(this.theme.fog).lerp(new THREE.Color(0xffffff), 0.65);
            for (let k = 0; k < fogCells.length + 4; k++) {
                const c = fogCells[k % fogCells.length];
                const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.soft, color: tint, transparent: true, opacity: 0.55, depthWrite: false }));
                const base = this.cellLocal(c.x, c.y, rand(0.35, 0.9));
                s.position.copy(base);
                s.userData = { base, ph: Math.random() * 6.28, sp: rand(0.2, 0.5) };
                const sc = rand(1.6, 2.6);
                s.scale.set(sc, sc * 0.7, 1);
                s.renderOrder = 7;
                b.group.add(s);
                b.fog.push(s);
            }
        }
    }

    setMines(key, mines) {
        const b = this.boards[key];
        const keep = new Set();
        (mines || []).forEach((on, i) => {
            if (!on) return;
            keep.add(i);
            if (b.mines.has(i)) return;
            const m = buildMine(this.terrainMats);
            m.position.copy(this.cellLocal(i % GRID, Math.floor(i / GRID), 0));
            m.userData.ph = Math.random() * 6;
            b.group.add(m);
            b.mines.set(i, m);
        });
        b.mines.forEach((m, i) => { if (!keep.has(i)) { b.group.remove(m); b.mines.delete(i); } });
    }

    // ---------- ships ----------
    _shipMats() { return shipMaterials(this.theme); }

    _tintShip(s) {
        const t = this.theme;
        const dark = s.sunk ? 0.35 : 1;
        s.mats.hull.color.setHex(t.hull).multiplyScalar(dark);
        s.mats.deck.color.setHex(t.deck).multiplyScalar(dark);
        s.mats.light.emissiveIntensity = s.sunk ? 0 : 2.2;
        const op = s.revealed && !s.sunk ? 0.55 : 1;
        Object.values(s.mats).forEach((m) => {
            m.transparent = op < 1;
            m.opacity = op;
            m.depthWrite = op >= 1;
        });
    }

    _disposeShip(b, s) {
        b.group.remove(s.group);
        s.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        Object.values(s.mats).forEach((m) => m.dispose());
        if (s.smoke) this.fx.removeEmitter(s.smoke);
    }

    _placeShipGroup(s, cells, horizontal) {
        const a = cells[0];
        const z = cells[cells.length - 1];
        s.center = this.cellLocal((a.x + z.x) / 2, (a.y + z.y) / 2, 0);
        s.yaw = horizontal ? 0 : -Math.PI / 2;
        s.horizontal = horizontal;
        s.cells = cells.map((c) => ({ ...c }));
        s.group.position.set(s.center.x, 0, s.center.z);
        s.group.rotation.set(0, s.yaw, 0, "YXZ");
    }

    // ships: [{ id, size, cells, horizontal, sunk }]; opts.reveal = ghosted reveal of hidden fleet
    syncShips(key, ships, { reveal = false, animateSink = true } = {}) {
        const b = this.boards[key];
        const seen = new Set();
        ships.forEach((sh) => {
            seen.add(sh.id);
            let s = b.ships.get(sh.id);
            if (!s) {
                const mats = this._shipMats();
                const group = buildShip(sh.id, sh.size || SHIP_BY_ID[sh.id].size, mats);
                s = { id: sh.id, group, mats, sunk: false, sinkK: 0, revealed: reveal, wake: 0 };
                this._placeShipGroup(s, sh.cells, sh.horizontal ?? (sh.cells.length < 2 || sh.cells[0].y === sh.cells[1].y));
                b.group.add(group);
                b.ships.set(sh.id, s);
                s.sinkK = sh.sunk && !animateSink ? 1 : 0;
                this._tintShip(s);
            } else {
                const sig = sh.cells.map((c) => `${c.x},${c.y}`).join("|");
                const cur = s.cells.map((c) => `${c.x},${c.y}`).join("|");
                if (sig !== cur && !s.moving) this._placeShipGroup(s, sh.cells, sh.horizontal ?? s.horizontal);
            }
            if (s.revealed !== reveal && !sh.sunk) { s.revealed = reveal; this._tintShip(s); }
            if (sh.sunk && !s.sunk) {
                s.sunk = true;
                s.revealed = false;
                this._tintShip(s);
                if (!animateSink) s.sinkK = 1;
                const cw = () => {
                    const p = new THREE.Vector3();
                    s.group.getWorldPosition(p);
                    return p.add(new THREE.Vector3(0, 0.25, 0));
                };
                s.smoke = this.fx.addEmitter(cw, "smoke");
            }
        });
        b.ships.forEach((s, id) => { if (!seen.has(id)) { this._disposeShip(b, s); b.ships.delete(id); } });
    }

    muzzleWorld(key) {
        const b = this.boards[key];
        const alive = [...b.ships.values()].filter((s) => !s.sunk && !s.revealed);
        if (!alive.length) return null;
        const s = alive[Math.floor(Math.random() * alive.length)];
        const ms = s.group.userData.muzzles || [];
        const v = (ms[Math.floor(Math.random() * ms.length)] || new THREE.Vector3(0, 0.4, 0)).clone();
        s.group.updateMatrixWorld(true);
        return s.group.localToWorld(v);
    }

    setGhost(key, def, x, y, horizontal, valid) {
        const b = this.boards[key];
        if (!this.ghostCache) this.ghostCache = {};
        const color = valid ? 0x7fe3d2 : 0xff4d3d;
        let g = this.ghostCache[def.id];
        if (!g) {
            const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
            const mats = { hull: m, deck: m, dark: m, stripe: m, light: m, white: m };
            g = buildShip(def.id, def.size, mats);
            g.userData.mat = m;
            this.ghostCache[def.id] = g;
        }
        if (this.ghost && this.ghost !== g) this.ghost.parent?.remove(this.ghost);
        this.ghost = g;
        g.userData.mat.color.setHex(color);
        const end = horizontal ? { x: x + def.size - 1, y } : { x, y: y + def.size - 1 };
        const c = this.cellLocal((x + end.x) / 2, (y + end.y) / 2, 0.05);
        g.position.copy(c);
        g.rotation.set(0, horizontal ? 0 : -Math.PI / 2, 0);
        if (g.parent !== b.group) b.group.add(g);
    }

    clearGhost() {
        if (this.ghost) this.ghost.parent?.remove(this.ghost);
        this.ghost = null;
    }

    // ---------- markers ----------
    _removeMarker(b, m) {
        if (m.obj) b.group.remove(m.obj);
        if (m.emitter) this.fx.removeEmitter(m.emitter);
    }

    _makeMarker(b, state, x, y) {
        const k = this.markerKit;
        const g = new THREE.Group();
        const onShip = b.key === "home" || b.ships.size > 0;
        let emitter = null;
        if (state === "miss") {
            const peg = new THREE.Mesh(k.missPeg, k.mats.miss);
            peg.position.y = 0.12;
            g.add(peg);
            g.add(new THREE.Mesh(k.missRing, k.mats.missRing));
        } else if (state === "hit") {
            const shipHere = [...b.ships.values()].some((s) => s.cells.some((c) => c.x === x && c.y === y));
            const h = shipHere && onShip ? 0.34 : 0.14;
            const peg = new THREE.Mesh(k.hitPeg, k.mats.hit);
            peg.position.y = h;
            g.add(peg);
            const world = this.cellWorld(b.key, x, y, h + 0.15);
            emitter = this.fx.addEmitter(() => world, "fire");
        } else if (state === "sunk") {
            const d = new THREE.Mesh(k.disc, k.mats.sunkDisc);
            d.position.y = 0.1;
            g.add(d);
        } else if (state === "mine") {
            const d = new THREE.Mesh(k.disc, k.mats.scorch);
            d.position.y = 0.1;
            g.add(d);
        } else if (state === "contact") {
            const d = new THREE.Mesh(k.diamond, k.mats.contact);
            d.position.y = 0.14;
            g.add(d);
            g.userData.pulse = d;
        } else if (state === "clear") {
            const d = new THREE.Mesh(k.dot, k.mats.clear);
            d.position.y = 0.11;
            g.add(d);
        } else {
            return null;
        }
        g.position.copy(this.cellLocal(x, y, 0));
        g.userData.cell = { x, y };
        b.group.add(g);
        if (!this.reducedMotion) {
            g.scale.setScalar(0.01);
            this.tweens.run(0.35, (t) => g.scale.setScalar(Math.max(t, 0.01)), ease.outBack);
        }
        return { obj: g, emitter };
    }

    // states: array[100] of unknown|none|miss|hit|sunk|mine|contact|clear
    syncMarkers(key, states) {
        const b = this.boards[key];
        states.forEach((st, i) => {
            const norm = st === "unknown" || st === "none" ? null : st;
            const cur = b.markers.get(i);
            if ((cur?.state || null) === norm) return;
            if (cur) { this._removeMarker(b, cur); b.markers.delete(i); }
            if (!norm) return;
            const m = this._makeMarker(b, norm, i % GRID, Math.floor(i / GRID));
            if (m) b.markers.set(i, { state: norm, ...m });
        });
    }

    syncLines(key, lines) {
        const b = this.boards[key];
        const want = new Map();
        ["row", "col"].forEach((axis) => lines[axis].forEach((v, k) => { if (v !== null && v !== undefined) want.set(`${axis}:${k}`, v); }));
        b.labels.forEach((spr, id) => {
            if (!want.has(id) || spr.userData.v !== want.get(id)) {
                b.group.remove(spr);
                spr.material.map.dispose();
                spr.material.dispose();
                b.labels.delete(id);
            }
        });
        want.forEach((v, id) => {
            if (b.labels.has(id)) return;
            const [axis, k] = id.split(":");
            const spr = textSprite(String(v), v > 0 ? "#ffc457" : "#bfe7ff", 0.6);
            spr.userData.v = v;
            spr.position.copy(axis === "row" ? this.cellLocal(10.05, Number(k), 0.35) : this.cellLocal(Number(k), 10.05, 0.35));
            b.group.add(spr);
            b.labels.set(id, spr);
        });
    }

    // cells: [{x,y,color}] — layer: hover | preview | pending | heat
    setHighlights(key, layer, cells) {
        const m = this.boards[key].layers[layer];
        const mat = new THREE.Matrix4();
        const col = new THREE.Color();
        let n = 0;
        cells.forEach((c) => {
            if (c.x < 0 || c.y < 0 || c.x >= GRID || c.y >= GRID) return;
            const p = this.cellLocal(c.x, c.y, 0.1 + (layer === "heat" ? 0 : 0.005));
            mat.makeTranslation(p.x, p.y, p.z);
            m.setMatrixAt(n, mat);
            col.set(c.color ?? 0xffffff);
            m.setColorAt(n, col);
            n++;
        });
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    clearHighlights(key) {
        Object.values(this.boards[key].layers).forEach((l) => { l.count = 0; });
    }

    // ---------- camera ----------
    setCameraMode(mode) { this.cameraMode = mode; this._computeCamera(false); }

    focus(view, { force = false } = {}) {
        this.requestedView = view;
        this.forceView = force;
        this._computeCamera(false);
    }

    _effectiveView() {
        const v = this.requestedView || "menu";
        if (v === "menu") return "menu";
        if (this.forceView) return v;
        const wide = this.camera.aspect >= 1.2;
        if (this.cameraMode === "both") return "both";
        if (this.cameraMode === "focus") return v;
        return wide ? "both" : v;
    }

    _computeCamera(snap) {
        const view = this._effectiveView();
        this.view = view;
        if (view === "menu") { if (snap) this.camera.position.copy(this.camPos); return; }
        const W = view === "both" ? 27.5 : 13.2;
        const H = view === "both" ? 12.5 : 13;
        const target = new THREE.Vector3(view === "both" ? 0 : BOARD_X[view], 0, 0.4);
        const fov = THREE.MathUtils.degToRad(this.camera.fov);
        const h = window.innerHeight;
        const usable = Math.max(0.35, (h - this.insets.top - this.insets.bottom) / h);
        const elev = THREE.MathUtils.degToRad(view === "both" ? 56 : 62);
        const projH = H * Math.sin(elev) + 1.2;
        const dV = (projH / 2) / (Math.tan(fov / 2) * usable);
        const dH = (W / 2) / (Math.tan(fov / 2) * this.camera.aspect);
        const d = Math.max(dV, dH) * 1.04;
        this.camTarget.copy(target);
        this.camPos.set(target.x, target.y + Math.sin(elev) * d, target.z + Math.cos(elev) * d);
        if (snap) {
            this.camera.position.copy(this.camPos);
            this.curTarget.copy(this.camTarget);
        }
    }

    shake(amount) {
        if (this.reducedMotion) return;
        this.shakeAmp = Math.min(1.2, this.shakeAmp + amount);
    }

    killcam(key, x, y) {
        if (this.reducedMotion) return Promise.resolve();
        const p = this.cellWorld(key, x, y, 0);
        this.killcamT = 1.9;
        this.killTarget = p;
        this.slowmo = 1.9;
        return new Promise((r) => setTimeout(r, 1900));
    }

    // ---------- picking ----------
    pick(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(ndc, this.camera);
        const hits = this.raycaster.intersectObjects([this.boards.home.grid, this.boards.enemy.grid], false);
        if (!hits.length) return null;
        const h = hits[0];
        const key = h.object === this.boards.home.grid ? "home" : "enemy";
        const lx = h.point.x - BOARD_X[key] + 5;
        const lz = h.point.z + 5;
        const x = Math.floor(lx);
        const y = Math.floor(lz);
        if (x < 0 || y < 0 || x >= GRID || y >= GRID) return { key, x: -1, y: -1, outside: true };
        return { key, x, y };
    }

    // ---------- cinematics ----------
    _shellOrigin(fromKey, toKey) {
        if (fromKey === "home") {
            const m = this.muzzleWorld("home");
            if (m) return m;
        }
        const side = toKey === "home" ? 1 : -1;
        return new THREE.Vector3(BOARD_X[toKey] + side * rand(9, 12), rand(1.5, 3), rand(-4, 4));
    }

    async _flight(from, to, dur, color) {
        const shell = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial({ color: color ?? 0xffd27a, toneMapped: false }));
        shell.material.color.multiplyScalar(4);
        this.scene.add(shell);
        const peak = 2.2 + from.distanceTo(to) * 0.16;
        const mid = from.clone().lerp(to, 0.5);
        mid.y = Math.max(from.y, to.y) + peak;
        const p = new THREE.Vector3();
        await this.tweens.run(dur, (t) => {
            const a = from.clone().multiplyScalar((1 - t) * (1 - t));
            const b = mid.clone().multiplyScalar(2 * (1 - t) * t);
            const c = to.clone().multiplyScalar(t * t);
            p.copy(a).add(b).add(c);
            shell.position.copy(p);
            this.fx.trail(p);
        }, ease.linear);
        this.scene.remove(shell);
        shell.geometry.dispose();
        shell.material.dispose();
    }

    impact(key, x, y, r) {
        const p = this.cellWorld(key, x, y, 0.05);
        switch (r) {
            case "miss": case "repeat": this.fx.splash(p); break;
            case "hit": this.fx.explosion(p); this.shake(0.28); break;
            case "sunk": this.fx.explosion(p, true); this.shake(0.55); break;
            case "mine": case "mine-cleared": this.fx.mineBlast(p); this.shake(0.5); break;
            case "armor": this.fx.deflect(p); this.shake(0.15); break;
            case "blocked": this.fx.sparkle(p.add(new THREE.Vector3(0, 0.2, 0)), new THREE.Color(0xc8b59a), 24); break;
            default: break;
        }
        this.onImpact?.(r, key);
    }

    async shoot({ fromKey, toKey, cells, kind = "shot" }) {
        if (!cells.length) return;
        const fast = this.reducedMotion;
        const jobs = cells.map((c, i) => (async () => {
            const delay = fast ? 0 : i * (kind === "salvo" ? 0.2 : kind === "barrage" ? 0.11 : 0);
            if (delay) await this.tweens.run(delay, () => {});
            const to = this.cellWorld(toKey, c.x, c.y, 0.1);
            const from = this._shellOrigin(fromKey, toKey);
            if (!fast) {
                this.fx.muzzle(from);
                this.onImpact?.("fire", fromKey);
                await this._flight(from, to, 0.55 + from.distanceTo(to) * 0.03);
            }
            this.impact(toKey, c.x, c.y, c.r);
        })());
        await Promise.all(jobs);
        await this.tweens.run(fast ? 0.05 : 0.35, () => {});
    }

    async torpedo({ toKey, axis, path, end }) {
        if (!path.length) return;
        const fast = this.reducedMotion;
        const first = path[0];
        const startCell = axis === "row" ? { x: first.x - 1.5, y: first.y } : { x: first.x, y: first.y - 1.5 };
        const pts = [this.cellWorld(toKey, startCell.x, startCell.y, -0.02), ...path.map((c) => this.cellWorld(toKey, c.x, c.y, -0.02))];
        const last = path[path.length - 1];
        if (end.r === "edge") pts.push(this.cellWorld(toKey, axis === "row" ? last.x + 1.5 : last.x, axis === "row" ? last.y : last.y + 1.5, -0.02));
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.3, 3, 8), new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.6, roughness: 0.4 }));
        body.rotation.set(0, axis === "row" ? 0 : -Math.PI / 2, Math.PI / 2, "YXZ");
        this.scene.add(body);
        this.onImpact?.("torpedo", toKey);
        if (!fast) {
            const total = pts.length - 1;
            await this.tweens.run(0.16 * total + 0.2, (t) => {
                const f = t * total;
                const i = Math.min(Math.floor(f), total - 1);
                const p = pts[i].clone().lerp(pts[i + 1], f - i);
                body.position.copy(p);
                this.fx.wake(p, 1.5);
            }, ease.linear);
        }
        this.scene.remove(body);
        body.geometry.dispose();
        body.material.dispose();
        if (end.x !== undefined) this.impact(toKey, end.x, end.y, end.r === "blocked" ? "blocked" : end.r);
        await this.tweens.run(fast ? 0.05 : 0.4, () => {});
    }

    async sonar({ key, x, y, radius = 1 }) {
        const c = this.cellWorld(key, x, y, 0.15);
        this.onImpact?.("sonar", key);
        const pulses = this.reducedMotion ? 1 : 3;
        for (let k = 0; k < pulses; k++) {
            this.fx.ripple(c, 0x7fe3ff, (radius + 0.6) * 2.6, 1.1);
            if (k < pulses - 1) await this.tweens.run(0.35, () => {});
        }
        const cells = [];
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) cells.push({ x: x + dx, y: y + dy, color: 0x3fbfff });
        this.setHighlights(key, "preview", cells);
        await this.tweens.run(this.reducedMotion ? 0.1 : 0.7, () => {});
        this.setHighlights(key, "preview", []);
    }

    async recon({ key, axis, index }) {
        const fast = this.reducedMotion;
        const plane = new THREE.Group();
        const m = new THREE.MeshStandardMaterial({ color: 0xdfe6ec, metalness: 0.3, roughness: 0.5 });
        plane.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.12), m));
        plane.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.9), m));
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.32), m);
        tail.position.x = -0.3;
        plane.add(tail);
        const beam = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.2, 20, 1, true),
            new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
        beam.position.y = -1.1;
        plane.add(beam);
        plane.rotation.y = axis === "row" ? 0 : -Math.PI / 2;
        this.scene.add(plane);
        const a = axis === "row" ? this.cellWorld(key, -3, index, 2.3) : this.cellWorld(key, index, -3, 2.3);
        const b = axis === "row" ? this.cellWorld(key, 12, index, 2.3) : this.cellWorld(key, index, 12, 2.3);
        this.onImpact?.("plane", key);
        const line = [];
        for (let t = 0; t < GRID; t++) line.push(axis === "row" ? { x: t, y: index, color: 0xffd36a } : { x: index, y: t, color: 0xffd36a });
        this.setHighlights(key, "preview", line);
        await this.tweens.run(fast ? 0.1 : 1.7, (t) => {
            plane.position.copy(a).lerp(b, t);
            plane.position.y += Math.sin(t * Math.PI) * 0.3;
            plane.rotation.x = Math.sin(t * 9) * 0.05;
        }, ease.inOutCubic);
        this.scene.remove(plane);
        plane.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        m.dispose();
        beam.material.dispose();
        this.setHighlights(key, "preview", []);
    }

    async repair({ key, x, y }) {
        const p = this.cellWorld(key, x, y, 0.3);
        this.fx.sparkle(p, undefined, 40);
        this.fx.ripple(p, 0x7dffb2, 1.6, 0.8);
        this.onImpact?.("repair", key);
        await this.tweens.run(this.reducedMotion ? 0.1 : 0.9, () => {});
    }

    async moveShip({ key, id, to, horizontal }) {
        const b = this.boards[key];
        const s = b.ships.get(id);
        if (!s) return;
        const a = to[0];
        const z = to[to.length - 1];
        const target = this.cellLocal((a.x + z.x) / 2, (a.y + z.y) / 2, 0);
        const start = s.center.clone();
        s.moving = true;
        this.onImpact?.("move", key);
        await this.tweens.run(this.reducedMotion ? 0.05 : 0.8, (t) => {
            s.center.copy(start).lerp(target, t);
            const w = new THREE.Vector3(BOARD_X[key] + s.center.x, 0, s.center.z);
            if (Math.random() < 0.6) this.fx.wake(w, 1);
        }, ease.inOutCubic);
        s.moving = false;
        this._placeShipGroup(s, to, horizontal ?? s.horizontal);
    }

    // ---------- loop ----------
    _frame() {
        // Real elapsed time, clamped. Cinematics use a generous clamp so they finish on time even
        // when frames are slow; particles/camera use a tight clamp so they stay stable.
        const realDt = Math.min(this.clock.getDelta(), 0.25);
        const rawDt = Math.min(realDt, 0.05);
        if (this.slowmo > 0) {
            this.slowmo -= rawDt;
            this.timeScale = this.slowmo > 0.3 ? 0.32 : 0.32 + (1 - 0.32) * (1 - this.slowmo / 0.3);
            if (this.slowmo <= 0) this.timeScale = 1;
        }
        const dt = rawDt * this.timeScale * (this.speed || 1);
        this.time += dt;
        const t = this.time;
        this.ocean.material.uniforms.uTime.value = t;
        this.sky.material.uniforms.uTime.value = t;
        const amp = this.ocean.material.uniforms.uAmp.value;

        // ships bob with the waves; wrecks settle
        Object.values(this.boards).forEach((b) => {
            b.ships.forEach((s) => {
                if (s.sunk && s.sinkK < 1) s.sinkK = Math.min(1, s.sinkK + dt * 0.45);
                const wx = b.cx + s.center.x;
                const wz = s.center.z;
                const w = waveAt(wx, wz, t, amp);
                const sink = ease.outCubic(s.sinkK);
                s.group.position.set(s.center.x, w.h * 0.8 - sink * 0.24, s.center.z);
                const along = s.horizontal ? w.gx : w.gz;
                const across = s.horizontal ? w.gz : w.gx;
                s.group.rotation.set(across * 0.45 + sink * 0.16, s.yaw, -along * 0.35 + sink * 0.05, "YXZ");
            });
            b.markers.forEach((m) => {
                const pulse = m.obj.userData.pulse;
                if (pulse) {
                    const k = 0.85 + Math.sin(t * 5 + m.obj.position.x) * 0.15;
                    pulse.scale.setScalar(k);
                    pulse.rotation.y = t * 0.6;
                }
            });
            b.mines.forEach((m) => {
                m.position.y = Math.sin(t * 1.6 + m.userData.ph) * 0.03;
                const l = m.userData.light;
                if (l) l.visible = Math.sin(t * 4 + m.userData.ph) > 0.2;
            });
            b.fog.forEach((f) => {
                const u = f.userData;
                f.position.x = u.base.x + Math.sin(t * u.sp + u.ph) * 0.4;
                f.position.z = u.base.z + Math.cos(t * u.sp * 0.7 + u.ph) * 0.3;
                f.material.opacity = 0.45 + Math.sin(t * 0.6 + u.ph) * 0.1;
            });
            const pulse = 0.75 + Math.sin(t * 6) * 0.25;
            b.layers.hover.material.opacity = pulse;
            b.layers.pending.material.opacity = 0.7 + Math.sin(t * 8) * 0.3;
        });
        if (this.ghost) this.ghost.position.y = 0.05 + Math.sin(t * 3) * 0.03;

        this.fx.update(dt);
        this.tweens.update(realDt * this.timeScale * (this.speed || 1));
        this._updateRain(rawDt);
        this._updateLightning(rawDt);

        // camera
        if (this.view === "menu" || this.requestedView === "menu") {
            const a = t * 0.04;
            this.camPos.set(Math.sin(a) * 24, 7.5, Math.cos(a) * 24);
            this.camTarget.set(0, 0, 0);
        } else {
            this._computeCamera(false);
        }
        let goalPos = this.camPos;
        let goalTarget = this.camTarget;
        if (this.killcamT > 0) {
            this.killcamT -= rawDt;
            const kt = this.killTarget;
            goalTarget = kt.clone();
            goalPos = kt.clone().add(new THREE.Vector3(0, 4.2, 6.2));
        }
        const lerpK = 1 - Math.exp(-rawDt * (this.killcamT > 0 ? 3 : 3.2));
        this.camera.position.lerp(goalPos, lerpK);
        this.curTarget.lerp(goalTarget, lerpK);
        const shake = this.shakeAmp;
        this.shakeAmp = Math.max(0, this.shakeAmp - rawDt * 1.8);
        const off = shake > 0 ? new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(shake * 0.25) : null;
        if (off) this.camera.position.add(off);
        this.camera.lookAt(this.curTarget);
        if (off) this.camera.position.sub(off);

        if (this.composer) this.composer.render(rawDt);
        else this.renderer.render(this.scene, this.camera);
    }

    dispose() {
        this.renderer.setAnimationLoop(null);
        window.removeEventListener("resize", this._onResize);
    }
}

export function webglAvailable() {
    try {
        const c = document.createElement("canvas");
        return !!(window.WebGL2RenderingContext && c.getContext("webgl2")) || !!c.getContext("webgl");
    } catch (e) {
        return false;
    }
}
