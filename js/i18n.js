/**
 * 国际化模块 (i18n)
 * 支持中文（默认）和英文切换
 */

const translations = {
  'zh-CN': {
    // 应用名称
    appName: '竞迹',
    appTagline: '精准计时 · 智能田径',

    // 角色选择
    roleTitle: '选择设备角色',
    roleSolo: '单机模式',
    roleSoloDesc: '一台设备 · 手动记录终点',
    roleStart: '发令端',
    roleStartDesc: '检测枪声 · 控制计时开始',
    roleFinish: '终点端',
    roleFinishDesc: 'AI 自动识别冲线 · 慢动作回放',
    roleObserver: '成绩端',
    roleObserverDesc: '实时接收成绩 · 随时导出 Excel',

    // 连接
    connection: '连接配对',
    setRoomCode: '设置房间码',
    setRoomCodeHint: '（4位，告知所有终点端）',
    enterRoomCode: '输入发令端房间码',
    connectBtn: '连接到比赛',
    connected: '已连接',
    connecting: '连接中...',
    disconnected: '未连接',
    connectionFailed: '连接失败',

    // 设置页面
    setup: '设置',
    lanes: '道数',
    distance: '距离',
    raceName: '比赛名称',
    orgName: '组织名称',
    trackLength: '跑道长度',
    laps: '圈数',
    wind: '风速 (m/s)',
    weather: '天气',
    temperature: '温度 (°C)',
    temperatureUnit: '°C',

    // 比赛页面
    race: '比赛',
    startRace: '开始比赛',
    stopRace: '结束比赛',
    manualStart: '手动发令',
    gunSound: '枪声发令',
    falseStart: '抢跑',
    recall: '召回',
    resetRace: '重置',
    countdown: '倒计时',
    go: '预备！',

    // 成绩页面
    results: '成绩',
    rank: '名次',
    lane: '道次',
    name: '姓名',
    time: '成绩',
    bestTime: '最佳成绩',
    avgTime: '平均成绩',
    dnf: '未完成',
    dns: '未出发',
    reaction: '反应时间',

    // 导出
    export: '导出',
    exportCsv: 'CSV',
    exportXlsx: 'Excel',
    exportPdf: 'PDF',
    batchExport: '批量导出',
    exportSuccess: '导出成功',
    exportFailed: '导出失败',

    // 历史
    history: '历史记录',
    noHistory: '暂无历史成绩',
    clearHistory: '清除历史',
    clearConfirm: '确定清除所有历史成绩？',

    // 设备状态
    micStatus: '麦克风',
    camStatus: '摄像头',
    connected: '已连接',
    disconnected: '未连接',
    permissionDenied: '权限被拒绝',
    permissionGranted: '已授权',

    // 错误消息
    errorNoPermission: '请授权摄像头和麦克风权限',
    errorNoCamera: '未检测到摄像头',
    errorNoMic: '未检测到麦克风',
    errorConnectionLost: '连接已断开',
    errorServerError: '服务器错误',

    // 帮助
    help: '帮助',
    helpTitle: '使用说明',
    shortcut: '快捷键',
    shortcutStart: '空格键：发令/停止',
    shortcutLane: '1-8：选择道次',
    shortcutFinish: 'Enter：记录成绩',

    // 诊断
    diagnostic: '设备诊断',
    diagnosticTitle: '诊断信息',
    deviceInfo: '设备信息',
    browser: '浏览器',
    os: '操作系统',
    network: '网络状态',
    latency: '延迟',

    // 按钮
    confirm: '确认',
    cancel: '取消',
    save: '保存',
    close: '关闭',
    retry: '重试',
    skip: '跳过',

    // 确认对话框
    confirmStart: '确定开始比赛？',
    confirmReset: '确定重置比赛？',
    confirmClear: '确定清除成绩？',

    // 距离选项
    'distance-50': '50米',
    'distance-100': '100米',
    'distance-200': '200米',
    'distance-400': '400米',
    'distance-800': '800米',
    'distance-1500': '1500米',
    'distance-3000': '3000米',
  },

  'en-US': {
    // App name
    appName: 'JingJi',
    appTagline: 'Precision Timing · Smart Athletics',

    // Role selection
    roleTitle: 'Select Device Role',
    roleSolo: 'Solo Mode',
    roleSoloDesc: 'Single device · Manual finish recording',
    roleStart: 'Starter',
    roleStartDesc: 'Detect gun shot · Control timer start',
    roleFinish: 'Finish Line',
    roleFinishDesc: 'AI finish detection · Slow-mo replay',
    roleObserver: 'Results',
    roleObserverDesc: 'Live results · Export anytime',

    // Connection
    connection: 'Connection',
    setRoomCode: 'Set Room Code',
    setRoomCodeHint: '(4 digits, share with finish devices)',
    enterRoomCode: 'Enter Starter Room Code',
    connectBtn: 'Connect to Race',
    connected: 'Connected',
    connecting: 'Connecting...',
    disconnected: 'Disconnected',
    connectionFailed: 'Connection failed',

    // Setup page
    setup: 'Setup',
    lanes: 'Lanes',
    distance: 'Distance',
    raceName: 'Race Name',
    orgName: 'Organization',
    trackLength: 'Track Length',
    laps: 'Laps',
    wind: 'Wind (m/s)',
    weather: 'Weather',
    temperature: 'Temperature (°C)',
    temperatureUnit: '°C',

    // Race page
    race: 'Race',
    startRace: 'Start Race',
    stopRace: 'End Race',
    manualStart: 'Manual Start',
    gunSound: 'Gun Shot',
    falseStart: 'False Start',
    recall: 'Recall',
    resetRace: 'Reset',
    countdown: 'Countdown',
    go: 'Go!',

    // Results page
    results: 'Results',
    rank: 'Rank',
    lane: 'Lane',
    name: 'Name',
    time: 'Time',
    bestTime: 'Best Time',
    avgTime: 'Average Time',
    dnf: 'DNF',
    dns: 'DNS',
    reaction: 'Reaction',

    // Export
    export: 'Export',
    exportCsv: 'CSV',
    exportXlsx: 'Excel',
    exportPdf: 'PDF',
    batchExport: 'Batch Export',
    exportSuccess: 'Export successful',
    exportFailed: 'Export failed',

    // History
    history: 'History',
    noHistory: 'No history',
    clearHistory: 'Clear History',
    clearConfirm: 'Clear all history?',

    // Device status
    micStatus: 'Microphone',
    camStatus: 'Camera',
    connected: 'Connected',
    disconnected: 'Disconnected',
    permissionDenied: 'Permission denied',
    permissionGranted: 'Authorized',

    // Error messages
    errorNoPermission: 'Please grant camera and microphone permissions',
    errorNoCamera: 'No camera detected',
    errorNoMic: 'No microphone detected',
    errorConnectionLost: 'Connection lost',
    errorServerError: 'Server error',

    // Help
    help: 'Help',
    helpTitle: 'User Guide',
    shortcut: 'Shortcuts',
    shortcutStart: 'Space: Start/Stop',
    shortcutLane: '1-8: Select lane',
    shortcutFinish: 'Enter: Record time',

    // Diagnostic
    diagnostic: 'Diagnostic',
    diagnosticTitle: 'Device Info',
    deviceInfo: 'Device',
    browser: 'Browser',
    os: 'OS',
    network: 'Network',
    latency: 'Latency',

    // Buttons
    confirm: 'Confirm',
    cancel: 'Cancel',
    save: 'Save',
    close: 'Close',
    retry: 'Retry',
    skip: 'Skip',

    // Confirm dialogs
    confirmStart: 'Start race?',
    confirmReset: 'Reset race?',
    confirmClear: 'Clear results?',

    // Distance options
    'distance-50': '50m',
    'distance-100': '100m',
    'distance-200': '200m',
    'distance-400': '400m',
    'distance-800': '800m',
    'distance-1500': '1500m',
    'distance-3000': '3000m',
  }
};

