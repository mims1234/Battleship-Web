// Procedural low-poly models: warships, islands, mines, cell markers, canvas textures.
import * as THREE from "three";

const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
};
const cyl = (rt, rb, h, seg, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z);
    return m;
};

function hullGeometry(L, W, H, bow = 0.55, stern = 0.12) {
    const s = new THREE.Shape();
    const hl = L / 2;
    const hw = W / 2;
    s.moveTo(-hl, -hw * 0.82);
    s.lineTo(-hl + stern, -hw);
    s.lineTo(hl - bow, -hw);
    s.quadraticCurveTo(hl - bow * 0.35, -hw * 0.7, hl, 0);
    s.quadraticCurveTo(hl - bow * 0.35, hw * 0.7, hl - bow, hw);
    s.lineTo(-hl + stern, hw);
    s.lineTo(-hl, hw * 0.82);
    s.lineTo(-hl, -hw * 0.82);
    const g = new THREE.ExtrudeGeometry(s, { depth: H, bevelEnabled: false, curveSegments: 6 });
    g.rotateX(-Math.PI / 2);
    return g;
}

export function shipMaterials(theme) {
    return {
        hull: new THREE.MeshStandardMaterial({ color: theme.hull, roughness: 0.55, metalness: 0.35, flatShading: true }),
        deck: new THREE.MeshStandardMaterial({ color: theme.deck, roughness: 0.8, metalness: 0.1, flatShading: true }),
        dark: new THREE.MeshStandardMaterial({ color: 0x272b31, roughness: 0.6, metalness: 0.4, flatShading: true }),
        stripe: new THREE.MeshStandardMaterial({ color: 0x8c2f2a, roughness: 0.7, flatShading: true }),
        light: new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffc870, emissiveIntensity: 2.2 }),
        white: new THREE.MeshStandardMaterial({ color: 0xe9eef2, roughness: 0.5, emissive: 0x9aa4ad, emissiveIntensity: 0.25 })
    };
}

function turret(mats, x, z, dir = 1, scale = 1) {
    const g = new THREE.Group();
    g.add(cyl(0.12 * scale, 0.14 * scale, 0.09, 10, mats.hull, 0, 0.045, 0));
    const b1 = box(0.32 * scale, 0.035, 0.035, mats.dark, 0.16 * scale * dir, 0.06, 0.045 * scale);
    const b2 = box(0.32 * scale, 0.035, 0.035, mats.dark, 0.16 * scale * dir, 0.06, -0.045 * scale);
    g.add(b1, b2);
    g.position.set(x, 0, z);
    g.userData.turret = true;
    return g;
}

function windows(mats, x, y, z, w, n) {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) g.add(box(0.035, 0.03, 0.01, mats.light, x - w / 2 + (i + 0.5) * (w / n), y, z));
    return g;
}

