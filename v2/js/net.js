// Battleship v2 — online duels over WebRTC (PeerJS public broker), no game server needed.
import { Emitter } from "./util.js";

const PEERJS_URL = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
const PEERJS_SRI = "sha384-nlUQ8ZqCbvStErob+biJNzSgltf6urV3VGqhfIfzhmg9RXmpeRm76ELw0pYnKlTR";
const PREFIX = "batman-bsv2-";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let loading = null;
function loadPeerJS() {
    if (window.Peer) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = PEERJS_URL;
        s.integrity = PEERJS_SRI;
        s.crossOrigin = "anonymous";
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { loading = null; reject(new Error("Could not load the networking library.")); };
        document.head.appendChild(s);
    });
    return loading;
}

export function makeRoomCode() {
    let s = "";
    const a = new Uint32Array(5);
    (window.crypto || {}).getRandomValues?.(a);
    for (let i = 0; i < 5; i++) s += ALPHABET[(a[i] || Math.floor(Math.random() * 1e9)) % ALPHABET.length];
    return s;
}

export class Net extends Emitter {
    constructor() {
        super();
        this.peer = null;
        this.conn = null;
        this.pending = null;
        this.queue = [];
        this.waiters = [];
        this.isHost = false;
        this.code = null;
    }

    async host() {
        await loadPeerJS();
        this.isHost = true;
        for (let attempt = 0; attempt < 4; attempt++) {
            const code = makeRoomCode();
            try {
                await this._open(PREFIX + code);
                this.code = code;
                this.peer.on("connection", (conn) => {
                    if (this.conn) { conn.close(); return; }
                    this._bind(conn);
                });
                return code;
            } catch (err) {
                if (!String(err?.type || err).includes("unavailable-id")) throw err;
            }
        }
        throw new Error("Could not reserve a room code. Try again.");
    }

    async join(code) {
        await loadPeerJS();
        this.isHost = false;
        this.code = code.toUpperCase().trim();
        await this._open(undefined);
        return new Promise((resolve, reject) => {
            const conn = this.peer.connect(PREFIX + this.code, { reliable: true });
            const to = setTimeout(() => reject(new Error("Room not found or host offline.")), 12000);
            conn.on("open", () => { clearTimeout(to); resolve(); });
            conn.on("error", (e) => { clearTimeout(to); reject(e); });
            this._bind(conn);
        });
    }

    _open(id) {
        return new Promise((resolve, reject) => {
            const peer = id ? new window.Peer(id, { debug: 0 }) : new window.Peer({ debug: 0 });
            const onErr = (e) => { peer.destroy(); reject(e); };
            peer.once("open", () => {
                peer.off("error", onErr);
                peer.on("error", (e) => {
                    if (e?.type === "peer-unavailable") this.emit("error", new Error("Room not found or host offline."));
                    else this.emit("error", e);
                });
                peer.on("disconnected", () => { try { peer.reconnect(); } catch (er) { /* ignore */ } });
                resolve();
            });
            peer.once("error", onErr);
            this.peer = peer;
        });
    }

    _bind(conn) {
        this.conn = conn;
        conn.on("open", () => this.emit("connected"));
        conn.on("data", (msg) => this._onData(msg));
        conn.on("close", () => this.emit("closed"));
        conn.on("error", (e) => this.emit("error", e));
        if (conn.open) this.emit("connected");
    }

    _onData(msg) {
        if (!msg || typeof msg !== "object") return;
        if (msg.t === "result" && this.pending) {
            const r = this.pending;
            this.pending = null;
            r(msg.result);
            return;
        }
        if (msg.t === "action") {
            if (this.waiters.length) this.waiters.shift()(msg.action);
            else this.queue.push(msg.action);
            return;
        }
        this.emit("message", msg);
    }

    send(msg) {
        if (this.conn?.open) this.conn.send(msg);
    }

    // Our attack: send it and wait for the opponent's authoritative result.
    request(action) {
        return new Promise((resolve) => {
            this.pending = resolve;
            this.send({ t: "action", action });
        });
    }

    nextAction() {
        if (this.queue.length) return Promise.resolve(this.queue.shift());
        return new Promise((resolve) => this.waiters.push(resolve));
    }

    resetTurnState() {
        this.queue = [];
        this.waiters = [];
        this.pending = null;
    }

    close() {
        try { this.conn?.close(); } catch (e) { /* ignore */ }
        try { this.peer?.destroy(); } catch (e) { /* ignore */ }
        this.conn = null;
        this.peer = null;
    }
}

export class RemoteAgent {
    constructor(net) { this.kind = "remote"; this.net = net; }
    chooseAction() { return this.net.nextAction(); }
}
