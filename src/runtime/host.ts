/**
 * The narrow capability boundary between the renderer and the operating system.
 * Browser builds remain useful wallpaper previews; only bundled Tauri code is
 * allowed to invoke native commands.
 */

export type RuntimeKind = 'browser' | 'tauri';

export interface RuntimeHost {
  kind: RuntimeKind;
  activatePreset(presetId: string): Promise<void>;
  enterWallpaperMode(): Promise<void>;
  leaveWallpaperMode(): Promise<void>;
}

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

async function invokeNative(command: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke(command);
}

const browserHost: RuntimeHost = {
  kind: 'browser',
  async activatePreset(presetId) {
    localStorage.setItem('vibe.wallpaper.preset-id', presetId);
    window.open(`/wallpaper.html?preset=${encodeURIComponent(presetId)}`, '_blank', 'noopener');
  },
  async enterWallpaperMode() {
    // A normal browser can preview the exact wallpaper surface. Plash/Lively
    // can point at this URL; no privileged operation is attempted here.
  },
  async leaveWallpaperMode() {
    window.close();
  },
};

const tauriHost: RuntimeHost = {
  kind: 'tauri',
  async activatePreset(presetId) {
    localStorage.setItem('vibe.wallpaper.preset-id', presetId);
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('activate_preset', { presetId });
  },
  enterWallpaperMode: () => invokeNative('enter_wallpaper_mode'),
  leaveWallpaperMode: () => invokeNative('leave_wallpaper_mode'),
};

export const runtimeHost: RuntimeHost = isTauriRuntime() ? tauriHost : browserHost;
