/**
 * @fileoverview JSDoc 类型注解示例
 *
 * 本文件展示如何为 JavaScript 代码添加 JSDoc 类型注解
 * 以获得 IDE 智能提示和 TypeScript 类型检查
 *
 * @example
 * // 安装 TypeScript 和相关工具
 * npm install -D typescript @typescript-eslint/parser @typescript-eslint/eslint-plugin
 *
 * // 启用检查
 * npx tsc --checkJs
 */

// ============================================
// 示例 1: 函数类型注解
// ============================================

/**
 * 格式化时间显示
 * @param {number} ms - 毫秒时间戳
 * @param {boolean} [showMs=true] - 是否显示毫秒
 * @returns {string} 格式化的时间字符串，如 "12.345"
 */
export function formatTime(ms, showMs = true) {
  const seconds = Math.floor(ms / 1000);
  const milliseconds = ms % 1000;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (showMs) {
    return minutes > 0
      ? `${minutes}:${String(remainingSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`
      : `${seconds}.${String(milliseconds).padStart(3, '0')}`;
  }
  return minutes > 0
    ? `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
    : `${seconds}`;
}

/**
 * 验证房间码格式
 * @param {string} code - 房间码
 * @returns {boolean} 是否有效
 */
export function validateRoomCode(code) {
  return typeof code === 'string' && /^\d{4,6}$/.test(code);
}

// ============================================
// 示例 2: 类类型注解
// ============================================

/**
 * 简单的计时器类
 * @class
 */
export class SimpleTimer {
  /**
   * @type {number|null}
   * @private
   */
  _startTime = null;

  /**
   * @type {number}
   * @private
   */
  _elapsed = 0;

  /**
   * @type {'idle'|'running'|'paused'}
   */
  state = 'idle';

  /**
   * 开始计时
   * @returns {void}
   */
  start() {
    if (this.state === 'running') return;
    this._startTime = Date.now();
    this.state = 'running';
  }

  /**
   * 停止计时
   * @returns {number} 经过的时间（毫秒）
   */
  stop() {
    if (this.state !== 'running') return this._elapsed;
    this._elapsed += Date.now() - this._startTime;
    this._startTime = null;
    this.state = 'paused';
    return this._elapsed;
  }

  /**
   * 获取当前时间
   * @returns {number} 经过的时间（毫秒）
   */
  getElapsed() {
    if (this.state === 'running') {
      return this._elapsed + (Date.now() - this._startTime);
    }
    return this._elapsed;
  }

  /**
   * 重置计时器
   * @returns {void}
   */
  reset() {
    this._startTime = null;
    this._elapsed = 0;
    this.state = 'idle';
  }
}

// ============================================
// 示例 3: 回调和异步函数
// ============================================

/**
 * 异步保存成绩
 * @callback saveResultCallback
 * @param {boolean} success - 是否成功
 * @param {string} [error] - 错误信息
 */

/**
 * 保存成绩到服务器
 * @param {import('./types.d.ts').Result} result - 成绩数据
 * @returns {Promise<{success: boolean, id?: string, error?: string}>}
 */
export async function saveResult(result) {
  try {
    const response = await fetch('/api/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return { success: true, id: data.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// 示例 4: 泛型
// ============================================

/**
 * 创建带类型的数组
 * @template T
 * @param {number} length - 数组长度
 * @param {T} initialValue - 初始值
 * @returns {T[]}
 */
export function createTypedArray(length, initialValue) {
  return Array(length).fill(initialValue);
}

// 使用示例
const stringArray = createTypedArray(3, '0');
const numberArray = createTypedArray(5, 0);
