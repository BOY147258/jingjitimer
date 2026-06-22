/**
 * 用户引导系统
 * 提供新手引导和操作提示
 */

/**
 * 引导步骤定义
 */
const GUIDES = {
  solo: [
    {
      id: 'welcome',
      target: null,
      title: '欢迎使用竞迹计时器',
      content: '这是一个精准的田径计时工具，支持多种比赛模式。',
      position: 'center',
      buttons: [{ text: '开始设置', action: 'next' }]
    },
    {
      id: 'lanes',
      target: '#lane-minus',
      title: '设置道数',
      content: '根据比赛需要设置道数（1-8道）',
      position: 'bottom',
      buttons: [
        { text: '上一步', action: 'prev' },
        { text: '下一步', action: 'next' }
      ]
    },
    {
      id: 'distance',
      target: '#distance-select',
      title: '选择距离',
      content: '选择比赛距离，支持50米到3000米',
      position: 'bottom',
      buttons: [
        { text: '上一步', action: 'prev' },
        { text: '下一步', action: 'next' }
      ]
    },
    {
      id: 'race-start',
      target: '#btn-start-race',
      title: '开始比赛',
      content: '点击开始按钮启动计时器，或使用空格键快捷发令',
      position: 'top',
      buttons: [
        { text: '上一步', action: 'prev' },
        { text: '知道了', action: 'complete' }
      ]
    }
  ],

  start: [
    {
      id: 'role-start',
      target: null,
      title: '发令端设置',
      content: '发令端负责检测枪声并控制计时开始',
      position: 'center',
      buttons: [{ text: '继续', action: 'next' }]
    },
    {
      id: 'room-code',
      target: '#room-code-set',
      title: '设置房间码',
      content: '设置一个4-6位房间码，告知终点端设备使用',
      position: 'bottom',
      buttons: [
        { text: '上一步', action: 'prev' },
        { text: '下一步', action: 'next' }
      ]
    },
    {
      id: 'gunshot',
      target: '#btn-gun',
      title: '枪声检测',
      content: '准备好后开枪，系统会自动检测枪声并开始计时',
      position: 'top',
      buttons: [
        { text: '上一步', action: 'prev' },
        { text: '完成了', action: 'complete' }
      ]
    }
  ],

  finish: [
    {
      id: 'role-finish',
      target: null,
      title: '终点端设置',
      content: '终点端负责AI自动识别运动员冲线',
      position: 'center',
      buttons: [{ text: '继续', action: 'next' }]
    },
    {
      id: 'camera',
      target: '#camera-preview',
      title: '摄像头设置',
      content: '确保摄像头对准终点线，AI会自动追踪运动员',
      position: 'right',
      buttons: [
        { text: '上一步', action: 'prev' },
        { text: '下一步', action: 'next' }
      ]
    },
    {
      id: 'room-connect',
      target: '#room-code-input',
      title: '连接发令端',
      content: '输入发令端设置的房间码进行连接',
      position: 'bottom',
      buttons: [
        { text: '上一步', action: 'prev' },
        { text: '完成了', action: 'complete' }
      ]
    }
  ]
};

/**
 * 快捷键提示配置
 */
const SHORTCUTS = {
  ' ': { action: '发令/停止', category: '比赛' },
  'Enter': { action: '记录成绩', category: '比赛' },
  'Escape': { action: '取消/返回', category: '导航' },
  '1-8': { action: '选择道次', category: '比赛' },
  'c': { action: '摄像头设置', category: '设置', mac: '⌘+c' },
  'm': { action: '麦克风设置', category: '设置', mac: '⌘+m' },
  'e': { action: '导出成绩', category: '导出', mac: '⌘+e' },
  'r': { action: '重置比赛', category: '比赛' },
  '?': { action: '显示帮助', category: '帮助' }
};

/**
 * 引导管理器
 */
export class GuideManager {
  constructor() {
    this.currentRole = 'solo';
    this.currentStep = 0;
    this.isActive = false;
    this.overlay = null;
    this.stepData = null;
    this.onComplete = null;
  }

