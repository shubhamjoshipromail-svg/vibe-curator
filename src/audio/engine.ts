import type * as Tone from 'tone';
import type { AudioSpec } from '../types';
import { loadAudioPack, refineLoopPoints, type AudioPack, type AudioTexture } from './pack';
import type { AmbientEvent } from '../living-still/types';
import type { PlaybackPlan } from './brief';

/** Silence between plays of a one-shot song, so it reads as a return, not a restart. */
const SONG_REPLAY_PAUSE_SECONDS = 30;

/**
 * Generative ambient audio.
 *
 * Two deliberate choices here, both of which take an open problem off the table:
 *
 *   1. Procedural mixing, not AI track generation. It loops infinitely by
 *      construction, costs nothing at runtime, starts instantly, and has no
 *      licensing exposure. AI generation is a way to author novel stems OFFLINE
 *      later, never a runtime dependency.
 *
 *   2. Everything below is SYNTHESIZED, not sampled. That is a scaffolding
 *      decision, not a final one — it means this backbone has zero asset and
 *      zero licensing surface today, so the architecture can be judged before
 *      anyone sources a single stem. Real recorded textures will sound better
 *      and drop into the same slots.
 *
 * The reason it never repeats is that it is not a loop: it is a bed plus
 * continuous textures plus sparse events whose timing, gain and pan are all
 * randomized independently.
 */

const SCALES: Record<AudioSpec['scale'], number[]> = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major_pentatonic: [0, 2, 4, 7, 9],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

let toneRuntime: typeof import('tone') | undefined;

async function loadTone(): Promise<typeof import('tone')> {
  toneRuntime ??= await import('tone');
  return toneRuntime;
}

function tone(): typeof import('tone') {
  if (!toneRuntime) throw new Error('Sound has not been started yet.');
  return toneRuntime;
}

export class AudioEngine {
  started = false;
  private spec?: AudioSpec;
  private energy = 1;
  private nodes: { dispose(): void }[] = [];
  private master?: Tone.Gain;
  private filter?: Tone.Filter;
  /**
   * Independent layer buses.
   *
   * Ambience (room tone, fire, wind) and music (bed, motifs) are separate
   * signal paths so either can be silenced without touching the other. Wanting
   * the room without the melody — or your own playlist over our ambience — is
   * the normal case, not an edge case.
   */
  private buses: Partial<Record<'ambience' | 'music', Tone.Gain>> = {};
  private proceduralMusic?: Tone.Gain;
  private generatedMusic?: Tone.Player;
  private generatedMusicReplay?: ReturnType<typeof setTimeout>;
  private layerState = {
    ambience: { gain: 0.8, muted: false },
    music: { gain: 0.65, muted: false },
    master: { gain: 0.8, muted: false },
  };
  private bed?: Tone.PolySynth;
  private motifPan?: Tone.Panner;
  private crackle?: Tone.NoiseSynth;
  private scheduled: number[] = [];
  /** Resolved at build time to either a Sampler or a synth voice. */
  private playNote?: (note: string, time: number, velocity: number) => void;
  /** Which sources came from real recordings this build — reported to the UI. */
  sampled: string[] = [];
  private meter?: Tone.Meter;
  private analyser?: Tone.Analyser;
  private bands = new Float32Array(8);
  private visual = { brightness: 0, motion: 0, centroidX: 0.5 };
  private ambientEvents: AmbientEvent[] = [];

  /**
   * Eight spectrum bands, 0..1, low to high.
   *
   * This is what makes generated effects audio-reactive. It taps the app's own
   * output today; in a desktop shell the same eight numbers can come from
   * system-audio loopback instead, which is the only reliable way to react to
   * Spotify or anything else the user is actually playing.
   */
  getBands(): Float32Array {
    const raw = this.analyser?.getValue();
    if (!raw || typeof raw === 'number') return this.bands;

    const values = raw as Float32Array;
    const perBand = Math.max(1, Math.floor(values.length / 8));
    for (let b = 0; b < 8; b++) {
      let sum = 0;
      for (let i = 0; i < perBand; i++) sum += values[b * perBand + i];
      const db = sum / perBand;
      // -100dB floor -> 0, -10dB -> 1. Smoothed so effects don't jitter.
      const norm = Math.max(0, Math.min(1, (db + 100) / 90));
      this.bands[b] += (norm - this.bands[b]) * 0.25;
    }
    return this.bands;
  }

