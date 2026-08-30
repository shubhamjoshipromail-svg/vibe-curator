import { PROTOCOL_VERSION, effectiveLayerVolume, errorResponse, validateAudioRequest, type ExtensionState } from './core';

let track: HTMLAudioElement | undefined;
let context: AudioContext | undefined;
let synthGain: GainNode | undefined;
const sessionToken = new URL(location.href).searchParams.get('session');

function pauseTrack(): void {
  if (!track) return;
  track.pause();
  track.removeAttribute('src');
  track.load();
  track = undefined;
}

async function startSynth(volume: number): Promise<void> {
  context ??= new AudioContext();
  await context.resume();
  if (!synthGain) {
    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 420;
    synthGain = context.createGain();
    synthGain.gain.value = 0;
    lowpass.connect(synthGain).connect(context.destination);
    const frequencies = [73.42, 110];
    for (const frequency of frequencies) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.value = frequency < 100 ? 0.32 : 0.12;
      oscillator.connect(gain).connect(lowpass);
      oscillator.start();
    }
  }
  synthGain.gain.setTargetAtTime(volume * 0.13, context.currentTime, 0.08);
}

async function startTrack(url: string, volume: number): Promise<void> {
  if (!track || track.src !== url) {
    pauseTrack();
    track = new Audio(url);
    track.loop = true;
    track.preload = 'auto';
  }
  track.volume = volume;
  await track.play();
}

async function applyAudio(state: ExtensionState): Promise<void> {
  const shouldPlay = state.playback.soundUnlocked && state.playback.desiredPlaying;
  if (!shouldPlay) {
    track?.pause();
    if (context?.state === 'running') await context.suspend();
    return;
  }
  await startSynth(effectiveLayerVolume(state, 'ambience'));
  if (state.preset.trackUrl) {
    try {
      await startTrack(state.preset.trackUrl, effectiveLayerVolume(state, 'music'));
    } catch (error) {
      console.warn('Unable to play curated track; continuing with ambience.', error);
    }
  } else pauseTrack();
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (!raw || typeof raw !== 'object' || (raw as { target?: unknown }).target !== 'offscreen') return false;
  const candidateId = (raw as { requestId?: unknown }).requestId;
  void (async () => {
    try {
      if (sender.id !== chrome.runtime.id) throw new Error('Untrusted audio sender.');
      const request = validateAudioRequest(raw);
      if (!sessionToken || request.sessionToken !== sessionToken) throw new Error('Invalid audio session.');
      await applyAudio(request.state);
      sendResponse({ v: PROTOCOL_VERSION, requestId: request.requestId, ok: true });
    } catch (error) {
      sendResponse(errorResponse(candidateId, 'audio_failed', error));
    }
  })();
  return true;
});
