// Battleship v2 — procedural audio: layered SFX, ocean ambience, adaptive generative score.

export class Audio {
    constructor(settings) {
        this.settings = settings; // { master, music, sfx, haptics }
        this.ctx = null;
        this.tension = 0;
        this.state = "menu";
        this.step = 0;
        this.nextTime = 0;
        this.timer = null;
        this.raining = false;
    }

    ensure() {
        if (this.ctx) return true;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        const ctx = new AC();
        this.ctx = ctx;
        this.comp = ctx.createDynamicsCompressor();
        this.comp.threshold.value = -14;
        this.comp.ratio.value = 4;
        this.master = ctx.createGain();
        this.master.connect(this.comp).connect(ctx.destination);
        this.sfxBus = ctx.createGain();
        this.musicBus = ctx.createGain();
        this.ambBus = ctx.createGain();
        this.sfxBus.connect(this.master);
        this.musicBus.connect(this.master);
        this.ambBus.connect(this.master);
        // shared noise
        const len = ctx.sampleRate * 2;
        this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1;
            d[i] = w;
            last = (last + 0.02 * w) / 1.02;
        }
        this.brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const b = this.brownBuf.getChannelData(0);
        last = 0;
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1;
            last = (last + 0.02 * w) / 1.02;
            b[i] = last * 3.5;
        }
        // simple feedback delay for sonar / music space
        this.delay = ctx.createDelay(1.5);
        this.delay.delayTime.value = 0.32;
        this.fb = ctx.createGain();
        this.fb.gain.value = 0.38;
        const dl = ctx.createBiquadFilter();
        dl.type = "lowpass";
        dl.frequency.value = 2400;
        this.delay.connect(dl).connect(this.fb).connect(this.delay);
        this.delayOut = ctx.createGain();
        this.delayOut.gain.value = 0.5;
        dl.connect(this.delayOut).connect(this.master);
        this.applyVolumes();
        this._startAmbience();
        this._startMusic();
        return true;
    }

    resume() {
        if (!this.ensure()) return;
        if (this.ctx.state === "suspended") this.ctx.resume();
    }

    applyVolumes() {
        if (!this.ctx) return;
        const s = this.settings;
        const t = this.ctx.currentTime;
        const on = s.sound !== false;
        this.master.gain.setTargetAtTime(on ? s.master : 0, t, 0.05);
        this.sfxBus.gain.setTargetAtTime(s.sfx, t, 0.05);
        this.musicBus.gain.setTargetAtTime(s.music * 0.55, t, 0.2);
        this.ambBus.gain.setTargetAtTime(s.music * 0.5 + 0.15, t, 0.2);
    }

    haptic(p) {
        if (this.settings.haptics !== false && this.settings.sound !== false && navigator.vibrate) {
            try { navigator.vibrate(p); } catch (e) { /* ignore */ }
        }
    }

    // ---------- primitives ----------
    _env(g, t, a, peak, dur) {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + a);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }

    tone(freq, dur, { type = "sine", vol = 0.3, slide = null, delay = 0, attack = 0.008, bus = null, send = 0 } = {}) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime + delay;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
        this._env(g, t, attack, vol, dur);
        o.connect(g).connect(bus || this.sfxBus);
        if (send) {
            const s = this.ctx.createGain();
            s.gain.value = send;
            g.connect(s).connect(this.delay);
        }
        o.start(t);
        o.stop(t + dur + 0.05);
    }

    noise(dur, { vol = 0.3, type = "lowpass", from = 1200, to = 200, q = 0.7, delay = 0, attack = 0.005, brown = false, bus = null } = {}) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime + delay;
        const src = this.ctx.createBufferSource();
        src.buffer = brown ? this.brownBuf : this.noiseBuf;
        src.loop = true;
        const f = this.ctx.createBiquadFilter();
        f.type = type;
        f.Q.value = q;
        f.frequency.setValueAtTime(from, t);
        f.frequency.exponentialRampToValueAtTime(Math.max(to, 20), t + dur);
        const g = this.ctx.createGain();
        this._env(g, t, attack, vol, dur);
        src.connect(f).connect(g).connect(bus || this.sfxBus);
        src.start(t, Math.random());
        src.stop(t + dur + 0.05);
    }

    // ---------- SFX ----------
    cannon() {
        this.tone(95, 0.35, { type: "sine", vol: 0.55, slide: 38 });
        this.noise(0.35, { vol: 0.5, from: 2500, to: 120 });
        this.noise(0.9, { vol: 0.12, from: 600, to: 80, delay: 0.05, brown: true });
        this.haptic(14);
    }
    whistle(dur = 0.6) {
        this.tone(1900, dur, { type: "sine", vol: 0.05, slide: 700, attack: 0.1 });
    }
    splash() {
        this.noise(0.55, { vol: 0.32, type: "bandpass", from: 2400, to: 500, q: 0.8 });
        this.noise(0.9, { vol: 0.1, type: "highpass", from: 3000, to: 1200, delay: 0.08 });
        this.tone(220, 0.12, { vol: 0.08, slide: 120 });
        this.haptic(8);
    }
    explosion(big = false) {
        const k = big ? 1.4 : 1;
        this.tone(70, 0.6 * k, { vol: 0.6, slide: 30 });
        this.noise(0.7 * k, { vol: 0.55, from: 3000, to: 90 });
        this.noise(1.6 * k, { vol: 0.2, from: 500, to: 60, delay: 0.1, brown: true });
        if (big) {
            this.noise(1.2, { vol: 0.12, type: "bandpass", from: 800, to: 200, delay: 0.35 });
            this.tone(55, 1.3, { vol: 0.35, slide: 28, delay: 0.15 });
        }
        this.haptic(big ? [40, 40, 60, 40, 90] : [22, 30, 22]);
    }
    deflect() {
        this.tone(1400, 0.25, { type: "triangle", vol: 0.18, slide: 900, send: 0.3 });
        this.tone(2100, 0.18, { type: "sine", vol: 0.1, delay: 0.03 });
        this.noise(0.15, { vol: 0.2, type: "highpass", from: 4000, to: 2000 });
    }
    sonar() {
        this.tone(1180, 0.9, { type: "sine", vol: 0.22, slide: 1100, send: 0.7, attack: 0.004 });
        this.tone(590, 0.6, { type: "sine", vol: 0.06, delay: 0.02 });
    }
    plane(dur = 1.7) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(70, t);
        o.frequency.linearRampToValueAtTime(95, t + dur * 0.5);
        o.frequency.linearRampToValueAtTime(60, t + dur);
        const f = this.ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 500;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + dur * 0.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(f).connect(g).connect(this.sfxBus);
        o.start(t);
        o.stop(t + dur + 0.05);
    }
    torpedo() {
        this.noise(0.3, { vol: 0.25, from: 900, to: 300 });
        this.noise(1.4, { vol: 0.12, type: "bandpass", from: 500, to: 900, q: 2, delay: 0.1, attack: 0.2 });
    }
    repair() {
        [0, 0.12, 0.24].forEach((d, i) => this.tone(1300 + i * 150, 0.06, { type: "square", vol: 0.06, delay: d }));
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.25, { type: "triangle", vol: 0.12, delay: 0.3 + i * 0.07 }));
    }
    move() {
        this.noise(0.9, { vol: 0.15, from: 400, to: 900, attack: 0.25, brown: true });
        this.tone(110, 0.8, { type: "sawtooth", vol: 0.05, slide: 140, attack: 0.2 });
    }
    mine() {
        this.explosion(true);
        this.tone(160, 0.5, { type: "square", vol: 0.08, delay: 0.5, slide: 80 });
    }
    thunder() {
        this.noise(2.6, { vol: 0.35, from: 900, to: 40, brown: true, attack: 0.05 });
        this.noise(1.2, { vol: 0.12, from: 2500, to: 200, delay: 0.05 });
    }
    click() { this.tone(820, 0.04, { type: "sine", vol: 0.08 }); }
    hover() { this.tone(1500, 0.02, { type: "sine", vol: 0.015 }); }
    place() { this.tone(330, 0.12, { type: "triangle", vol: 0.16, slide: 520 }); this.noise(0.25, { vol: 0.08, type: "bandpass", from: 900, to: 400 }); }
    rotate() { this.tone(480, 0.06, { type: "square", vol: 0.06 }); }
    invalid() { this.tone(160, 0.14, { type: "square", vol: 0.08, slide: 120 }); }
    turn() { this.tone(660, 0.1, { type: "triangle", vol: 0.1 }); this.tone(990, 0.14, { type: "triangle", vol: 0.08, delay: 0.08 }); }
    alarm() { [0, 0.25].forEach((d) => this.tone(440, 0.2, { type: "square", vol: 0.06, slide: 330, delay: d })); }
    achieve() { [660, 880, 990, 1320].forEach((f, i) => this.tone(f, 0.18, { type: "triangle", vol: 0.14, delay: i * 0.07, send: 0.25 })); }
    win() {
        [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, 0.32, { type: "triangle", vol: 0.2, delay: i * 0.13, send: 0.3 }));
        this.haptic([40, 60, 40, 60, 120]);
    }
    lose() {
        [392, 349, 311, 262, 196].forEach((f, i) => this.tone(f, 0.45, { type: "sawtooth", vol: 0.1, delay: i * 0.2, send: 0.2 }));
        this.haptic([60, 80, 140]);
    }

    // ---------- ambience ----------
    _startAmbience() {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this.brownBuf;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 520;
        const g = ctx.createGain();
        g.gain.value = 0.35;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.11;
        const lg = ctx.createGain();
        lg.gain.value = 0.2;
        lfo.connect(lg).connect(g.gain);
        src.connect(f).connect(g).connect(this.ambBus);
        src.start();
        lfo.start();
        // rain layer (toggled)
        const r = ctx.createBufferSource();
        r.buffer = this.noiseBuf;
        r.loop = true;
        const rf = ctx.createBiquadFilter();
        rf.type = "highpass";
        rf.frequency.value = 2500;
        this.rainGain = ctx.createGain();
        this.rainGain.gain.value = 0;
        r.connect(rf).connect(this.rainGain).connect(this.ambBus);
        r.start();
        this.setRain(this.raining);
    }

    setRain(on) {
        this.raining = on;
        if (this.rainGain) this.rainGain.gain.setTargetAtTime(on ? 0.06 : 0, this.ctx.currentTime, 0.8);
    }

    // ---------- adaptive score ----------
    // Dm – Bb – F – C, tension adds pulse, hats and arpeggios.
    setMusicState(state) { this.state = state; }
    setTension(v) { this.tension = Math.max(0, Math.min(1, v)); }

    _startMusic() {
        this.nextTime = this.ctx.currentTime + 0.1;
        this.timer = setInterval(() => this._schedule(), 60);
    }

    _schedule() {
        const ctx = this.ctx;
        if (!ctx || ctx.state !== "running") return;
        const chords = [[62, 65, 69], [58, 62, 65], [65, 69, 72], [60, 64, 67]];
        const bassNotes = [38, 34, 41, 36];
        while (this.nextTime < ctx.currentTime + 0.25) {
            const battle = this.state === "battle";
            const bpm = battle ? 84 + this.tension * 40 : 70;
            const sixteenth = 60 / bpm / 4;
            const t = this.nextTime;
            const step = this.step % 64;
            const bar = Math.floor(step / 16);
            const chord = chords[bar];
            const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
            const delay = t - ctx.currentTime;
            if (step % 16 === 0) {
                chord.forEach((m, i) => this.tone(mtof(m - 12), sixteenth * 16 * 1.05, {
                    type: "sawtooth", vol: 0.035, attack: 0.9, delay, bus: this.musicBus, send: i === 0 ? 0.1 : 0
                }));
                this.tone(mtof(chord[0] - 24), sixteenth * 16, { type: "sine", vol: 0.07, attack: 0.5, delay, bus: this.musicBus });
            }
            if (battle || this.state === "placement") {
                if (step % 4 === 0) {
                    this.tone(mtof(bassNotes[bar]), sixteenth * 2.2, { type: "triangle", vol: 0.1 + this.tension * 0.06, delay, bus: this.musicBus });
                    this.tone(60, 0.18, { type: "sine", vol: battle ? 0.16 + this.tension * 0.12 : 0.06, slide: 35, delay, bus: this.musicBus });
                }
                if (battle && this.tension > 0.35 && step % 2 === 1) {
                    this.noise(0.04, { vol: 0.025 + this.tension * 0.02, type: "highpass", from: 7000, to: 6000, delay, bus: this.musicBus });
                }
                if (battle && this.tension > 0.65 && step % 2 === 0) {
                    const arp = chord[(step / 2) % 3] + 12;
                    this.tone(mtof(arp), sixteenth * 1.5, { type: "square", vol: 0.022, delay, bus: this.musicBus, send: 0.25 });
                }
            }
            this.nextTime += sixteenth;
            this.step++;
        }
    }
}