  /**
   * Output level in dB. Exists because "the code runs without errors" and
   * "sound is coming out" are different claims, and only one of them matters.
   */
  getLevel(): number {
    const v = this.meter?.getValue();
    return typeof v === 'number' ? v : -Infinity;
  }

  /** Load the Web Audio runtime before the user clicks so the gesture is spent
   * resuming the audio context, not waiting for a dynamic module download. */
  async prepare(): Promise<void> {
    await loadTone();
  }

  async start(spec: AudioSpec): Promise<void> {
    if (this.started) {
      await this.setSpec(spec);
      return;
    }
    // Browsers require a user gesture before audio. The caller supplies one.
    const ToneRuntime = await loadTone();
    await ToneRuntime.start();
    await this.build(spec);
    ToneRuntime.getTransport().bpm.value = 60;
    ToneRuntime.getTransport().start();
    this.started = true;
  }

  async setSpec(spec: AudioSpec): Promise<void> {
    if (!this.started) {
      this.spec = spec;
      return;
    }
    await this.build(spec);
  }

  setAmbientEvents(events: AmbientEvent[]): void {
    this.ambientEvents = events.filter((event) => event.enabled);
  }

  /** Set one layer's level. Takes effect immediately, and survives rebuilds. */
  setLayer(layer: 'ambience' | 'music' | 'master', gain: number, muted: boolean): void {
    this.layerState[layer] = { gain, muted };
    this.applyLayerGains();
  }

  getLayer(layer: 'ambience' | 'music' | 'master') {
    return { ...this.layerState[layer] };
  }

  /**
   * Play one persisted authored track under the Music bus; never generates here.
   *
   * `plan` marks a mastered asset. Mastering already trimmed the fade and baked
   * an equal-power crossfade into the file, so the loop seam in the bytes is
   * correct and the runtime must not touch it — the trimming below cuts straight
   * into that seam and undoes the work. Without a plan the asset is un-mastered
   * (an IndexedDB track saved before this existed) and still needs the old
   * treatment, which is why that code stays exactly as it was.
   */
  async setGeneratedMusic(url?: string, plan?: PlaybackPlan): Promise<void> {
    this.clearGeneratedMusicReplay();
    if (this.generatedMusic) {
      try {
        this.generatedMusic.stop();
        this.generatedMusic.dispose();
      } catch {
        /* already disposed during a spec rebuild */
      }
      this.generatedMusic = undefined;
    }

    if (!url || !this.buses.music) {
      this.proceduralMusic?.gain.rampTo(1, 0.3);
      return;
    }

    this.proceduralMusic?.gain.rampTo(0, 0.3);
    // A song plays to its end; everything else repeats.
    const shouldLoop = plan ? plan.mode !== 'once' : true;
    const player = this.track(new (tone().Player)({ loop: shouldLoop })).connect(this.buses.music);
    this.generatedMusic = player;
    await player.load(url);

    if (plan) {
      // Mastered: trust the file. No silence trim, no zero-crossing search, no
      // loop-point adjustment.
      if (plan.mode === 'once') this.scheduleSongReplay(player);
      player.start();
      return;
    }

    // --- compatibility path: un-mastered audio only -------------------------
    const buffer = player.buffer;
    const channel = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    if (channel.length && sampleRate) {
      const block = Math.max(1, Math.floor(sampleRate * 0.1));
      let peak = 0;
      for (let i = 0; i < channel.length; i += block) {
        let sum = 0;
        for (let j = i; j < Math.min(channel.length, i + block); j++) sum += channel[j] * channel[j];
        peak = Math.max(peak, Math.sqrt(sum / Math.min(block, channel.length - i)));
      }
      const threshold = Math.max(0.0025, peak * 0.035);
      let first = 0; let last = channel.length - 1;
      const rmsAt = (start: number) => {
        let sum = 0; const end = Math.min(channel.length, start + block);
        for (let i = start; i < end; i++) sum += channel[i] * channel[i];
        return Math.sqrt(sum / Math.max(1, end - start));
      };
      while (first + block < channel.length && rmsAt(first) < threshold) first += block;
      while (last - block > first && rmsAt(last - block) < threshold) last -= block;
      first = Math.max(0, first - Math.floor(sampleRate * 0.08));
      last = Math.min(channel.length - 1, last + Math.floor(sampleRate * 0.08));
      if (last - first > sampleRate * 8) {
        const points = refineLoopPoints(channel.subarray(first, last), sampleRate, 0.08);
        player.loopStart = first / sampleRate + points.start;
        player.loopEnd = first / sampleRate + points.end;
      }
    }
    player.start();
  }

