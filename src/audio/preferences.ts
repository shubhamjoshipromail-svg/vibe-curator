export const MASTER_AUDIO_PREFERENCES_KEY = 'vibe.audio.master.v1';
export const MASTER_AUDIO_ZERO_RECOVERY_KEY = 'vibe.audio.master.zero-recovery.v1';

export interface MasterAudioPreferences {
  volume: number;
  muted: boolean;
}

export const DEFAULT_MASTER_AUDIO_PREFERENCES: MasterAudioPreferences = {
  volume: 0.8,
  muted: false,
};

function clamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

export function readMasterAudioPreferences(storage: Storage | undefined = globalThis.localStorage): MasterAudioPreferences {
  try {
    const raw = storage?.getItem(MASTER_AUDIO_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_MASTER_AUDIO_PREFERENCES };
    const value = JSON.parse(raw) as Partial<MasterAudioPreferences>;
    return {
      volume: clamp(value.volume, DEFAULT_MASTER_AUDIO_PREFERENCES.volume),
      muted: typeof value.muted === 'boolean' ? value.muted : DEFAULT_MASTER_AUDIO_PREFERENCES.muted,
    };
  } catch {
    return { ...DEFAULT_MASTER_AUDIO_PREFERENCES };
  }
}

/**
 * One-time repair for builds that could silently persist an unlabelled 0%
 * master level. Once marked, an intentional 0% chosen in current controls is
 * preserved on every subsequent launch.
 */
export function recoverLegacyZeroVolume(
  preferences: MasterAudioPreferences,
  storage: Storage | undefined = globalThis.localStorage,
): MasterAudioPreferences {
  try {
    if (storage?.getItem(MASTER_AUDIO_ZERO_RECOVERY_KEY)) return preferences;
    storage?.setItem(MASTER_AUDIO_ZERO_RECOVERY_KEY, '1');
    if (!preferences.muted && preferences.volume === 0) {
      const recovered = { ...preferences, volume: DEFAULT_MASTER_AUDIO_PREFERENCES.volume };
      writeMasterAudioPreferences(recovered, storage);
      return recovered;
    }
  } catch {
    // Storage failure should not block the player; use the in-memory value.
  }
  return preferences;
}

export function writeMasterAudioPreferences(preferences: MasterAudioPreferences, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(MASTER_AUDIO_PREFERENCES_KEY, JSON.stringify({
      volume: clamp(preferences.volume, DEFAULT_MASTER_AUDIO_PREFERENCES.volume),
      muted: Boolean(preferences.muted),
    }));
  } catch {
    // Private browsing and a full quota must not break a running wallpaper.
  }
}