  /**
   * 开始引导
   */
  start(role = 'solo', onComplete = null) {
    this.currentRole = role;
    this.currentStep = 0;
    this.isActive = true;
    this.onComplete = onComplete;

    // 检查是否已完成过引导
    if (this.hasCompletedGuide()) {
      console.log('[Guide] Already completed, skipping');
      this.isActive = false;
      return;
    }

    const steps = GUIDES[role] || GUIDES.solo;
    this.showStep(steps[0]);
  }

  /**
   * 显示当前步骤
   */
  showStep(stepData) {
    this.stepData = stepData;

    // 移除旧的引导
    this.removeOverlay();

    // 创建引导覆盖层
    this.createOverlay(stepData);
  }

  /**
   * 创建引导覆盖层
   */
  createOverlay(step) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'guide-overlay';
    this.overlay.id = 'guide-overlay';

    const content = document.createElement('div');
    content.className = 'guide-content';
    content.innerHTML = `
      <div class="guide-header">
        <span class="guide-icon">💡</span>
        <h3 class="guide-title">${step.title}</h3>
      </div>
      <p class="guide-text">${step.content}</p>
      <div class="guide-progress">
        ${this.getProgressDots()}
      </div>
      <div class="guide-buttons">
        ${step.buttons.map(btn => `
          <button class="guide-btn guide-btn-${btn.action === 'prev' ? 'secondary' : 'primary'}"
                  data-action="${btn.action}">
            ${btn.text}
          </button>
        `).join('')}
      </div>
    `;

    this.overlay.appendChild(content);
    document.body.appendChild(this.overlay);

    // 添加按钮事件
    content.querySelectorAll('.guide-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.handleAction(btn.dataset.action);
      });
    });

    // 滚动到目标元素
    if (step.target) {
      const target = document.querySelector(step.target);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  /**
   * 处理按钮动作
   */
  handleAction(action) {
    const steps = GUIDES[this.currentRole] || GUIDES.solo;

    switch (action) {
      case 'next':
        this.currentStep++;
        if (this.currentStep < steps.length) {
          this.showStep(steps[this.currentStep]);
        }
        break;

      case 'prev':
        this.currentStep--;
        if (this.currentStep >= 0) {
          this.showStep(steps[this.currentStep]);
        }
        break;

      case 'complete':
        this.complete();
        break;

      case 'skip':
        this.skip();
        break;
    }
  }

  /**
   * 完成引导
   */
  complete() {
    this.markCompleted();
    this.removeOverlay();
    this.isActive = false;
    if (this.onComplete) {
      this.onComplete();
    }
  }

  /**
   * 跳过引导
   */
  skip() {
    this.removeOverlay();
    this.isActive = false;
  }

  /**
   * 移除引导层
   */
  removeOverlay() {
    const existing = document.getElementById('guide-overlay');
    if (existing) {
      existing.remove();
    }
  }

  /**
   * 获取进度点
   */
  getProgressDots() {
    const steps = GUIDES[this.currentRole] || GUIDES.solo;
    return steps.map((_, i) => `
      <span class="guide-dot ${i === this.currentStep ? 'active' : ''} ${i < this.currentStep ? 'completed' : ''}"></span>
    `).join('');
  }

  /**
   * 标记引导已完成
   */
  markCompleted() {
    localStorage.setItem(`jingji_guide_${this.currentRole}_completed`, 'true');
  }

  /**
   * 检查引导是否已完成
   */
  hasCompletedGuide() {
    return localStorage.getItem(`jingji_guide_${this.currentRole}_completed`) === 'true';
  }

  /**
   * 重置引导状态
   */
  resetGuide(role = 'solo') {
    localStorage.removeItem(`jingji_guide_${role}_completed`);
  }

  /**
   * 重置所有引导
   */
  resetAllGuides() {
    Object.keys(GUIDES).forEach(role => {
      localStorage.removeItem(`jingji_guide_${role}_completed`);
    });
  }
}

/**
 * 快捷键提示管理器
 */
export class ShortcutManager {
  constructor() {
    this.shortcuts = SHORTCUTS;
    this.listeners = [];
    this.isEnabled = true;
  }

  /**
   * 注册快捷键
   */
  register(key, callback) {
    this.listeners.push({ key, callback });
  }

  /**
   * 启用快捷键
   */
  enable() {
    this.isEnabled = true;
  }

  /**
   * 禁用快捷键
   */
  disable() {
    this.isEnabled = false;
  }

