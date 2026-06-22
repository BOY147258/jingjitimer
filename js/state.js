/**
 * 状态管理模块
 */
export const state = {
  role: 'solo',
  laneCount: 4,
  lapCount: 1,
  distance: 100,
  wind: 0,
  weather: '',
  temperature: 0,
  trackLength: 400,
  raceName: '',
  orgName: '',
  isRunning: false,
  isPaused: false,
  startTime: null,
  finishTimes: [],
  laneResults: {},
  roomCode: '',
  serverUrl: '',
  ws: null,
  micReady: false,
  camReady: false,
  lastRace: null,
};

export function updateState(updates) {
  Object.assign(state, updates);
}

export function resetRaceState() {
  state.isRunning = false;
  state.isPaused = false;
  state.startTime = null;
  state.finishTimes = [];
  state.laneResults = {};
}
