/**
 * 竞迹计时系统 - 环境配置模块
 *
 * 支持从 .env 文件和环境变量加载配置
 * 使用方式：
 *   import config from './config.js';
 *   console.log(config.PORT);
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 默认配置
const defaults = {
  // 服务器
  PORT: 8080,
  HOST: '0.0.0.0',
  BASE_URL: 'http://localhost:8080',

  // 数据库
  DB_PATH: './data/jingjitimer.db',
  DB_ENABLE_WAL: true,

  // 日志
  LOG_LEVEL: 'info',
  LOG_FILE: './logs/app.log',
  LOG_MAX_SIZE: '10m',
  LOG_MAX_FILES: 7,

  // 安全
  CORS_ORIGIN: '*',
  SESSION_SECRET: 'jingji-secret-change-in-production',

  // WebSocket
  WS_PORT: 8080,
  WS_PING_INTERVAL: 30000,
  WS_TIMEOUT: 60000,
  WS_MAX_CONNECTIONS: 100,

  // API
  API_PREFIX: '/api',
  API_RATE_LIMIT: 100,
  API_RATE_WINDOW: 60000,

  // 功能开关
  ENABLE_ANALYTICS: false,
  ENABLE_CRASH_REPORT: false,
  ENABLE_NOTIFICATIONS: true,

  // 存储
  DATA_DIR: './data',
  TEMP_DIR: './temp',
  BACKUP_DIR: './backups',
  MAX_VIDEO_SIZE: 500,

  // 部署
  DEPLOY_MODE: process.env.NODE_ENV || 'development',
  RENDER: process.env.RENDER || false,
  RENDER_PORT: process.env.PORT || 10000,
};

/**
 * 解析环境变量值
 */
function parseValue(value) {
  if (value === undefined || value === null) return value;

  // 布尔值
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  // null
  if (value.toLowerCase() === 'null') return null;

  // 数字
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);

  // JSON 字符串
  if ((value.startsWith('{') && value.endsWith('}')) ||
      (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

/**
 * 加载 .env 文件
 */
function loadEnvFile() {
  const envPaths = [
    resolve(__dirname, '../.env'),
    resolve(__dirname, '../../.env'),
    resolve(process.cwd(), '.env'),
  ];

  const envData = {};

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, 'utf-8');
        content.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return;

          const eqIndex = trimmed.indexOf('=');
          if (eqIndex === -1) return;

          const key = trimmed.slice(0, eqIndex).trim();
          let value = trimmed.slice(eqIndex + 1).trim();

          // 移除引号
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          envData[key] = parseValue(value);
        });
        console.log(`[Config] Loaded .env from: ${envPath}`);
        break; // 只加载第一个找到的 .env 文件
      } catch (err) {
        console.warn(`[Config] Failed to load .env: ${err.message}`);
      }
    }
  }

  return envData;
}

/**
 * 获取配置值
 */
function getConfig() {
  const envData = loadEnvFile();

  const config = {};

  for (const key of Object.keys(defaults)) {
    // 优先级：环境变量 > .env 文件 > 默认值
    const envValue = process.env[key];
    const fileValue = envData[key];

    if (envValue !== undefined) {
      config[key] = parseValue(envValue);
    } else if (fileValue !== undefined) {
      config[key] = fileValue;
    } else {
      config[key] = defaults[key];
    }
  }

  return Object.freeze(config);
}

// 导出配置（单例）
const config = getConfig();

/**
 * 获取指定配置
 */
export function get(key, defaultValue = null) {
  return config[key] ?? defaultValue;
}

/**
 * 检查是否为生产环境
 */
export function isProduction() {
  return config.DEPLOY_MODE === 'production';
}

/**
 * 检查是否为开发环境
 */
export function isDevelopment() {
  return config.DEPLOY_MODE === 'development';
}

/**
 * 获取所有配置（只读）
 */
export function getAll() {
  return config;
}

/**
 * 验证配置
 */
export function validate() {
  const errors = [];

  if (!config.PORT || config.PORT < 1 || config.PORT > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }

  if (config.LOG_LEVEL && !['error', 'warn', 'info', 'debug', 'trace'].includes(config.LOG_LEVEL)) {
    errors.push('LOG_LEVEL must be one of: error, warn, info, debug, trace');
  }

  if (errors.length > 0) {
    throw new Error(`Config validation failed:\n${errors.join('\n')}`);
  }

  return true;
}

// 导出默认配置
export { defaults };

export default config;
