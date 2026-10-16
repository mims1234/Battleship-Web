// Shader ocean + sky dome. The CPU wave function mirrors the vertex shader so ships bob in sync.
import * as THREE from "three";

// Seven non-harmonic wave trains with spread-out directions. Each train's height is modulated
// along its crest (swell groups), so the sea never settles into a repeating pattern.
export const WAVES = [
    { dir: [1, 0.22], amp: 0.17, len: 11.3, speed: 0.95 },
    { dir: [0.62, 0.78], amp: 0.11, len: 7.1, speed: 1.2 },
    { dir: [-0.35, 1], amp: 0.075, len: 4.7, speed: 1.55 },
    { dir: [0.93, -0.38], amp: 0.055, len: 3.3, speed: 1.85 },
    { dir: [-0.8, 0.6], amp: 0.035, len: 2.3, speed: 2.25 },
    { dir: [0.2, -0.98], amp: 0.022, len: 1.6, speed: 2.7 },
    { dir: [0.75, 0.66], amp: 0.014, len: 1.1, speed: 3.3 }
].map((w, i) => {
    const l = Math.hypot(w.dir[0], w.dir[1]);
    const dx = w.dir[0] / l;
    const dz = w.dir[1] / l;
    // modulation runs mostly across the travel direction, at a slow irregular scale
    return { ...w, dx, dz, k: (Math.PI * 2) / w.len, mx: -dz * 0.11 + dx * 0.03, mz: dx * 0.11 + dz * 0.03, mp: i * 1.93, ms: 0.05 + i * 0.013 };
});

// Board footprints (center x, center z, half x, half z) where the sea is calmer.
export const CALM_RECTS = [[-7, 0, 5.4, 5.4], [7, 0, 5.4, 5.4]];

function dampAt(x, z) {
    let d = 1e5;
    for (const [cx, cz, hx, hz] of CALM_RECTS) {
        const qx = Math.max(Math.abs(x - cx) - hx, 0);
        const qz = Math.max(Math.abs(z - cz) - hz, 0);
        d = Math.min(d, Math.hypot(qx, qz));
    }
    const t = Math.min(Math.max(d / 4, 0), 1);
    const s = t * t * (3 - 2 * t);
    return 0.15 + (1 - 0.15) * s;
}

export function waveAt(x, z, t, ampScale = 1) {
    const dm = dampAt(x, z) * ampScale;
    let h = 0;
    let gx = 0;
    let gz = 0;
    for (const w of WAVES) {
        const mod = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(w.mx * x + w.mz * z + w.mp + t * w.ms));
        const a = w.amp * dm * mod;
        const ph = (w.dx * x + w.dz * z) * w.k + t * w.speed;
        h += a * Math.sin(ph);
        const c = a * w.k * Math.cos(ph);
        gx += c * w.dx;
        gz += c * w.dz;
    }
    return { h, gx, gz };
}

const oceanVertex = /* glsl */`
uniform float uTime;
uniform float uAmp;
uniform vec4 uRects[2];
uniform vec4 uWaves[7];
uniform float uSpeeds[7];
uniform vec4 uMods[7];
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vHeight;
varying float vCalm;

float calm(vec2 p) {
    float d = 1e5;
    for (int i = 0; i < 2; i++) {
        vec2 q = abs(p - uRects[i].xy) - uRects[i].zw;
        d = min(d, length(max(q, 0.0)));
    }
    return smoothstep(0.0, 4.0, d);
}

void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec2 p = wp.xz;
    float c = calm(p);
    float dm = mix(0.15, 1.0, c) * uAmp;
    float h = 0.0;
    vec2 grad = vec2(0.0);
    for (int i = 0; i < 7; i++) {
        vec2 d = uWaves[i].xy;
        float k = uWaves[i].w;
        vec4 m = uMods[i];
        float md = 0.45 + 0.55 * (0.5 + 0.5 * sin(m.x * p.x + m.y * p.y + m.z + uTime * m.w));
        float a = uWaves[i].z * dm * md;
        float ph = dot(d, p) * k + uTime * uSpeeds[i];
        h += a * sin(ph);
        grad += a * k * cos(ph) * d;
    }
    wp.y += h;
    vNormalW = normalize(vec3(-grad.x, 1.0, -grad.y));
    vWorld = wp.xyz;
    vHeight = h;
    vCalm = c;
    gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const oceanFragment = /* glsl */`
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
uniform float uFlash;
uniform float uAmp;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vHeight;
varying float vCalm;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float ripples(vec2 p) {
    return noise(p + uTime * 0.35) + 0.5 * noise(p * 2.13 - uTime * 0.52) + 0.25 * noise(p * 4.7 + vec2(uTime * 0.8, -uTime * 0.3));
}

