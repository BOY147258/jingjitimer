/**
 * UI 辅助函数模块
 */

/**
 * 格式化时间显示
 */
export function formatTime(ms) {
  if (ms == null || isNaN(ms)) return '--:--.---';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  if (minutes > 0) {
    return minutes + ':' + seconds.toString().padStart(2, '0') + '.' + millis.toString().padStart(3, '0');
  }
  return seconds + '.' + millis.toString().padStart(3, '0');
}

/**
 * 格式化时间差
 */
export function formatTimeDiff(ms) {
  if (ms == null) return '';
  const sign = ms >= 0 ? '+' : '';
  return sign + formatTime(Math.abs(ms));
}

/**
 * 获取道次颜色
 */
export function getLaneColor(lane) {
  const colors = ['#4F46E5', '#DC2626', '#16A34A', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316'];
  return colors[(lane - 1) % colors.length];
}

/**
 * 获取道次标识
 */
export function getLaneLabel(lane) {
  return String.fromCharCode(64 + lane); // 1->A, 2->B...
}

/**
 * 显示 Toast 消息
 */
export function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'toast ' + type;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

/**
 * 下载文件
 */
export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 防抖函数
 */
export function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * 节流函数
 */
export function throttle(fn, limit = 100) {
  let inThrottle = false;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}