// Builds a ship along +X centered at origin, waterline at y = 0.
export function buildShip(id, size, mats) {
    const L = size * 0.94 - 0.08;
    const g = new THREE.Group();
    const top = new THREE.Group();
    const muzzles = [];
    let H = 0.26;
    let W = 0.5;

    if (id === "submarine") {
        W = 0.36;
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, L - 0.34, 4, 12), mats.dark);
        body.rotation.z = Math.PI / 2;
        body.scale.set(1, 1, 0.85);
        body.position.y = 0.02;
        g.add(body);
        const deck = box(L * 0.55, 0.04, 0.12, mats.hull, 0, 0.17, 0);
        g.add(deck);
        const sail = box(0.36, 0.26, 0.11, mats.hull, 0.15, 0.3, 0);
        g.add(sail);
        g.add(box(0.06, 0.03, 0.42, mats.hull, 0.15, 0.36, 0));
        g.add(cyl(0.012, 0.012, 0.18, 5, mats.dark, 0.08, 0.5, 0));
        g.add(windows(mats, 0.15, 0.36, 0.06, 0.2, 2));
        g.add(box(0.08, 0.2, 0.02, mats.dark, -L / 2 + 0.08, 0.06, 0));
        muzzles.push(new THREE.Vector3(L / 2 - 0.1, 0.12, 0));
        g.userData = { length: L, muzzles, height: 0.42 };
        return g;
    }

    if (id === "carrier") { W = 0.74; H = 0.3; }
    if (id === "battleship") { W = 0.6; H = 0.27; }
    if (id === "cruiser") { W = 0.5; H = 0.25; }
    if (id === "destroyer") { W = 0.4; H = 0.22; }

    const hull = new THREE.Mesh(hullGeometry(L, W, H + 0.12, id === "carrier" ? 0.4 : 0.55), mats.hull);
    hull.position.y = -0.12;
    g.add(hull);
    const stripe = new THREE.Mesh(hullGeometry(L + 0.01, W + 0.01, 0.05, id === "carrier" ? 0.4 : 0.55), mats.stripe);
    stripe.position.y = -0.03;
    g.add(stripe);
    const deck = new THREE.Mesh(hullGeometry(L - 0.06, W - 0.06, 0.02, id === "carrier" ? 0.38 : 0.5), mats.deck);
    deck.position.y = H;
    g.add(deck);
    top.position.y = H + 0.02;
    g.add(top);

    if (id === "carrier") {
        const fd = box(L + 0.05, 0.05, W + 0.12, mats.deck, -0.02, 0.02, 0);
        top.add(fd);
        for (let i = 0; i < 6; i++) top.add(box(0.18, 0.006, 0.02, mats.white, -L / 2 + 0.35 + i * (L - 0.6) / 5, 0.05, 0));
        top.add(box(L * 0.7, 0.006, 0.012, mats.white, 0.15, 0.05, 0.22));
        const island = box(0.5, 0.34, 0.14, mats.hull, 0.45, 0.22, -W / 2 + 0.02);
        top.add(island);
        top.add(box(0.2, 0.16, 0.1, mats.hull, 0.5, 0.46, -W / 2 + 0.02));
        top.add(cyl(0.015, 0.015, 0.3, 5, mats.dark, 0.55, 0.66, -W / 2 + 0.02));
        top.add(windows(mats, 0.45, 0.3, -W / 2 + 0.095, 0.42, 5));
        for (let i = 0; i < 3; i++) {
            const plane = new THREE.Group();
            plane.add(box(0.2, 0.03, 0.04, mats.white, 0, 0, 0));
            plane.add(box(0.06, 0.012, 0.22, mats.white, 0.01, 0.005, 0));
            plane.add(box(0.03, 0.012, 0.09, mats.white, -0.09, 0.01, 0));
            plane.position.set(-L / 2 + 0.45 + i * 0.4, 0.065, 0.12 - (i % 2) * 0.24);
            plane.rotation.y = 0.3 * (i % 2 ? 1 : -1);
            top.add(plane);
        }
        muzzles.push(new THREE.Vector3(0.45, H + 0.5, -W / 2));
    } else if (id === "battleship") {
        top.add(turret(mats, L / 2 - 0.55, 0, 1, 1.1));
        top.add(turret(mats, L / 2 - 0.95, 0, 1, 1.1));
        top.add(turret(mats, -L / 2 + 0.5, 0, -1, 1.1));
        top.add(box(0.75, 0.22, 0.34, mats.hull, -0.05, 0.11, 0));
        top.add(box(0.42, 0.2, 0.26, mats.hull, 0.02, 0.32, 0));
        top.add(box(0.2, 0.14, 0.18, mats.hull, 0.05, 0.49, 0));
        top.add(cyl(0.07, 0.08, 0.3, 8, mats.dark, -0.32, 0.36, 0));
        top.add(cyl(0.012, 0.012, 0.4, 5, mats.dark, 0.08, 0.75, 0));
        top.add(windows(mats, 0.02, 0.34, 0.135, 0.36, 5));
        top.add(windows(mats, 0.02, 0.34, -0.135, 0.36, 5));
        muzzles.push(new THREE.Vector3(L / 2 - 0.25, H + 0.1, 0), new THREE.Vector3(-L / 2 + 0.2, H + 0.1, 0));
    } else if (id === "cruiser") {
        top.add(turret(mats, L / 2 - 0.45, 0, 1, 0.95));
        top.add(turret(mats, -L / 2 + 0.4, 0, -1, 0.95));
        top.add(box(0.6, 0.18, 0.28, mats.hull, 0, 0.09, 0));
        top.add(box(0.3, 0.16, 0.2, mats.hull, 0.08, 0.26, 0));
        top.add(cyl(0.055, 0.065, 0.24, 8, mats.dark, -0.15, 0.3, 0));
        top.add(cyl(0.055, 0.065, 0.22, 8, mats.dark, -0.3, 0.28, 0));
        top.add(cyl(0.012, 0.012, 0.36, 5, mats.dark, 0.1, 0.55, 0));
        top.add(windows(mats, 0.08, 0.28, 0.105, 0.24, 4));
        muzzles.push(new THREE.Vector3(L / 2 - 0.2, H + 0.1, 0));
    } else if (id === "destroyer") {
        top.add(turret(mats, L / 2 - 0.35, 0, 1, 0.8));
        top.add(box(0.4, 0.16, 0.22, mats.hull, -0.05, 0.08, 0));
        top.add(box(0.18, 0.12, 0.16, mats.hull, 0.03, 0.22, 0));
        top.add(cyl(0.05, 0.06, 0.2, 8, mats.dark, -0.2, 0.22, 0));
        const tubes = cyl(0.035, 0.035, 0.26, 6, mats.dark, -L / 2 + 0.25, 0.04, 0.08);
        tubes.rotation.z = Math.PI / 2;
        top.add(tubes);
        top.add(cyl(0.01, 0.01, 0.3, 5, mats.dark, 0.05, 0.42, 0));
        top.add(windows(mats, 0.03, 0.24, 0.085, 0.14, 3));
        muzzles.push(new THREE.Vector3(L / 2 - 0.15, H + 0.08, 0));
    }

    g.userData = { length: L, muzzles, height: H + 0.4 };
    return g;
}

