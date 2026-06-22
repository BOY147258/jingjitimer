/**
 * 竞迹计时器 - TypeScript 类型定义
 * 提供完整的类型安全支持
 */

/**
 * 设备角色
 */
export type Role = 'solo' | 'start' | 'finish' | 'observer';

/**
 * 比赛状态
 */
export type RaceStatus = 'idle' | 'countdown' | 'running' | 'finished';

/**
 * 同步状态
 */
export type SyncStatus = 'synced' | 'pending' | 'failed' | 'offline';

/**
 * 时间记录
 */
export interface TimeRecord {
  lane: number;
  time: number;
  name?: string;
  rank?: number;
  isDNF?: boolean;
  isDNS?: boolean;
  reactionTime?: number;
  lapTimes?: number[];
}

/**
 * 比赛数据
 */
export interface Race {
  id?: number;
  timestamp: number;
  raceName: string;
  orgName: string;
  distance: number;
  laneCount: number;
  lapCount: number;
  trackLength: number;
  wind?: number;
  weather?: string;
  temperature?: number;
  results: TimeRecord[];
  videoUrl?: string;
  syncStatus?: SyncStatus;
}

/**
 * 运动员数据
 */
export interface Athlete {
  id: string;
  name: string;
  school?: string;
  grade?: string;
  bestTimes?: Record<number, number>;
  photos?: string[];
}

/**
 * 应用状态
 */
export interface AppState {
  role: Role;
  laneCount: number;
  lapCount: number;
  distance: number;
  trackLength: number;
  wind: number;
  weather: string;
  temperature: number;
  raceName: string;
  orgName: string;
  status: RaceStatus;
  isRunning: boolean;
  isPaused: boolean;
  startTime: number | null;
  finishTimes: number[];
  laneResults: Record<number, TimeRecord>;
  roomCode: string;
  serverUrl: string;
  isConnected: boolean;
  latency: number;
  micReady: boolean;
  camReady: boolean;
  lastRace: Race | null;
}

/**
 * WebSocket 消息
 */
export interface WSMessage {
  type: string;
  payload?: unknown;
  timestamp?: number;
  roomCode?: string;
  deviceId?: string;
}

/**
 * 导出选项
 */
export interface ExportOptions {
  includeWeather?: boolean;
  includeBest?: boolean;
  includeLapTimes?: boolean;
  orgName?: string;
  raceName?: string;
  distance?: number;
  schoolLogo?: string;
}

/**
 * 设备诊断信息
 */
export interface DeviceInfo {
  browser: string;
  browserVersion: string;
  os: string;
  screen: string;
  screenWidth: number;
  screenHeight: number;
  supportsMediaDevices: boolean;
  supportsWebSocket: boolean;
  supportsIndexedDB: boolean;
  supportsServiceWorker: boolean;
  supportsNotifications: boolean;
  supportsGetUserMedia: boolean;
  connectionType?: string;
  effectiveType?: string;
}

/**
 * 音频检测结果
 */
export interface AudioDetectionResult {
  detected: boolean;
  confidence: number;
  timestamp: number;
  peakLevel: number;
}

/**
 * 终点线检测配置
 */
export interface DetectorConfig {
  sensitivity: number;
  minMotionThreshold: number;
  roiX: number;
  roiY: number;
  roiWidth: number;
  roiHeight: number;
  enableDirectionFilter: boolean;
  enableMultiZoneDetection: boolean;
}

/**
 * 历史记录项
 */
export interface HistoryItem {
  id: string;
  timestamp: number;
  raceName: string;
  distance: number;
  athleteCount: number;
  topTime: number | null;
  orgName?: string;
}

/**
 * 通知数据
 */
export interface NotificationData {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
}

/**
 * 性能统计
 */
export interface PerformanceStats {
  fps: number;
  detectionTime: number;
  memoryUsage?: number;
  latency: number;
  frameCount: number;
}