void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    vec2 np = vWorld.xz * 1.4;
    float e = 0.07;
    float n0 = ripples(np);
    float nx = ripples(np + vec2(e, 0.0));
    float nz = ripples(np + vec2(0.0, e));
    vec3 N = normalize(vNormalW + vec3(n0 - nx, 0.0, n0 - nz) * 0.55);

    float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    fres = mix(0.02, 0.85, fres);
    vec3 R = reflect(-V, N);
    float sky = clamp(R.y, 0.0, 1.0);
    vec3 skyCol = mix(uHorizon, uZenith, pow(sky, 0.55));
    vec3 L = normalize(uSunDir);
    float spec = pow(max(dot(R, L), 0.0), 700.0) * 0.9 + pow(max(dot(R, L), 0.0), 60.0) * 0.03;

    float depthMix = clamp(vHeight * 2.2 + 0.45, 0.0, 1.0);
    vec3 water = mix(uDeep, uShallow, depthMix * 0.55 + 0.12 + (1.0 - vCalm) * 0.1);
    water += uShallow * pow(max(dot(V, -L), 0.0), 3.0) * max(vHeight, 0.0) * 0.6;
    vec3 col = mix(water, skyCol, fres * 0.55) + uSun * spec;

    float crest = vHeight / max(uAmp, 0.5);
    float streak = noise(vWorld.xz * 3.1 + vec2(uTime * 0.2, -uTime * 0.15));
    float foam = smoothstep(0.27, 0.38, crest) * smoothstep(0.62, 0.9, streak) * smoothstep(0.9, 1.25, n0);
    col = mix(col, uFoam, foam * 0.45);
    col += vec3(0.6, 0.7, 0.9) * uFlash * 0.35;

    float dist = length(vWorld - cameraPosition);
    col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const skyVertex = /* glsl */`
varying vec3 vDir;
void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
}
`;

const skyFragment = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform float uFlash;
uniform float uTime;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.45));
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSun * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.14 + pow(s, 3.0) * 0.05);
    // soft drifting clouds
    vec2 cp = d.xz / max(d.y, 0.08) * 1.4 + vec2(uTime * 0.01, 0.0);
    float cl = noise(cp) * 0.6 + noise(cp * 2.3) * 0.3 + noise(cp * 5.1) * 0.1;
    cl = smoothstep(0.55, 0.85, cl) * smoothstep(0.02, 0.25, d.y);
    col = mix(col, mix(uHorizon, vec3(1.0), 0.35), cl * 0.35);
    col = mix(uFogColor, col, smoothstep(-0.02, 0.12, d.y));
    col += vec3(0.7, 0.75, 0.95) * uFlash;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

export function createOcean(segments = 220) {
    const geo = new THREE.PlaneGeometry(260, 260, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const uniforms = {
        uTime: { value: 0 },
        uAmp: { value: 1 },
        uFlash: { value: 0 },
        uRects: { value: CALM_RECTS.map((r) => new THREE.Vector4(...r)) },
        uWaves: { value: WAVES.map((w) => new THREE.Vector4(w.dx, w.dz, w.amp, w.k)) },
        uSpeeds: { value: WAVES.map((w) => w.speed) },
        uMods: { value: WAVES.map((w) => new THREE.Vector4(w.mx, w.mz, w.mp, w.ms)) },
        uDeep: { value: new THREE.Color() },
        uShallow: { value: new THREE.Color() },
        uFoam: { value: new THREE.Color() },
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSun: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 0.3, -1) },
        uFogColor: { value: new THREE.Color() },
        uFogNear: { value: 45 },
        uFogFar: { value: 140 }
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: oceanVertex, fragmentShader: oceanFragment, uniforms });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    return mesh;
}

export function createSky() {
    const uniforms = {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSun: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 0.3, -1) },
        uFogColor: { value: new THREE.Color() },
        uFlash: { value: 0 },
        uTime: { value: 0 }
    };
    const mat = new THREE.ShaderMaterial({
        vertexShader: skyVertex, fragmentShader: skyFragment, uniforms,
        side: THREE.BackSide, depthWrite: false
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -2;
    return mesh;
}