// ---------- terrain ----------
export function buildIsland(seed, mats) {
    const g = new THREE.Group();
    const r = (n) => { const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.52, 0.12, 9), mats.sand);
    sand.position.y = 0.0;
    g.add(sand);
    const rockGeo = new THREE.DodecahedronGeometry(0.34, 0);
    const rock = new THREE.Mesh(rockGeo, mats.rock);
    rock.scale.set(1, 0.6 + r(1) * 0.5, 0.9);
    rock.position.set((r(2) - 0.5) * 0.15, 0.12, (r(3) - 0.5) * 0.15);
    rock.rotation.y = r(4) * 6;
    g.add(rock);
    const rock2 = new THREE.Mesh(rockGeo, mats.rock);
    rock2.scale.set(0.5, 0.45, 0.5);
    rock2.position.set(0.22 * (r(5) > 0.5 ? 1 : -1), 0.08, 0.18 * (r(6) > 0.5 ? 1 : -1));
    g.add(rock2);
    const grass = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), mats.grass);
    grass.scale.set(1, 0.4, 1);
    grass.position.set(rock.position.x, 0.12 + rock.scale.y * 0.3, rock.position.z);
    g.add(grass);
    if (r(7) > 0.35) {
        const palm = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, 0.5, 5), mats.trunk);
        trunk.position.y = 0.25;
        trunk.rotation.z = 0.2;
        palm.add(trunk);
        for (let i = 0; i < 5; i++) {
            const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 4), mats.leaf);
            leaf.position.set(0.05, 0.5, 0);
            leaf.rotation.set(0, (i / 5) * Math.PI * 2, 1.9);
            leaf.translateY(0.12);
            palm.add(leaf);
        }
        palm.position.set(-0.12, 0.15, -0.1);
        g.add(palm);
    }
    // little lighthouse on some islands
    if (r(8) > 0.7) {
        const lh = new THREE.Group();
        lh.add(cyl(0.04, 0.06, 0.34, 8, mats.white, 0, 0.17, 0));
        lh.add(cyl(0.05, 0.05, 0.06, 8, mats.lamp, 0, 0.37, 0));
        const roof = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.07, 8), mats.red);
        roof.position.y = 0.43;
        lh.add(roof);
        lh.position.set(0.2, 0.06, -0.15);
        g.add(lh);
    }
    return g;
}