  private clearGeneratedMusicReplay(): void {
    if (this.generatedMusicReplay === undefined) return;
    clearTimeout(this.generatedMusicReplay);
    this.generatedMusicReplay = undefined;
  }

  /**
   * A one-shot song returns after a pause rather than looping. Forcing a song
   * into a short repeat is exactly the restart this mode exists to avoid, so the
   * gap is deliberate silence, and the timer stands down the moment another
   * track replaces this one.
   */
  private scheduleSongReplay(player: Tone.Player): void {
    const duration = player.buffer?.duration;
    if (!duration || !Number.isFinite(duration)) return;
    this.generatedMusicReplay = setTimeout(() => {
      this.generatedMusicReplay = undefined;
      if (this.generatedMusic !== player) return;
      try {
        player.start();
        this.scheduleSongReplay(player);
      } catch {
        /* disposed between the timer firing and this call */
      }
    }, (duration + SONG_REPLAY_PAUSE_SECONDS) * 1000);
  }

  private applyLayerGains(): void {
    const m = this.layerState.master;
    const masterScale = m.muted ? 0 : m.gain;
    for (const name of ['ambience', 'music'] as const) {
      const bus = this.buses[name];
      if (!bus) continue;
      const s = this.layerState[name];
      bus.gain.rampTo((s.muted ? 0 : s.gain) * masterScale, 0.08);
    }
  }

  /** Fed by the scene's session arc, so audio and image age together. */
  setEnergy(e: number): void {
    this.energy = e;
    if (!this.spec || !this.filter) return;
    // The room gets quieter and darker as the session settles.
    const target = this.spec.lowpass_hz * (0.55 + 0.45 * e);
    this.filter.frequency.rampTo(target, 2);
  }

  /** The image becomes a continuous control signal: motion opens the mix,
   * brightness lifts the cutoff, and the subject position steers the motif. */
  setVisualMetrics(metrics?: { brightness: number; motion: number; centroidX: number }): void {
    if (!metrics) return;
    this.visual.brightness += (metrics.brightness - this.visual.brightness) * 0.12;
    this.visual.motion += (metrics.motion - this.visual.motion) * 0.18;
    this.visual.centroidX += (metrics.centroidX - this.visual.centroidX) * 0.14;
    if (this.spec && this.filter) {
      const arcScale = 0.55 + 0.45 * this.energy;
      const visualScale = 0.78 + this.visual.brightness * 0.3 + this.visual.motion * 0.34;
      this.filter.frequency.rampTo(this.spec.lowpass_hz * arcScale * visualScale, 0.18);
    }
    this.motifPan?.pan.rampTo((this.visual.centroidX - 0.5) * 1.35, 0.22);
  }

  stop(): void {
    if (toneRuntime) toneRuntime.getTransport().stop();
    this.teardown();
    this.started = false;
  }

  private teardown(): void {
    this.clearGeneratedMusicReplay();
    if (toneRuntime) for (const id of this.scheduled) toneRuntime.getTransport().clear(id);
    this.scheduled = [];
    this.pending = [];
    this.bed?.releaseAll();
    for (const n of this.nodes) {
      try {
        n.dispose();
      } catch {
        /* already disposed */
      }
    }
    this.nodes = [];
    this.master = undefined;
    this.filter = undefined;
    this.buses = {};
    this.proceduralMusic = undefined;
    this.generatedMusic = undefined;
    this.bed = undefined;
    this.playNote = undefined;
    this.crackle = undefined;
    this.analyser = undefined;
    this.sampled = [];
  }

