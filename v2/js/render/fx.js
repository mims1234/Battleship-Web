// GPU point-sprite particles (CPU simulated), tweens, and effect presets.
import * as THREE from "three";

const pVertex = /* glsl */`
attribute float aAlpha;
attribute float aSize;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
    vColor = aColor;
}
`;
const pFragment = /* glsl */`
varying float vAlpha;
varying vec3 vColor;
uniform float uSoft;
void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, uSoft, d) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor, a);
}
`;

export class Particles {
    constructor(scene, max, additive) {
        this.max = max;
        this.ptr = 0;
        this.alive = 0;
        const g = new THREE.BufferGeometry();
        this.pos = new Float32Array(max * 3);
        this.col = new Float32Array(max * 3);
        this.alpha = new Float32Array(max);
        this.size = new Float32Array(max);
        g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
        this.geo = g;
        this.mat = new THREE.ShaderMaterial({
            vertexShader: pVertex, fragmentShader: pFragment,
            uniforms: { uScale: { value: 400 }, uSoft: { value: additive ? 0.0 : 0.18 } },
            transparent: true, depthWrite: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
        });
        this.points = new THREE.Points(g, this.mat);
        this.points.frustumCulled = false;
        this.points.renderOrder = additive ? 6 : 5;
        scene.add(this.points);
        // per-particle sim state
        this.vel = new Float32Array(max * 3);
        this.life = new Float32Array(max);
        this.maxLife = new Float32Array(max);
        this.s0 = new Float32Array(max);
        this.s1 = new Float32Array(max);
        this.c0 = new Float32Array(max * 3);
        this.c1 = new Float32Array(max * 3);
        this.a0 = new Float32Array(max);
        this.grav = new Float32Array(max);
        this.drag = new Float32Array(max);
        this.floor = new Float32Array(max).fill(-99);
    }

    spawn(p) {
        const i = this.ptr;
        this.ptr = (this.ptr + 1) % this.max;
        const i3 = i * 3;
        this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z;
        this.vel[i3] = p.vx || 0; this.vel[i3 + 1] = p.vy || 0; this.vel[i3 + 2] = p.vz || 0;
        this.maxLife[i] = this.life[i] = p.life;
        this.s0[i] = p.size0; this.s1[i] = p.size1 ?? p.size0;
        const c0 = p.color0; const c1 = p.color1 || p.color0;
        this.c0[i3] = c0.r; this.c0[i3 + 1] = c0.g; this.c0[i3 + 2] = c0.b;
        this.c1[i3] = c1.r; this.c1[i3 + 1] = c1.g; this.c1[i3 + 2] = c1.b;
        this.a0[i] = p.alpha ?? 1;
        this.grav[i] = p.gravity || 0;
        this.drag[i] = p.drag || 0;
        this.floor[i] = p.floor ?? -99;
        this.size[i] = p.size0;
        this.alpha[i] = this.a0[i];
    }