export function terrainMaterials() {
    return {
        sand: new THREE.MeshStandardMaterial({ color: 0xd9c38f, roughness: 1, flatShading: true }),
        rock: new THREE.MeshStandardMaterial({ color: 0x6f6a63, roughness: 0.95, flatShading: true }),
        grass: new THREE.MeshStandardMaterial({ color: 0x4f8a4a, roughness: 1, flatShading: true }),
        trunk: new THREE.MeshStandardMaterial({ color: 0x7a5534, roughness: 1, flatShading: true }),
        leaf: new THREE.MeshStandardMaterial({ color: 0x3f9a4c, roughness: 0.9, flatShading: true }),
        white: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.6 }),
        lamp: new THREE.MeshStandardMaterial({ color: 0xfff1b0, emissive: 0xffd36a, emissiveIntensity: 3 }),
        red: new THREE.MeshStandardMaterial({ color: 0xb33a2e, roughness: 0.6 }),
        mine: new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.5, metalness: 0.6, flatShading: true }),
        mineLight: new THREE.MeshStandardMaterial({ color: 0xff3b2f, emissive: 0xff2a1a, emissiveIntensity: 3 })
    };
}

export function buildMine(mats) {
    const g = new THREE.Group();
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), mats.mine);
    s.position.y = 0.08;
    g.add(s);
    const spikeGeo = new THREE.ConeGeometry(0.025, 0.09, 5);
    [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0.7, 0.7, 0.7], [-0.7, 0.7, -0.7]].forEach(([x, y, z]) => {
        const sp = new THREE.Mesh(spikeGeo, mats.mine);
        const dir = new THREE.Vector3(x, y, z).normalize();
        sp.position.copy(dir.clone().multiplyScalar(0.17)).add(new THREE.Vector3(0, 0.08, 0));
        sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        g.add(sp);
    });
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), mats.mineLight);
    light.position.y = 0.26;
    g.add(light);
    g.userData.light = light;
    return g;
}

// ---------- canvas textures ----------
export function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
}