  private track<T extends { dispose(): void }>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  /** Sources that cannot start until their buffers have decoded. */
  private pending: Array<() => void> = [];

  private startSampledSources(): void {
    for (const start of this.pending) start();
    this.pending = [];
  }

  /** A texture backed by a real recording rather than filtered noise. */
  private buildSampledTexture(name: string, tex: AudioTexture, base: string): void {
    const url = base + tex.file;
    const gain = this.track(new (tone().Gain)(tone().dbToGain(tex.gain_db ?? -24))).connect(
      this.buses.ambience!,
    );
    this.sampled.push(name);

    if (tex.loop_mode === 'granular') {
      // Overlapping grains: seamless on material never prepared for looping,
      // at the cost of softened transients. Right for beds, wrong for crackle.
      const gp = this.track(
        new (tone().GrainPlayer)({ url, loop: true, grainSize: 0.22, overlap: 0.12 }),
      ).connect(gain);
      this.pending.push(() => gp.start());
      return;
    }

    const player = this.track(new (tone().Player)({ url, loop: true })).connect(gain);
    this.pending.push(() => {
      const buf = player.buffer;
      const pts = refineLoopPoints(buf.getChannelData(0), buf.sampleRate);
      player.loopStart = pts.start;
      player.loopEnd = pts.end;
      player.start();
    });
  }

  private async build(spec: AudioSpec): Promise<void> {
    this.teardown();
    this.spec = spec;

    // A missing pack must never mean silence — it means synthesis, same as before.
    let pack: AudioPack | undefined;
    if (spec.pack) {
      try {
        pack = await loadAudioPack(spec.pack);
      } catch (err) {
        console.warn(`audio pack failed to load, using synthesis: ${spec.pack}`, err);
      }
    }
    const base = spec.pack ? spec.pack.slice(0, spec.pack.lastIndexOf('/') + 1) : '';

    // A limiter on the output, permanently.
    //
    // Every stem in this system arrives with a gain someone else chose — a CC0
    // field recording normalized to peak, a sample pack mastered loud, a bed
    // whose 6-second attack stacks on top of both. Measured output was already
    // reaching -1.6 dB with placeholder content. Without this, the first hot
    // file a user drops in clips the mix.
    const limiter = this.track(new (tone().Limiter)(-1)).toDestination();

    const reverb = this.track(
      new (tone().Reverb)({ decay: 1 + spec.reverb.size * 9, wet: spec.reverb.wet }),
    ).connect(limiter);
    await reverb.generate();

    this.filter = this.track(new (tone().Filter)(spec.lowpass_hz, 'lowpass')).connect(reverb);
    // Headroom trim. Ambient material should sit well below unity so the
    // limiter is a safety net rather than part of the sound.
    this.master = this.track(new (tone().Gain)(0.55)).connect(this.filter);

    // Tapped post-limiter so the reading is the actual output, not an intention.
    this.meter = this.track(new (tone().Meter)({ smoothing: 0.6 }));
    limiter.connect(this.meter);

    this.buses.ambience = this.track(new (tone().Gain)(1)).connect(this.master);
    this.buses.music = this.track(new (tone().Gain)(1)).connect(this.master);
    this.proceduralMusic = this.track(new (tone().Gain)(1)).connect(this.buses.music);
    this.applyLayerGains();

    this.analyser = this.track(new (tone().Analyser)('fft', 64));
    limiter.connect(this.analyser);

    this.buildBed(spec);

    for (const t of spec.textures) {
      const sampled = pack?.textures?.[t];
      if (sampled) {
        this.buildSampledTexture(t, sampled, base);
      } else {
        this.buildTexture(t);
      }
    }

    this.buildMotif(spec, pack, base);
    this.buildAmbientEvents();

    // One wait for every buffer this build requested.
    if (this.sampled.length) await tone().loaded();
    this.startSampledSources();

    this.setEnergy(this.energy);
  }

