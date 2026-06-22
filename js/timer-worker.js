/**
 * 高精度计时器 Web Worker
 * 独立于主线程，确保即使 UI 繁忙也能精确计时
 */
let startTime = null;
let isRunning = false;
let lapTimes = [];
let animationFrameId = null;

// 使用高精度时间戳
const getHighResTime = () => performance.now();

function tick() {
  if (!isRunning) return;

  const elapsed = getHighResTime() - startTime;
  const elapsedInt = Math.floor(elapsed);

  // 计算时分秒毫秒
  const mins = Math.floor(elapsedInt / 60000);
  const secs = Math.floor((elapsedInt % 60000) / 1000);
  const ms = elapsedInt % 1000;
  const displayMs = Math.floor(ms / 10); // 显示10毫秒精度

  // 格式化为 MM:SS.CC (分:秒.百分秒)
  const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${displayMs.toString().padStart(2, '0')}`;

  // 发送更新到主线程
  self.postMessage({
    type: 'tick',
    elapsed,
    timeStr,
    mins,
    secs,
    ms,
    displayMs
  });

  // 继续计时
  animationFrameId = self.requestAnimationFrame(tick);
}

// 监听主线程消息
self.onmessage = function(e) {
  const { action, data } = e.data;

  switch (action) {
    case 'start':
      if (!isRunning) {
        startTime = getHighResTime();
        isRunning = true;
        lapTimes = [];
        tick();
        self.postMessage({ type: 'started', startTime });
      }
      break;

    case 'stop':
      if (isRunning) {
        isRunning = false;
        if (animationFrameId) {
          self.cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
        const endTime = getHighResTime();
        const elapsed = endTime - startTime;
        self.postMessage({ type: 'stopped', elapsed, endTime });
      }
      break;

    case 'lap':
      if (isRunning) {
        const lapTime = getHighResTime() - startTime;
        lapTimes.push(lapTime);
        self.postMessage({ type: 'lap', lapTime, lapIndex: lapTimes.length });
      }
      break;

    case 'reset':
      isRunning = false;
      startTime = null;
      lapTimes = [];
      if (animationFrameId) {
        self.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      self.postMessage({ type: 'reset' });
      break;

    case 'getStatus':
      self.postMessage({
        type: 'status',
        isRunning,
        startTime,
        elapsed: isRunning ? getHighResTime() - startTime : 0,
        lapTimes: [...lapTimes]
      });
      break;
  }
};

// 通知主线程 Worker 已就绪
self.postMessage({ type: 'ready' });
