// Player settings (volumes, graphics, camera), kept in this browser separately from the save.
const KEY = 'emberwood-settings';

export const DEFAULT_SETTINGS = { music: 0.6, sfx: 0.8, ambience: 0.5, muted: false, quality: 'high', fps: 60, zoom: 1 };

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