export function gridTexture(accent, label = true) {
    const S = 1024;
    const c = makeCanvas(S, S);
    const g = c.getContext("2d");
    const u = S / 12; // 12 units: 1 margin + 10 cells + 1 margin
    g.clearRect(0, 0, S, S);
    g.fillStyle = hexA(accent, 0.07);
    g.fillRect(u, u, u * 10, u * 10);
    g.strokeStyle = hexA(accent, 0.5);
    g.lineWidth = 2;
    for (let i = 0; i <= 10; i++) {
        g.beginPath(); g.moveTo(u + i * u, u); g.lineTo(u + i * u, u * 11); g.stroke();
        g.beginPath(); g.moveTo(u, u + i * u); g.lineTo(u * 11, u + i * u); g.stroke();
    }
    g.lineWidth = 6;
    g.strokeStyle = hexA(accent, 0.85);
    g.shadowColor = accent;
    g.shadowBlur = 18;
    g.strokeRect(u - 2, u - 2, u * 10 + 4, u * 10 + 4);
    g.shadowBlur = 0;
    // corner brackets
    g.lineWidth = 8;
    const br = u * 0.6;
    [[u, u, 1, 1], [u * 11, u, -1, 1], [u, u * 11, 1, -1], [u * 11, u * 11, -1, -1]].forEach(([x, y, sx, sy]) => {
        g.beginPath();
        g.moveTo(x - sx * 10, y + sy * br);
        g.lineTo(x - sx * 10, y - sy * 10);
        g.lineTo(x + sx * br, y - sy * 10);
        g.stroke();
    });
    if (label) {
        g.fillStyle = hexA(accent, 0.95);
        g.font = `700 ${Math.round(u * 0.42)}px Orbitron, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        for (let i = 0; i < 10; i++) {
            g.fillText(String.fromCharCode(65 + i), u * 1.5 + i * u, u * 0.55);
            g.fillText(String(i + 1), u * 0.5, u * 1.5 + i * u);
        }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

export function cellTexture(kind) {
    const S = 128;
    const c = makeCanvas(S, S);
    const g = c.getContext("2d");
    g.clearRect(0, 0, S, S);
    if (kind === "border") {
        g.strokeStyle = "#ffffff";
        g.shadowColor = "#ffffff";
        g.shadowBlur = 16;
        g.lineWidth = 9;
        roundRect(g, 12, 12, S - 24, S - 24, 14);
        g.stroke();
        g.shadowBlur = 0;
        g.fillStyle = "rgba(255,255,255,0.16)";
        roundRect(g, 12, 12, S - 24, S - 24, 14);
        g.fill();
    } else if (kind === "fill") {
        g.fillStyle = "#ffffff";
        roundRect(g, 8, 8, S - 16, S - 16, 12);
        g.fill();
    } else if (kind === "cross") {
        g.strokeStyle = "#ffffff";
        g.lineWidth = 8;
        g.shadowColor = "#ffffff";
        g.shadowBlur = 10;
        g.beginPath(); g.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2); g.stroke();
        [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy]) => {
            g.beginPath();
            g.moveTo(S / 2 + dx * S * 0.16, S / 2 + dy * S * 0.16);
            g.lineTo(S / 2 + dx * S * 0.46, S / 2 + dy * S * 0.46);
            g.stroke();
        });
    } else if (kind === "soft") {
        const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        grd.addColorStop(0, "rgba(255,255,255,0.9)");
        grd.addColorStop(0.5, "rgba(255,255,255,0.35)");
        grd.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grd;
        g.fillRect(0, 0, S, S);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

export function textSprite(text, color = "#ffffff", size = 0.7) {
    const c = makeCanvas(256, 128);
    const g = c.getContext("2d");
    g.font = "800 84px Orbitron, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "rgba(0,0,0,0.7)";
    g.shadowBlur = 12;
    g.fillStyle = color;
    g.fillText(text, 128, 66);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }));
    s.scale.set(size * 2, size, 1);
    s.renderOrder = 10;
    return s;
}

function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

function hexA(hex, a) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- markers ----------
export function markerKit() {
    const k = {};
    k.missPeg = new THREE.CylinderGeometry(0.075, 0.09, 0.16, 10);
    k.missRing = new THREE.RingGeometry(0.16, 0.22, 24).rotateX(-Math.PI / 2);
    k.hitPeg = new THREE.CylinderGeometry(0.085, 0.1, 0.3, 10);
    k.disc = new THREE.CircleGeometry(0.4, 24).rotateX(-Math.PI / 2);
    k.dot = new THREE.CircleGeometry(0.06, 12).rotateX(-Math.PI / 2);
    k.diamond = new THREE.RingGeometry(0.2, 0.28, 4).rotateX(-Math.PI / 2);
    k.mats = {
        miss: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.4, emissive: 0xbfcbd3, emissiveIntensity: 0.35 }),
        missRing: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }),
        hit: new THREE.MeshStandardMaterial({ color: 0xff3b2f, emissive: 0xff2a1a, emissiveIntensity: 2.4 }),
        sunkDisc: new THREE.MeshBasicMaterial({ color: 0x8a1a1d, transparent: true, opacity: 0.55, depthWrite: false }),
        scorch: new THREE.MeshBasicMaterial({ color: 0x111114, transparent: true, opacity: 0.6, depthWrite: false }),
        clear: new THREE.MeshBasicMaterial({ color: 0xbfe7ff, transparent: true, opacity: 0.35, depthWrite: false }),
        contact: new THREE.MeshBasicMaterial({ color: 0xffc457, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false })
    };
    return k;
}