    update(dt) {
        const { pos, vel, life, maxLife } = this;
        for (let i = 0; i < this.max; i++) {
            if (life[i] <= 0) {
                if (this.alpha[i] !== 0) { this.alpha[i] = 0; }
                continue;
            }
            life[i] -= dt;
            const i3 = i * 3;
            const k = 1 - Math.max(life[i], 0) / maxLife[i];
            const dr = Math.max(0, 1 - this.drag[i] * dt);
            vel[i3] *= dr; vel[i3 + 2] *= dr;
            vel[i3 + 1] = vel[i3 + 1] * dr + this.grav[i] * dt;
            pos[i3] += vel[i3] * dt;
            pos[i3 + 1] += vel[i3 + 1] * dt;
            pos[i3 + 2] += vel[i3 + 2] * dt;
            if (pos[i3 + 1] < this.floor[i]) { pos[i3 + 1] = this.floor[i]; vel[i3 + 1] = 0; }
            this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
            const fade = k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9;
            this.alpha[i] = life[i] > 0 ? this.a0[i] * fade : 0;
            this.col[i3] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * k;
            this.col[i3 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * k;
            this.col[i3 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * k;
        }
        const a = this.geo.attributes;
        a.position.needsUpdate = true;
        a.aColor.needsUpdate = true;
        a.aAlpha.needsUpdate = true;
        a.aSize.needsUpdate = true;
    }

    clear() {
        this.life.fill(0);
        this.alpha.fill(0);
        this.geo.attributes.aAlpha.needsUpdate = true;
    }
}

const C = (hex) => new THREE.Color(hex);
const rnd = (a, b) => a + Math.random() * (b - a);

export class FX {
    constructor(scene, quality = "high") {
        this.scene = scene;
        this.density = quality === "low" ? 0.5 : 1;
        this.add = new Particles(scene, quality === "low" ? 1500 : 3500, true);
        this.norm = new Particles(scene, quality === "low" ? 1500 : 3500, false);
        this.emitters = new Set();
        this.lights = [0, 1, 2].map(() => {
            const l = new THREE.PointLight(0xffa040, 0, 9, 1.6);
            scene.add(l);
            return { l, t: 0, peak: 0 };
        });
        this.ripples = [];
        this.rippleGeo = new THREE.RingGeometry(0.42, 0.5, 40);
        this.rippleGeo.rotateX(-Math.PI / 2);
        this.colors = {
            white: C(0xffffff), foam: C(0xdff3f7), mist: C(0xbfd9e3),
            fire0: C(0xfff1a8), fire1: C(0xff5a1f), ember: C(0xffb347), red: C(0xff3b2f),
            smoke0: C(0x3a3a3e), smoke1: C(0x8a8f96), darkSmoke: C(0x1d1d22),
            green: C(0x7dffb2), cyan: C(0x7fe3ff), amber: C(0xffc457), shell: C(0xffd27a)
        };
    }

    n(count) { return Math.max(1, Math.round(count * this.density)); }

    setScale(v) { this.add.mat.uniforms.uScale.value = v; this.norm.mat.uniforms.uScale.value = v; }

    flash(pos, intensity = 40, color = 0xffa040) {
        const slot = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
        slot.l.position.copy(pos).add(new THREE.Vector3(0, 0.8, 0));
        slot.l.color.setHex(color);
        slot.peak = intensity;
        slot.t = 0.35;
    }

    ripple(pos, color = 0xffffff, scale = 3, life = 1.2) {
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
        const m = new THREE.Mesh(this.rippleGeo, mat);
        m.position.set(pos.x, pos.y + 0.03, pos.z);
        m.renderOrder = 4;
        this.scene.add(m);
        this.ripples.push({ m, t: 0, life, scale });
    }

    splash(pos, big = false) {
        const c = this.colors;
        const k = big ? 1.6 : 1;
        for (let i = 0; i < this.n(46 * k); i++) {
            const a = Math.random() * Math.PI * 2;
            const r = rnd(0, 0.9) * k;
            this.norm.spawn({
                x: pos.x + Math.cos(a) * 0.1, y: pos.y, z: pos.z + Math.sin(a) * 0.1,
                vx: Math.cos(a) * r, vy: rnd(3.2, 6.5) * k, vz: Math.sin(a) * r,
                life: rnd(0.7, 1.25), size0: rnd(0.16, 0.3), size1: 0.06, color0: c.white, color1: c.foam,
                alpha: 0.95, gravity: -13, floor: pos.y - 0.05
            });
        }
        for (let i = 0; i < this.n(14 * k); i++) {
            this.norm.spawn({
                x: pos.x + rnd(-0.3, 0.3), y: pos.y + rnd(0.2, 1.2), z: pos.z + rnd(-0.3, 0.3),
                vx: rnd(-0.4, 0.4), vy: rnd(0.4, 1.2), vz: rnd(-0.4, 0.4),
                life: rnd(1.0, 1.8), size0: 0.5, size1: 1.4, color0: c.mist, alpha: 0.35, drag: 1.2
            });
        }
        this.ripple(pos, 0xffffff, 3.2 * k, 1.3);
        this.ripple(pos, 0xffffff, 1.8 * k, 0.9);
    }

    explosion(pos, big = false) {
        const c = this.colors;
        const k = big ? 1.8 : 1;
        this.add.spawn({ x: pos.x, y: pos.y + 0.3, z: pos.z, life: 0.18, size0: 3.2 * k, size1: 4.5 * k, color0: c.fire0, color1: c.ember, alpha: 1 });
        for (let i = 0; i < this.n(38 * k); i++) {
            const a = Math.random() * Math.PI * 2;
            const r = rnd(0.6, 3.4) * k;
            this.add.spawn({
                x: pos.x, y: pos.y + 0.25, z: pos.z,
                vx: Math.cos(a) * r, vy: rnd(0.8, 3.5) * k, vz: Math.sin(a) * r,
                life: rnd(0.35, 0.8), size0: rnd(0.5, 0.95) * k, size1: 0.1, color0: c.fire0, color1: c.fire1, alpha: 1, drag: 3.2, gravity: 1.5
            });
        }
        for (let i = 0; i < this.n(26 * k); i++) {
            const a = Math.random() * Math.PI * 2;
            const r = rnd(2, 6) * k;
            this.add.spawn({
                x: pos.x, y: pos.y + 0.3, z: pos.z,
                vx: Math.cos(a) * r, vy: rnd(2, 7), vz: Math.sin(a) * r,
                life: rnd(0.5, 1.1), size0: 0.12, size1: 0.03, color0: c.ember, color1: c.red, alpha: 1, gravity: -11, floor: pos.y
            });
        }
        for (let i = 0; i < this.n(16 * k); i++) {
            this.norm.spawn({
                x: pos.x + rnd(-0.2, 0.2), y: pos.y + 0.4, z: pos.z + rnd(-0.2, 0.2),
                vx: rnd(-0.6, 0.6), vy: rnd(0.8, 2.0), vz: rnd(-0.6, 0.6),
                life: rnd(1.4, 2.6), size0: 0.5, size1: 1.9 * k, color0: c.smoke0, color1: c.smoke1, alpha: 0.6, drag: 1.4
            });
        }
        this.flash(pos, big ? 90 : 45);
        this.ripple(pos, 0xffb070, 2.6 * k, 0.8);
    }

    mineBlast(pos) {
        this.splash(pos, true);
        this.explosion(pos, false);
        for (let i = 0; i < this.n(20); i++) {
            this.norm.spawn({
                x: pos.x + rnd(-0.3, 0.3), y: pos.y + 0.2, z: pos.z + rnd(-0.3, 0.3),
                vx: rnd(-0.5, 0.5), vy: rnd(1, 2.4), vz: rnd(-0.5, 0.5),
                life: rnd(1.8, 3), size0: 0.7, size1: 2.2, color0: this.colors.darkSmoke, color1: this.colors.smoke0, alpha: 0.7, drag: 1
            });
        }
    }

    deflect(pos) {
        const c = this.colors;
        for (let i = 0; i < this.n(30); i++) {
            const a = Math.random() * Math.PI * 2;
            const r = rnd(2.5, 6);
            this.add.spawn({
                x: pos.x, y: pos.y + 0.35, z: pos.z,
                vx: Math.cos(a) * r, vy: rnd(1, 5), vz: Math.sin(a) * r,
                life: rnd(0.25, 0.6), size0: 0.14, size1: 0.02, color0: c.cyan, color1: c.white, alpha: 1, gravity: -9
            });
        }
        this.flash(pos, 30, 0x7fe3ff);
        this.ripple(pos, 0x7fe3ff, 2.2, 0.6);
    }

    sparkle(pos, color = this.colors.green, count = 30) {
        for (let i = 0; i < this.n(count); i++) {
            this.add.spawn({
                x: pos.x + rnd(-0.35, 0.35), y: pos.y + rnd(0, 0.3), z: pos.z + rnd(-0.35, 0.35),
                vx: rnd(-0.2, 0.2), vy: rnd(0.6, 1.8), vz: rnd(-0.2, 0.2),
                life: rnd(0.7, 1.4), size0: rnd(0.12, 0.22), size1: 0.02, color0: color, color1: this.colors.white, alpha: 1, drag: 0.8
            });
        }
    }

    trail(pos, color = this.colors.shell) {
        this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, life: 0.35, size0: 0.32, size1: 0.04, color0: color, color1: this.colors.fire1, alpha: 0.85 });
        if (Math.random() < 0.5) {
            this.norm.spawn({ x: pos.x, y: pos.y, z: pos.z, vy: 0.2, life: 0.9, size0: 0.15, size1: 0.5, color0: this.colors.smoke1, alpha: 0.18, drag: 1 });
        }
    }