  /**
   * 处理键盘事件
   */
  handleKeydown(event) {
    if (!this.isEnabled) return;

    // 忽略输入框中的按键
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      return;
    }

    const key = event.key;

    // 触发监听器
    for (const { key: k, callback } of this.listeners) {
      if (k === key) {
        event.preventDefault();
        callback(event);
        return;
      }
    }
  }

  /**
   * 获取所有快捷键
   */
  getAllShortcuts() {
    return this.shortcuts;
  }

  /**
   * 显示快捷键提示
   */
  showShortcutsModal() {
    const modal = document.createElement('div');
    modal.className = 'shortcuts-modal';
    modal.id = 'shortcuts-modal';
    modal.innerHTML = `
      <div class="shortcuts-content">
        <div class="shortcuts-header">
          <h3>⌨️ 快捷键</h3>
          <button class="shortcuts-close" aria-label="关闭">×</button>
        </div>
        <div class="shortcuts-list">
          ${Object.entries(this.shortcuts).map(([key, info]) => `
            <div class="shortcut-item">
              <span class="shortcut-key">${key}</span>
              <span class="shortcut-action">${info.action}</span>
              <span class="shortcut-category">${info.category}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 添加关闭事件
    modal.querySelector('.shortcuts-close').addEventListener('click', () => {
      modal.remove();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }
}

// 导出全局实例
export const guideManager = new GuideManager();
export const shortcutManager = new ShortcutManager();

// 添加快捷键样式
const style = document.createElement('style');
style.textContent = `
  .guide-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.2s ease;
  }

  .guide-content {
    background: var(--bg-card, #111827);
    border: 1px solid var(--border, rgba(255,255,255,0.08));
    border-radius: 16px;
    padding: 24px;
    max-width: 360px;
    width: calc(100% - 32px);
    text-align: center;
  }

  .guide-header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-bottom: 16px;
  }

  .guide-icon {
    font-size: 32px;
  }

  .guide-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--text, #f0f2f5);
    margin: 0;
  }

  .guide-text {
    font-size: 14px;
    color: var(--text-muted, #6b7a99);
    line-height: 1.6;
    margin-bottom: 20px;
  }

  .guide-progress {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin-bottom: 20px;
  }

  .guide-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border, rgba(255,255,255,0.1));
    transition: all 0.2s ease;
  }

  .guide-dot.active {
    background: var(--accent, #ff6200);
    transform: scale(1.2);
  }

  .guide-dot.completed {
    background: var(--green, #00c853);
  }

  .guide-buttons {
    display: flex;
    gap: 12px;
    justify-content: center;
  }

  .guide-btn {
    padding: 10px 24px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    border: none;
  }

  .guide-btn-primary {
    background: var(--accent, #ff6200);
    color: white;
  }

  .guide-btn-primary:hover {
    filter: brightness(1.1);
  }

  .guide-btn-secondary {
    background: var(--bg-elevated, #1a2035);
    color: var(--text, #f0f2f5);
    border: 1px solid var(--border, rgba(255,255,255,0.08));
  }

  .shortcuts-modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    z-index: 10001;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .shortcuts-content {
    background: var(--bg-card, #111827);
    border: 1px solid var(--border, rgba(255,255,255,0.08));
    border-radius: 16px;
    padding: 24px;
    max-width: 400px;
    width: calc(100% - 32px);
  }

  .shortcuts-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  .shortcuts-header h3 {
    font-size: 18px;
    font-weight: 700;
    color: var(--text, #f0f2f5);
    margin: 0;
  }

  .shortcuts-close {
    background: none;
    border: none;
    font-size: 24px;
    color: var(--text-muted, #6b7a99);
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .shortcuts-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .shortcut-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: var(--bg-elevated, #1a2035);
    border-radius: 8px;
  }

  .shortcut-key {
    background: var(--bg, #0a0d14);
    padding: 4px 8px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 12px;
    color: var(--accent, #ff6200);
    min-width: 60px;
    text-align: center;
  }

  .shortcut-action {
    flex: 1;
    font-size: 13px;
    color: var(--text, #f0f2f5);
  }

  .shortcut-category {
    font-size: 11px;
    color: var(--text-muted, #6b7a99);
    background: var(--bg, #0a0d14);
    padding: 2px 8px;
    border-radius: 4px;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`;
document.head.appendChild(style);