  /** Sparse semantic sounds selected by the orchestrator. Samples can replace these voices later. */
  private buildAmbientEvents(): void {
    for (const event of this.ambientEvents) {
      if (event.kind !== 'owl') continue;
      const pan = this.track(new (tone().Panner)(event.pan ?? 0)).connect(this.buses.ambience!);
      const gain = this.track(new (tone().Gain)(Math.max(0, Math.min(1, event.gain)) * 0.18)).connect(pan);
      const voice = this.track(new (tone().FMSynth)({
        harmonicity: 1.45,
        modulationIndex: 4,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.08, decay: 0.45, sustain: 0.08, release: 0.9 },
        modulationEnvelope: { attack: 0.12, decay: 0.3, sustain: 0, release: 0.4 },
      })).connect(gain) as Tone.FMSynth;
      const scheduleNext = (after: number) => {
        const min = Math.max(10, event.minIntervalSeconds);
        const max = Math.max(min, event.maxIntervalSeconds);
        const delay = min + Math.random() * (max - min);
        const id = tone().getTransport().scheduleOnce((time) => {
          voice.triggerAttackRelease('G4', 0.55, time, 0.7);
          voice.triggerAttackRelease('D4', 0.7, time + 0.62, 0.55);
          scheduleNext(tone().getTransport().seconds + 1.4);
        }, after + delay);
        this.scheduled.push(id);
      };
      scheduleNext(tone().getTransport().seconds);
    }
  }

  /** Sustained drone: root, fifth, octave, with slow independent drift. */
  private buildBed(spec: AudioSpec): void {
    const gain = this.track(new (tone().Gain)(tone().dbToGain(spec.bed_gain_db))).connect(
      this.proceduralMusic!,
    );

    this.bed = this.track(
      new (tone().PolySynth)(tone().Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 6, decay: 2, sustain: 1, release: 8 },
      }),
    ).connect(gain) as Tone.PolySynth;

    const root = tone().Frequency(spec.root);
    this.bed.triggerAttack([
      root.toNote(),
      root.transpose(7).toNote(),
      root.transpose(12).toNote(),
    ]);

    // A very slow amplitude wander so the bed breathes rather than sits.
    const lfo = this.track(new (tone().LFO)({ frequency: 0.013, min: 0.75, max: 1 }));
    lfo.connect(gain.gain);
    lfo.start();
  }

  private buildTexture(kind: AudioSpec['textures'][number]): void {
    const out = this.buses.ambience!;

    if (kind === 'fire_crackle') {
      // A quiet brown-noise bed for the body of the fire...
      const body = this.track(new (tone().Noise)('brown')).start();
      const bodyFilter = this.track(new (tone().Filter)(320, 'lowpass'));
      const bodyGain = this.track(new (tone().Gain)(tone().dbToGain(-26)));
      body.connect(bodyFilter);
      bodyFilter.connect(bodyGain);
      bodyGain.connect(out);

      // ...plus discrete pops. Individually random, so it never patterns.
      const pops = this.track(new (tone().Filter)(1400, 'bandpass'));
      const popGain = this.track(new (tone().Gain)(tone().dbToGain(-14)));
      pops.connect(popGain);
      popGain.connect(out);

      this.crackle = this.track(
        new (tone().NoiseSynth)({
          noise: { type: 'brown' },
          envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.02 },
        }),
      ).connect(pops) as Tone.NoiseSynth;

      const id = tone().getTransport().scheduleRepeat((time) => {
        // ~18 pops/sec at full energy, thinning as the fire burns down.
        if (Math.random() > 0.42 * this.energy) return;
        this.crackle?.triggerAttackRelease(0.02, time, 0.25 + Math.random() * 0.75);
      }, '64n');
      this.scheduled.push(id);
      return;
    }

    if (kind === 'room_air') {
      const n = this.track(new (tone().Noise)('pink')).start();
      const f = this.track(new (tone().Filter)(380, 'lowpass'));
      const g = this.track(new (tone().Gain)(tone().dbToGain(-34)));
      n.connect(f);
      f.connect(g);
      g.connect(out);
      return;
    }

    if (kind === 'wind') {
      const n = this.track(new (tone().Noise)('pink')).start();
      const f = this.track(new (tone().Filter)(500, 'lowpass'));
      const g = this.track(new (tone().Gain)(tone().dbToGain(-27)));
      n.connect(f);
      f.connect(g);
      g.connect(out);
      // Two incommensurate LFOs: gusts that never land on the same beat twice.
      const sweep = this.track(new (tone().LFO)({ frequency: 0.031, min: 220, max: 900 }));
      sweep.connect(f.frequency);
      sweep.start();
      const swell = this.track(
        new (tone().LFO)({ frequency: 0.019, min: tone().dbToGain(-38), max: tone().dbToGain(-24) }),
      );
      swell.connect(g.gain);
      swell.start();
      return;
    }

    if (kind === 'water') {
      const n = this.track(new (tone().Noise)('white')).start();
      const f = this.track(new (tone().Filter)(1100, 'bandpass'));
      const g = this.track(new (tone().Gain)(tone().dbToGain(-33)));
      n.connect(f);
      f.connect(g);
      g.connect(out);
      const lap = this.track(new (tone().LFO)({ frequency: 0.13, min: 700, max: 1600 }));
      lap.connect(f.frequency);
      lap.start();
      return;
    }

    if (kind === 'rain') {
      const n = this.track(new (tone().Noise)('white')).start();
      const f = this.track(new (tone().Filter)(900, 'highpass'));
      const g = this.track(new (tone().Gain)(tone().dbToGain(-30)));
      n.connect(f);
      f.connect(g);
      g.connect(out);
    }
  }

  /** Sparse melodic events. The thing that makes it feel composed rather than ambient wash. */
  private buildMotif(spec: AudioSpec, pack?: AudioPack, base = ''): void {
    if (spec.motif.instrument === 'none') return;

    this.motifPan = this.track(new (tone().Panner)(0)).connect(this.proceduralMusic!);
    const gain = this.track(new (tone().Gain)(tone().dbToGain(spec.motif.gain_db))).connect(
      this.motifPan,
    );

    // A real recorded instrument if the pack has one, otherwise the synth voice.
    // The scheduler below does not know or care which it got — that separation is
    // the whole reason swapping sources is a content change, not a rewrite.
    const instrument = pack?.instruments?.[spec.motif.instrument];

    if (instrument) {
      const sampler = this.track(
        new (tone().Sampler)({ urls: instrument.samples, baseUrl: base, release: 1.4 }),
      ).connect(gain) as Tone.Sampler;
      this.sampled.push(`motif:${spec.motif.instrument}`);
      this.playNote = (note, time, vel) => sampler.triggerAttackRelease(note, 2.4, time, vel);
    } else if (spec.motif.instrument === 'pluck') {
      const pluck = this.track(
        new (tone().PluckSynth)({ attackNoise: 1.2, dampening: 1800, resonance: 0.92 }),
      ).connect(gain) as Tone.PluckSynth;
      this.playNote = (note, time) => pluck.triggerAttack(note, time);
    } else {
      const fm = this.track(
        new (tone().FMSynth)({
          harmonicity: 3.01,
          modulationIndex: 9,
          envelope: { attack: 0.005, decay: 2.4, sustain: 0, release: 2 },
          modulationEnvelope: { attack: 0.01, decay: 0.6, sustain: 0, release: 1 },
        }),
      ).connect(gain) as Tone.FMSynth;
      this.playNote = (note, time, vel) => fm.triggerAttackRelease(note, 2, time, vel);
    }

    const scale = SCALES[spec.scale];
    const root = tone().Frequency(spec.root);

    // Probabilistic scheduling rather than a fixed grid: notes land off-pattern,
    // which is what keeps it from resolving into a recognisable loop.
    const perSecond = 4; // 16th notes at 60bpm
    const id = tone().getTransport().scheduleRepeat((time) => {
      const perMin = spec.motif.density_per_min * this.energy;
      if (Math.random() > perMin / 60 / perSecond) return;

      const degree = scale[Math.floor(Math.random() * scale.length)];
      const octave = 12 * (1 + Math.floor(Math.random() * 2));
      const note = root.transpose(degree + octave).toNote();

      if (this.motifPan) this.motifPan.pan.value = (Math.random() - 0.5) * 1.4;
      const vel = 0.25 + Math.random() * 0.5;

      this.playNote?.(note, time, vel);
    }, '16n');
    this.scheduled.push(id);
  }
}
