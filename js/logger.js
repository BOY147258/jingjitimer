/**
 * 竞迹计时系统 - 日志模块
 *
 * 功能：
 * - 多级别日志（error, warn, info, debug, trace）
 * - 控制台输出格式化
 * - 文件输出（可选）
 * - 日志分级过滤
 * - 日志轮转
 *
 * 使用方式：
 *   import logger from './logger.js';
 *   logger.info('服务器启动', { port: 8080 });
 *   logger.error('连接失败', error);
 */

import { createWriteStream, existsSync, mkdirSync, appendFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// 获取当前文件目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 日志级别枚举
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

// 日志级别颜色（用于控制台）
const COLORS = {
  error: '\x1b[31m',   // 红色
  warn: '\x1b[33m',     // 黄色
  info: '\x1b[36m',     // 青色
  debug: '\x1b[90m',    // 灰色
  trace: '\x1b[90m',    // 灰色
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

// 日志级别 emoji
const EMOJIS = {
  error: '❌',
  warn: '⚠️',
  info: 'ℹ️',
  debug: '🔍',
  trace: '📝',
};

/**
 * 格式化时间戳
 */
function formatTimestamp(date = new Date()) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/**
 * 格式化日志消息
 */
function formatMessage(level, message, data) {
  const timestamp = formatTimestamp();
  const levelStr = level.toUpperCase().padEnd(5);
  const emoji = EMOJIS[level] || '';
  const color = COLORS[level] || '';

  let formatted = `${color}[${timestamp}] [${levelStr}]${COLORS.reset} ${emoji} ${message}`;

  if (data !== undefined) {
    if (data instanceof Error) {
      formatted += `\n${color}  Error: ${data.message}${COLORS.reset}`;
      if (data.stack) {
        formatted += `\n${COLORS.error}${data.stack.split('\n').slice(1).join('\n')}${COLORS.reset}`;
      }
    } else if (typeof data === 'object') {
      try {
        formatted += `\n  ${JSON.stringify(data, null, 2).split('\n').join('\n  ')}`;
      } catch {
        formatted += `\n  [Object cannot be stringified]`;
      }
    } else {
      formatted += ` ${data}`;
    }
  }

  return formatted;
}

/**
 * 获取调用位置信息
 */
function getCallerInfo() {
  const stack = new Error().stack;
  if (!stack) return '';

  const lines = stack.split('\n');
  // 跳过前几行（Error, getCallerInfo, log）
  for (let i = 4; i < lines.length; i++) {
    const line = lines[i];
    // 匹配 at xxx (file:line:col) 格式
    const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
    if (match) {
      const [, funcName, file, lineNum] = match;
      const fileName = file.split(/[/\\]/).pop();
      return `${fileName}:${lineNum}`;
    }
  }
  return '';
}

/**
 * 日志类
 */
class Logger {
  constructor(options = {}) {
    // 最小日志级别
    this.level = LOG_LEVELS[options.level] ?? LOG_LEVELS.info;

    // 是否输出到控制台
    this.console = options.console ?? true;

    // 是否输出到文件
    this.file = options.file ?? null;
    this.fileStream = null;

    // 是否显示调用位置
    this.showCaller = options.showCaller ?? false;

    // 是否使用颜色
    this.useColors = options.colors ?? true;

    // 模块标签
    this.module = options.module ?? null;

    // 初始化文件流
    if (this.file) {
      this._initFileStream();
    }

    // 创建子日志器
    this.children = new Map();
  }

  /**
   * 初始化文件流
   */
  _initFileStream() {
    try {
      // 确保目录存在
      const dir = dirname(this.file);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      this.fileStream = createWriteStream(this.file, { flags: 'a' });
      this.fileStream.on('error', (err) => {
        console.error('[Logger] File write error:', err);
      });
    } catch (err) {
      console.error('[Logger] Failed to create file stream:', err);
    }
  }

  /**
   * 写入日志到文件
   */
  _writeToFile(text) {
    if (this.fileStream) {
      this.fileStream.write(text + '\n');
    }
  }

  /**
   * 核心日志方法
   */
  _log(level, message, data) {
    // 检查日志级别
    if (LOG_LEVELS[level] > this.level) {
      return;
    }

    const parts = [];

    // 模块标签
    if (this.module) {
      parts.push(`[${this.module}]`);
    }

    // 格式化消息
    let formatted = formatMessage(level, message, data);

    // 调用位置
    if (this.showCaller) {
      const caller = getCallerInfo();
      if (caller) {
        formatted = formatted.replace(']', `][${caller}]`);
      }
    }

    // 控制台输出
    if (this.console) {
      const color = this.useColors ? COLORS[level] : '';
      const reset = this.useColors ? COLORS.reset : '';
      const text = color + formatted + reset;
      console.log(text);
    }

    // 文件输出
    if (this.file) {
      this._writeToFile(formatted);
    }
  }

  /**
   * 创建子日志器
   */
  child(module) {
    if (this.children.has(module)) {
      return this.children.get(module);
    }

    const childLogger = new Logger({
      level: LOG_LEVELS[this.getLevelName()] === undefined ? 'info' : this.getLevelName(),
      console: this.console,
      file: this.file,
      showCaller: this.showCaller,
      colors: this.useColors,
      module: module,
    });

    this.children.set(module, childLogger);
    return childLogger;
  }

  /**
   * 获取当前日志级别名称
   */
  getLevelName() {
    return Object.entries(LOG_LEVELS).find(([, v]) => v === this.level)?.[0] ?? 'info';
  }

  /**
   * 设置日志级别
   */
  setLevel(level) {
    if (LOG_LEVELS[level] !== undefined) {
      this.level = LOG_LEVELS[level];
    }
  }

  /**
   * 关闭日志器
   */
  close() {
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = null;
    }
  }
}

// 创建默认日志器实例
const defaultLogger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  console: true,
  file: process.env.LOG_FILE || null,
  showCaller: process.env.NODE_ENV !== 'production',
  colors: true,
});

// 快捷方法
const logger = {
  error: (message, data) => defaultLogger._log('error', message, data),
  warn: (message, data) => defaultLogger._log('warn', message, data),
  info: (message, data) => defaultLogger._log('info', message, data),
  debug: (message, data) => defaultLogger._log('debug', message, data),
  trace: (message, data) => defaultLogger._log('trace', message, data),

  // 子日志器
  child: (module) => defaultLogger.child(module),

  // 配置
  setLevel: (level) => defaultLogger.setLevel(level),
  getLevel: () => defaultLogger.getLevelName(),

  // 关闭
  close: () => defaultLogger.close(),

  // 创建新的日志器实例
  create: (options) => new Logger(options),
};

// 导出
export default logger;
export { Logger, LOG_LEVELS };