    wake(pos, strength = 1) {
        for (let i = 0; i < this.n(2 * strength); i++) {
            this.norm.spawn({
                x: pos.x + rnd(-0.12, 0.12), y: pos.y + 0.04, z: pos.z + rnd(-0.12, 0.12),
                vx: rnd(-0.3, 0.3), vy: rnd(0.1, 0.4), vz: rnd(-0.3, 0.3),
                life: rnd(0.6, 1.1), size0: 0.18, size1: 0.45, color0: this.colors.white, color1: this.colors.foam, alpha: 0.55, drag: 1.5
            });
        }
    }

    muzzle(pos) {
        const c = this.colors;
        this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, life: 0.12, size0: 1.4, size1: 2.2, color0: c.fire0, color1: c.ember, alpha: 1 });
        for (let i = 0; i < this.n(8); i++) {
            this.norm.spawn({
                x: pos.x, y: pos.y, z: pos.z, vx: rnd(-0.6, 0.6), vy: rnd(0.3, 1), vz: rnd(-0.6, 0.6),
                life: rnd(0.8, 1.4), size0: 0.3, size1: 1.1, color0: c.smoke1, alpha: 0.45, drag: 1.6
            });
        }
        this.flash(pos, 18, 0xffc070);
    }

    // Persistent emitters (burning hits, smoking wrecks).
    addEmitter(getPos, kind) {
        const e = { getPos, kind, acc: 0 };
        this.emitters.add(e);
        return e;
    }
    removeEmitter(e) { this.emitters.delete(e); }
    clearEmitters() { this.emitters.clear(); }

    update(dt) {
        const c = this.colors;
        this.emitters.forEach((e) => {
            const rate = (e.kind === "fire" ? 16 : 7) * this.density;
            e.acc += dt * rate;
            const p = e.getPos();
            if (!p) return;
            while (e.acc >= 1) {
                e.acc -= 1;
                if (e.kind === "fire") {
                    this.add.spawn({
                        x: p.x + rnd(-0.1, 0.1), y: p.y, z: p.z + rnd(-0.1, 0.1),
                        vx: rnd(-0.15, 0.15), vy: rnd(0.7, 1.4), vz: rnd(-0.15, 0.15),
                        life: rnd(0.35, 0.65), size0: rnd(0.32, 0.5), size1: 0.05, color0: c.fire0, color1: c.fire1, alpha: 0.95, drag: 1
                    });
                    if (Math.random() < 0.45) {
                        this.norm.spawn({
                            x: p.x, y: p.y + 0.4, z: p.z, vx: rnd(-0.1, 0.25), vy: rnd(0.6, 1.1), vz: rnd(-0.1, 0.1),
                            life: rnd(1.6, 2.6), size0: 0.3, size1: 1.3, color0: c.smoke0, color1: c.smoke1, alpha: 0.42, drag: 0.6
                        });
                    }
                } else {
                    this.norm.spawn({
                        x: p.x + rnd(-0.2, 0.2), y: p.y + 0.1, z: p.z + rnd(-0.2, 0.2), vx: rnd(-0.05, 0.3), vy: rnd(0.5, 0.9), vz: rnd(-0.1, 0.1),
                        life: rnd(2.5, 3.8), size0: 0.5, size1: 2.2, color0: c.darkSmoke, color1: c.smoke0, alpha: 0.5, drag: 0.4
                    });
                }
            }
        });
        this.add.update(dt);
        this.norm.update(dt);
        this.lights.forEach((s) => {
            if (s.t > 0) {
                s.t -= dt;
                s.l.intensity = s.peak * Math.max(s.t / 0.35, 0) ** 2;
            } else s.l.intensity = 0;
        });
        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const r = this.ripples[i];
            r.t += dt;
            const k = r.t / r.life;
            if (k >= 1) {
                this.scene.remove(r.m);
                r.m.material.dispose();
                this.ripples.splice(i, 1);
                continue;
            }
            const s = 0.3 + (r.scale - 0.3) * (1 - (1 - k) ** 3);
            r.m.scale.set(s, s, s);
            r.m.material.opacity = 0.7 * (1 - k);
        }
    }

    clear() {
        this.add.clear();
        this.norm.clear();
        this.clearEmitters();
        this.ripples.forEach((r) => { this.scene.remove(r.m); r.m.material.dispose(); });
        this.ripples = [];
    }
}


// Minimal tween runner driven by the render loop (respects slow-motion timescale).
export class Tweens {
    constructor() { this.list = []; }
    run(duration, onUpdate, ease = (t) => t) {
        return new Promise((resolve) => {
            this.list.push({ t: 0, duration: Math.max(duration, 0.0001), onUpdate, ease, resolve });
        });
    }
    update(dt) {
        for (let i = this.list.length - 1; i >= 0; i--) {
            const tw = this.list[i];
            tw.t += dt;
            const k = Math.min(tw.t / tw.duration, 1);
            try { tw.onUpdate(tw.ease(k), dt); } catch (err) { console.error(err); }
            if (k >= 1) {
                this.list.splice(i, 1);
                tw.resolve();
            }
        }
    }
    flush() {
        const l = this.list;
        this.list = [];
        l.forEach((tw) => { try { tw.onUpdate(1, 0); } catch (e) { /* ignore */ } tw.resolve(); });
    }
}

export const ease = {
    outCubic: (t) => 1 - (1 - t) ** 3,
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    outBack: (t) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
    inQuad: (t) => t * t,
    linear: (t) => t
};