// 当前语言
let currentLang = 'zh-CN';

// 获取当前语言
export function getCurrentLang() {
  return currentLang;
}

// 获取翻译文本
export function t(key, params = {}) {
  const langData = translations[currentLang] || translations['zh-CN'];
  let text = langData[key] || translations['zh-CN'][key] || key;

  // 替换参数
  Object.entries(params).forEach(([k, v]) => {
    text = text.replace(`{${k}}`, v);
  });

  return text;
}

// 设置语言
export function setLanguage(lang) {
  if (translations[lang]) {
    currentLang = lang;
    localStorage.setItem('jingji_lang', lang);
    updatePageTranslations();
    return true;
  }
  return false;
}

// 初始化语言（从 localStorage 读取）
export function initLanguage() {
  const saved = localStorage.getItem('jingji_lang');
  if (saved && translations[saved]) {
    currentLang = saved;
  } else {
    // 检测浏览器语言
    const browserLang = navigator.language;
    if (browserLang.startsWith('en')) {
      currentLang = 'en-US';
    }
  }
  return currentLang;
}

// 更新页面所有翻译元素
export function updatePageTranslations() {
  // 更新所有 data-i18n 元素
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });

  // 更新所有 data-i18n-placeholder 元素
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });

  // 更新所有 data-i18n-aria 元素
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria');
    el.setAttribute('aria-label', t(key));
  });

  // 更新 HTML lang 属性
  document.documentElement.lang = currentLang === 'en-US' ? 'en' : 'zh-CN';
}

// 创建语言切换按钮
export function createLangSwitcher(containerId = 'header-actions') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const switcher = document.createElement('button');
  switcher.id = 'lang-switcher';
  switcher.className = 'lang-switcher';
  switcher.setAttribute('aria-label', '切换语言 / Switch language');
  switcher.textContent = currentLang === 'en-US' ? '中' : 'EN';

  switcher.addEventListener('click', () => {
    const newLang = currentLang === 'zh-CN' ? 'en-US' : 'zh-CN';
    setLanguage(newLang);
    switcher.textContent = newLang === 'en-US' ? '中' : 'EN';
  });

  container.appendChild(switcher);
}

// 获取支持的语言列表
export function getSupportedLanguages() {
  return [
    { code: 'zh-CN', name: '简体中文', nativeName: '中文' },
    { code: 'en-US', name: 'English', nativeName: 'English' }
  ];
}

// 导出所有
export default {
  t,
  setLanguage,
  getCurrentLang,
  initLanguage,
  updatePageTranslations,
  createLangSwitcher,
  getSupportedLanguages
};
