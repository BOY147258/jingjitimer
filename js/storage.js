/**
 * 本地存储模块
 */
const STORAGE_KEYS = {
  RACE_HISTORY: 'jingji_race_history',
  USER_SETTINGS: 'jingji_user_settings',
};

export function saveRaceHistory(race) {
  const history = getRaceHistory();
  history.unshift({ ...race, timestamp: Date.now() });
  const trimmed = history.slice(0, 100);
  localStorage.setItem(STORAGE_KEYS.RACE_HISTORY, JSON.stringify(trimmed));
  return trimmed;
}

export function getRaceHistory() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.RACE_HISTORY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function clearRaceHistory() {
  localStorage.removeItem(STORAGE_KEYS.RACE_HISTORY);
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEYS.USER_SETTINGS, JSON.stringify(settings));
}

export function getSettings() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.USER_SETTINGS);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

export { STORAGE_KEYS };
