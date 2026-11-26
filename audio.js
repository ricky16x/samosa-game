(() => {
  "use strict";

  const AudioCtx = window.AudioContext || window.webkitAudioContext;

  class SamosaAudio {
    constructor() {
      this.ac = null;
      this.master = null;
      this.musicGain = null;
      this.trafficGain = null;
      this.sfxGain = null;

      this.musicEnabled = true;
      this.sfxEnabled = true;
      this.playing = false;
      this.paused = false;

      this.step = 0;
      this.nextNoteTime = 0;
      this.seqTimer = null;
      this.trafficTimer = null;

      this.engineOsc = null;
      this.engineGain = null;
      this.rumbleGain = null;

      // Optional real audio files in /assets/audio/
      this.realMusicEl = null;
      this.realMusicReady = false;
      this.realTrafficEl = null;
      this.realTrafficReady = false;
      this._probeRealAudio();
    }

    _probeRealAudio() {
      // If user places assets/audio/bg-music.mp3 or delhi-traffic.mp3, use them!
      const bg = new Audio("/assets/audio/bg-music.mp3");
      bg.loop = true;
      bg.preload = "auto";
      bg.volume = 0.45;
      bg.addEventListener("canplaythrough", () => {
        this.realMusicReady = true;
        this._syncRealTracks();
      }, { once: true });
      bg.addEventListener("error", () => {
        this.realMusicReady = false;
      }, { once: true });
      this.realMusicEl = bg;

      const tr = new Audio("/assets/audio/delhi-traffic.mp3");
      tr.loop = true;
      tr.preload = "auto";
      tr.volume = 0.35;
      tr.addEventListener("canplaythrough", () => {
        this.realTrafficReady = true;
        this._syncRealTracks();
      }, { once: true });
      tr.addEventListener("error", () => {
        this.realTrafficReady = false;
      }, { once: true });
      this.realTrafficEl = tr;
    }

    _syncRealTracks() {
      if (this.realMusicEl && this.realMusicReady) {
        if (this.musicEnabled) {
          this.realMusicEl.volume = this.playing && !this.paused ? 0.5 : 0.22;
          if (this.realMusicEl.paused && this.ac) {
            this.realMusicEl.play().catch(() => {});
          }
        } else {
          this.realMusicEl.pause();
        }
      }
      if (this.realTrafficEl && this.realTrafficReady) {
        if (this.sfxEnabled && this.playing && !this.paused) {
          this.realTrafficEl.volume = 0.36;
          if (this.realTrafficEl.paused && this.ac) {
            this.realTrafficEl.play().catch(() => {});
          }
        } else {
          this.realTrafficEl.pause();
        }
      }
    }

    init() {
      if (this.ac) {
        if (this.ac.state === "suspended") this.ac.resume().catch(() => {});
        this._syncRealTracks();
        return true;
      }
      if (!AudioCtx) return false;
      try {
        this.ac = new AudioCtx();
        const comp = this.ac.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 18;
        comp.ratio.value = 6;
        comp.attack.value = 0.005;
        comp.release.value = 0.15;

        this.master = this.ac.createGain();
        this.master.gain.value = 0.85;
        comp.connect(this.master);
        this.master.connect(this.ac.destination);

        this.musicGain = this.ac.createGain();
        this.musicGain.gain.value = this.musicEnabled ? 0.42 : 0;
        this.musicGain.connect(comp);

        this.trafficGain = this.ac.createGain();
        this.trafficGain.gain.value = this.sfxEnabled ? 0.38 : 0;
        this.trafficGain.connect(comp);

        this.sfxGain = this.ac.createGain();
        this.sfxGain.gain.value = this.sfxEnabled ? 0.55 : 0;
        this.sfxGain.connect(comp);

        this._initAmbientBed();
        this._startSequencer();
        this._scheduleNextTrafficSound();
        this._syncRealTracks();
        return true;
      } catch (e) {
        return false;
      }
    }

    setMusic(on) {
      this.musicEnabled = on;
      if (this.musicGain && this.ac) {
        this.musicGain.gain.setTargetAtTime(on ? 0.42 : 0, this.ac.currentTime, 0.04);
      }
      this._syncRealTracks();
    }

    setSfx(on) {
      this.sfxEnabled = on;
      if (this.ac) {
        if (this.trafficGain) {
          this.trafficGain.gain.setTargetAtTime(on ? 0.38 : 0, this.ac.currentTime, 0.04);
        }
        if (this.sfxGain) {
          this.sfxGain.gain.setTargetAtTime(on ? 0.55 : 0, this.ac.currentTime, 0.04);
        }
      }
      this._syncRealTracks();
    }

    setState(playing, paused) {
      this.playing = playing;
      this.paused = paused;
      this._syncRealTracks();
      if (!this.ac) return;
      const t = this.ac.currentTime;
      if (this.engineGain) {
        this.engineGain.gain.setTargetAtTime(playing && !paused ? 0.075 : 0.012, t, 0.08);
      }
      if (this.rumbleGain) {
        this.rumbleGain.gain.setTargetAtTime(playing && !paused ? 0.09 : 0.025, t, 0.1);
      }
    }

    updateEngine(speedRatio, boosting) {
      if (!this.ac || !this.engineOsc || !this.engineGain) return;
      const t = this.ac.currentTime;
      const baseFreq = 52 + speedRatio * 48 + (boosting ? 28 : 0);
      this.engineOsc.frequency.setTargetAtTime(baseFreq, t, 0.05);
    }

    _createNoiseBuffer(seconds = 2) {
      const len = Math.floor(this.ac.sampleRate * seconds);
      const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const data = buf.getChannelData(0);
      let lastOut = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (lastOut + 0.04 * white) / 1.04;
        lastOut = data[i];
        data[i] *= 2.8;
      }
      return buf;
    }

    _initAmbientBed() {
      const noiseBuf = this._createNoiseBuffer(2);

      const rumble = this.ac.createBufferSource();
      rumble.buffer = noiseBuf;
      rumble.loop = true;

      const rumbleFilter = this.ac.createBiquadFilter();
      rumbleFilter.type = "lowpass";
      rumbleFilter.frequency.value = 260;

      this.rumbleGain = this.ac.createGain();
      this.rumbleGain.gain.value = 0.025;

      rumble.connect(rumbleFilter);
      rumbleFilter.connect(this.rumbleGain);
      this.rumbleGain.connect(this.trafficGain);
      rumble.start();

      this.engineOsc = this.ac.createOscillator();
      this.engineOsc.type = "sawtooth";
      this.engineOsc.frequency.value = 58;

      const engFilter = this.ac.createBiquadFilter();
      engFilter.type = "lowpass";
      engFilter.frequency.value = 220;

      this.engineGain = this.ac.createGain();
      this.engineGain.gain.value = 0.012;

      this.engineOsc.connect(engFilter);
      engFilter.connect(this.engineGain);
      this.engineGain.connect(this.trafficGain);
      this.engineOsc.start();
    }

    _scheduleNextTrafficSound() {
      const delay = this.playing && !this.paused
        ? 950 + Math.random() * 2100
        : 2400 + Math.random() * 2600;
      this.trafficTimer = setTimeout(() => {
        if (this.ac && this.sfxEnabled && this.ac.state === "running") {
          if (this.playing && !this.paused) {
            this.playRandomDelhiHorn();
          } else if (Math.random() < 0.35) {
            this.playRandomDelhiHorn(0.4);
          }
        }
        this._scheduleNextTrafficSound();
      }, delay);
    }

    playRandomDelhiHorn(volScale = 1) {
      if (!this.ac || !this.sfxEnabled) return;
      const r = Math.random();
      if (r < 0.36) this._hornAutoPeep(volScale);
      else if (r < 0.64) this._hornBusHonk(volScale);
      else if (r < 0.85) this._bellRickshaw(volScale);
      else this._hornScooterBeep(volScale);
    }

    _hornAutoPeep(volScale = 1) {
      const t = this.ac.currentTime;
      const base = 470 + Math.random() * 70;
      [0, 0.13].forEach((offset, idx) => {
        const o1 = this.ac.createOscillator();
        const o2 = this.ac.createOscillator();
        const f = this.ac.createBiquadFilter();
        const g = this.ac.createGain();
        o1.type = "sawtooth";
        o2.type = "square";
        o1.frequency.setValueAtTime(base, t + offset);
        o2.frequency.setValueAtTime(base * 1.26, t + offset);
        f.type = "bandpass";
        f.frequency.value = 1100;
        f.Q.value = 1.6;
        const dur = idx === 0 ? 0.08 : 0.14;
        g.gain.setValueAtTime(0.001, t + offset);
        g.gain.linearRampToValueAtTime(0.14 * volScale, t + offset + 0.012);
        g.gain.exponentialRampToValueAtTime(0.001, t + offset + dur);
        o1.connect(f);
        o2.connect(f);
        f.connect(g);
        g.connect(this.trafficGain);
        o1.start(t + offset);
        o2.start(t + offset);
        o1.stop(t + offset + dur + 0.02);
        o2.stop(t + offset + dur + 0.02);
      });
    }

    _hornBusHonk(volScale = 1) {
      const t = this.ac.currentTime;
      const f1 = 155 + Math.random() * 20;
      const o1 = this.ac.createOscillator();
      const o2 = this.ac.createOscillator();
      const filt = this.ac.createBiquadFilter();
      const g = this.ac.createGain();
      o1.type = "sawtooth";
      o2.type = "sawtooth";
      o1.frequency.setValueAtTime(f1, t);
      o2.frequency.setValueAtTime(f1 * 1.25, t);
      o1.frequency.linearRampToValueAtTime(f1 * 0.97, t + 0.42);
      filt.type = "lowpass";
      filt.frequency.value = 780;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.18 * volScale, t + 0.03);
      g.gain.setValueAtTime(0.16 * volScale, t + 0.28);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.46);
      o1.connect(filt);
      o2.connect(filt);
      filt.connect(g);
      g.connect(this.trafficGain);
      o1.start(t);
      o2.start(t);
      o1.stop(t + 0.48);
      o2.stop(t + 0.48);
    }

    _bellRickshaw(volScale = 1) {
      const t = this.ac.currentTime;
      [0, 0.09].forEach((offset) => {
        const o = this.ac.createOscillator();
        const o2 = this.ac.createOscillator();
        const g = this.ac.createGain();
        o.type = "sine";
        o2.type = "triangle";
        o.frequency.setValueAtTime(2480, t + offset);
        o2.frequency.setValueAtTime(3720, t + offset);
        g.gain.setValueAtTime(0.001, t + offset);
        g.gain.linearRampToValueAtTime(0.09 * volScale, t + offset + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.16);
        o.connect(g);
        o2.connect(g);
        g.connect(this.trafficGain);
        o.start(t + offset);
        o2.start(t + offset);
        o.stop(t + offset + 0.18);
        o2.stop(t + offset + 0.18);
      });
    }

    _hornScooterBeep(volScale = 1) {
      const t = this.ac.currentTime;
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(560 + Math.random() * 60, t);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.08 * volScale, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g);
      g.connect(this.trafficGain);
      o.start(t);
      o.stop(t + 0.14);
    }

    _startSequencer() {
      const stepDur = 60 / 138 / 4;
      this.nextNoteTime = this.ac.currentTime + 0.05;
      this.step = 0;

      const melody = [
        72, 0, 75, 72,  70, 72, 75, 0,   77, 75, 72, 70,  68, 70, 72, 0,
        72, 75, 77, 0,  79, 77, 75, 72,  75, 72, 70, 68,  67, 0, 72, 0,
        75, 0, 79, 77,  75, 72, 75, 0,   77, 79, 80, 79,  77, 75, 72, 0,
        74, 75, 72, 70, 68, 70, 72, 75,  72, 70, 68, 67,  60, 0, 67, 72
      ];

      const bass = [
        36, 0, 48, 0,  36, 0, 43, 0,  34, 0, 46, 0,  32, 0, 44, 0,
        36, 0, 48, 0,  36, 0, 43, 48, 34, 0, 46, 0,  31, 0, 43, 0,
        39, 0, 51, 0,  39, 0, 46, 0,  41, 0, 53, 0,  36, 0, 48, 0,
        38, 0, 50, 0,  32, 0, 44, 0,  31, 0, 43, 0,  36, 43, 48, 0
      ];

      const schedule = () => {
        if (!this.ac) return;
        while (this.nextNoteTime < this.ac.currentTime + 0.14) {
          if (!this.realMusicReady) {
            this._playMusicStep(this.step, this.nextNoteTime, melody, bass, stepDur);
          }
          this.nextNoteTime += stepDur;
          this.step = (this.step + 1) % 64;
        }
      };

      this.seqTimer = setInterval(schedule, 35);
    }

    _midiToFreq(m) {
      return 440 * Math.pow(2, (m - 69) / 12);
    }

    _playMusicStep(step, t, melody, bass, stepDur) {
      if (!this.musicEnabled || this.ac.state !== "running") return;
      const s16 = step % 16;
      const quietMenu = !this.playing || this.paused;
      const duck = quietMenu ? 0.42 : 1.0;

      if (s16 === 0 || s16 === 6 || s16 === 8 || s16 === 14) {
        this._dholakBass(t, (s16 === 0 || s16 === 8 ? 0.34 : 0.24) * duck);
      }
      if (s16 === 4 || s16 === 12 || s16 === 2 || s16 === 11 || s16 === 15) {
        const accent = s16 === 4 || s16 === 12 ? 0.22 : 0.11;
        this._dholakSlap(t, accent * duck);
      }
      if (s16 % 2 === 1 && !quietMenu) {
        this._ghungroo(t, 0.055 * duck);
      }

      const bNote = bass[step];
      if (bNote > 0) {
        this._desiBass(t, this._midiToFreq(bNote), stepDur * 1.4, 0.22 * duck);
      }

      const mNote = melody[step];
      if (mNote > 0 && (!quietMenu || step % 2 === 0)) {
        const prev = melody[(step + 63) % 64];
        const slideFrom = prev > 0 ? this._midiToFreq(prev) : null;
        this._harmoniumLead(t, this._midiToFreq(mNote), slideFrom, stepDur * 1.75, 0.15 * duck);
      }
    }

    _dholakBass(t, vol) {
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(145, t);
      o.frequency.exponentialRampToValueAtTime(56, t + 0.09);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g);
      g.connect(this.musicGain);
      o.start(t);
      o.stop(t + 0.17);
    }

    _dholakSlap(t, vol) {
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(340, t);
      o.frequency.exponentialRampToValueAtTime(210, t + 0.05);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o.connect(g);
      g.connect(this.musicGain);
      o.start(t);
      o.stop(t + 0.09);
    }

    _ghungroo(t, vol) {
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(6200 + Math.random() * 1400, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
      o.connect(g);
      g.connect(this.musicGain);
      o.start(t);
      o.stop(t + 0.03);
    }

    _desiBass(t, freq, dur, vol) {
      const o = this.ac.createOscillator();
      const f = this.ac.createBiquadFilter();
      const g = this.ac.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(freq, t);
      f.type = "lowpass";
      f.frequency.setValueAtTime(420, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(f);
      f.connect(g);
      g.connect(this.musicGain);
      o.start(t);
      o.stop(t + dur + 0.02);
    }

    _harmoniumLead(t, freq, slideFrom, dur, vol) {
      const o1 = this.ac.createOscillator();
      const o2 = this.ac.createOscillator();
      const f = this.ac.createBiquadFilter();
      const g = this.ac.createGain();

      o1.type = "sawtooth";
      o2.type = "triangle";
      if (slideFrom) {
        o1.frequency.setValueAtTime(slideFrom, t);
        o1.frequency.exponentialRampToValueAtTime(freq, t + 0.035);
        o2.frequency.setValueAtTime(slideFrom * 1.005, t);
        o2.frequency.exponentialRampToValueAtTime(freq * 1.005, t + 0.035);
      } else {
        o1.frequency.setValueAtTime(freq, t);
        o2.frequency.setValueAtTime(freq * 1.005, t);
      }

      f.type = "bandpass";
      f.frequency.setValueAtTime(1450, t);
      f.Q.value = 1.2;

      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);

      o1.connect(f);
      o2.connect(f);
      f.connect(g);
      g.connect(this.musicGain);

      o1.start(t);
      o2.start(t);
      o1.stop(t + dur + 0.02);
      o2.stop(t + dur + 0.02);
    }

    playLaneSnap(dir) {
      if (!this.ac || !this.sfxEnabled) return;
      const t = this.ac.currentTime;
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(dir > 0 ? 250 : 320, t);
      o.frequency.exponentialRampToValueAtTime(dir > 0 ? 390 : 210, t + 0.055);
      g.gain.setValueAtTime(0.11, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
      o.connect(g);
      g.connect(this.sfxGain);
      o.start(t);
      o.stop(t + 0.07);
    }

    playPickup(type) {
      if (!this.ac || !this.sfxEnabled) return;
      const t = this.ac.currentTime;
      const notes = type === "chai"
        ? [523, 659, 784]
        : type === "mirchi" || type === "bike" || type === "car"
          ? [523, 659, 784, 1046]
          : [660, 880];
      notes.forEach((freq, i) => {
        const o = this.ac.createOscillator();
        const g = this.ac.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(freq, t + i * 0.045);
        g.gain.setValueAtTime(0.14, t + i * 0.045);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.045 + 0.11);
        o.connect(g);
        g.connect(this.sfxGain);
        o.start(t + i * 0.045);
        o.stop(t + i * 0.045 + 0.12);
      });
    }

    playNearMiss(combo = 1) {
      if (!this.ac || !this.sfxEnabled) return;
      const t = this.ac.currentTime;
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = "sine";
      const f = Math.min(1400, 620 + combo * 90);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.35, t + 0.09);
      g.gain.setValueAtTime(0.13, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      o.connect(g);
      g.connect(this.sfxGain);
      o.start(t);
      o.stop(t + 0.12);
    }

    playDeliver() {
      if (!this.ac || !this.sfxEnabled) return;
      const t = this.ac.currentTime;
      [523, 659, 784, 1046].forEach((freq, i) => {
        const o = this.ac.createOscillator();
        const g = this.ac.createGain();
        o.type = "triangle";
        o.frequency.setValueAtTime(freq, t + i * 0.06);
        g.gain.setValueAtTime(0.18, t + i * 0.06);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.18);
        o.connect(g);
        g.connect(this.sfxGain);
        o.start(t + i * 0.06);
        o.stop(t + i * 0.06 + 0.2);
      });
    }

    playCrash() {
      if (!this.ac || !this.sfxEnabled) return;
      const t = this.ac.currentTime;
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(48, t + 0.24);
      g.gain.setValueAtTime(0.24, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      o.connect(g);
      g.connect(this.sfxGain);
      o.start(t);
      o.stop(t + 0.27);
      this._hornAutoPeep(0.7);
    }

    playFinish(won) {
      if (!this.ac || !this.sfxEnabled) return;
      const t = this.ac.currentTime;
      const seq = won ? [523, 659, 784, 1046, 1318] : [330, 294, 262, 196];
      seq.forEach((freq, i) => {
        const o = this.ac.createOscillator();
        const g = this.ac.createGain();
        o.type = won ? "triangle" : "sawtooth";
        o.frequency.setValueAtTime(freq, t + i * 0.09);
        g.gain.setValueAtTime(0.16, t + i * 0.09);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.24);
        o.connect(g);
        g.connect(this.sfxGain);
        o.start(t + i * 0.09);
        o.stop(t + i * 0.09 + 0.25);
      });
    }
  }

  window.SamosaAudio = new SamosaAudio();
})();
