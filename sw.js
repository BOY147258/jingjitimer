/**
 * 竞迹计时系统 - Service Worker v28
 * 功能：离线缓存、增量更新、后台同步、推送通知
 *
 * 缓存策略：
 * - 核心资源：Stale-while-revalidate（快速响应 + 增量更新）
 * - 静态资源：Cache-first（图片、字体等）
 * - API请求：Network-first（保证数据最新）
 */

const CACHE_NAME = 'jingjitimer-v28';
const OFFLINE_VERSION = '28';

// 核心资源 - 安装时必须缓存
const CORE_ASSETS = [
  './',
  './index.html',
  './admin.html',
  './qrcode.html',
  './simple.html',
  './starter-flow.html',
  './css/app.css',
  './css/admin.css',
  './js/app.js',
  './js/app-controller.js',
  './js/timer.js',
  './js/audio.js',
  './js/recorder.js',
  './js/sync.js',
  './js/sync2.js',
  './js/finishline.js',
  './js/api-client.js',
  './js/admin.js',
  './js/ai-detector.js',
  './js/shot-manager.js',
  './js/stats-analyzer.js',
  './manifest.json',
];

// 外部依赖 - 使用 CDN 缓存
const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
];

// 离线回退页面
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#080810">
  <title>竞迹 · 离线模式</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      background: linear-gradient(135deg, #0a0a14 0%, #12121f 50%, #0d0d18 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      padding: 20px;
      overflow-x: hidden;
    }
    .offline-container {
      max-width: 420px;
      width: 100%;
      text-align: center;
    }
    .offline-icon {
      font-size: 80px;
      margin-bottom: 24px;
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.05); opacity: 0.9; }
    }
    .offline-title {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 12px;
      background: linear-gradient(135deg, #ff6200 0%, #ff8c42 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .offline-desc {
      color: rgba(255,255,255,0.7);
      line-height: 1.8;
      margin-bottom: 28px;
      font-size: 15px;
    }
    .offline-features {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 24px;
      text-align: left;
    }
    .offline-features h3 {
      font-size: 14px;
      color: rgba(255,255,255,0.5);
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .offline-features ul {
      list-style: none;
    }
    .offline-features li {
      padding: 8px 0;
      color: rgba(255,255,255,0.8);
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .offline-features li::before {
      content: '✓';
      color: #ff6200;
      font-weight: bold;
    }
    .offline-features li.disabled::before {
      content: '✗';
      color: rgba(255,255,255,0.3);
    }
    .offline-features li.disabled {
      color: rgba(255,255,255,0.4);
    }
    .retry-btn {
      background: linear-gradient(135deg, #ff6200 0%, #ff8534 100%);
      color: #fff;
      border: none;
      padding: 16px 40px;
      border-radius: 14px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 4px 20px rgba(255, 98, 0, 0.3);
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .retry-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(255, 98, 0, 0.4);
    }
    .retry-btn:active {
      transform: translateY(0);
    }
    .version {
      position: fixed;
      bottom: 20px;
      color: rgba(255,255,255,0.3);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="offline-container">
    <div class="offline-icon">📡</div>
    <div class="offline-title">网络已断开</div>
    <p class="offline-desc">
      竞迹计时系统目前处于离线模式。<br>
      单机模式可在无网络环境下正常使用。
    </p>
    <div class="offline-features">
      <h3>离线可用功能</h3>
      <ul>
        <li>单机计时功能</li>
        <li>本地成绩记录</li>
        <li>摄像头预览</li>
        <li class="disabled">多设备同步（需网络）</li>
        <li class="disabled">成绩云端备份（需网络）</li>
      </ul>
    </div>
    <button class="retry-btn" onclick="location.reload()">
      <span>🔄</span> 重新连接
    </button>
  </div>
  <div class="version">竞迹 v${OFFLINE_VERSION}</div>
</body>
</html>`;

/**
 * 安装阶段 - 缓存核心资源
 */
self.addEventListener('install', event => {
  console.log(`[SW v${OFFLINE_VERSION}] Installing...`);

  event.waitUntil(
    Promise.all([
      // 缓存核心资源
      caches.open(CACHE_NAME).then(async cache => {
        console.log('[SW] Caching core assets...');
        const results = await Promise.allSettled(
          CORE_ASSETS.map(async url => {
            try {
              await cache.add(url);
              console.log(`[SW] ✓ Cached: ${url}`);
            } catch (err) {
              console.warn(`[SW] ✗ Failed: ${url}`, err.message);
            }
          })
        );
        const failed = results.filter(r => r.status === 'rejected').length;
        console.log(`[SW] Core caching complete: ${CORE_ASSETS.length - failed}/${CORE_ASSETS.length}`);
      }),
      // 预缓存外部资源
      caches.open(CACHE_NAME).then(async cache => {
        await Promise.allSettled(
          EXTERNAL_ASSETS.map(url =>
            fetch(url).then(r => r.ok ? cache.put(url, r) : null).catch(() => null)
          )
        );
      }),
      // 立即激活
      self.skipWaiting()
    ])
  );
});

/**
 * 激活阶段 - 清理旧缓存
 */
self.addEventListener('activate', event => {
  console.log(`[SW v${OFFLINE_VERSION}] Activating...`);

  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name.startsWith('jingjitimer-') && name !== CACHE_NAME)
          .map(name => {
            console.log(`[SW] Deleting old cache: ${name}`);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log(`[SW v${OFFLINE_VERSION}] Claiming clients...`);
      return self.clients.claim();
    })
  );
});

/**
 * 获取阶段 - 智能缓存策略
 */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理 GET 请求
  if (request.method !== 'GET') return;

  // 跨域处理（允许 GitHub Pages 等 CDN）
  const isSameOrigin = url.origin === self.location.origin;
  const isAllowedHost = ['github.io', 'unpkg.com', 'cdn.jsdelivr.net'].some(h => url.hostname.includes(h));
  if (!isSameOrigin && !isAllowedHost) return;

  // 1. Google Fonts - 缓存优先
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 2. 图片资源 - 缓存优先
  if (/\.(png|jpg|jpeg|gif|svg|ico|webp|avif)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 3. 导航请求（HTML页面） - Stale-while-revalidate
  if (request.mode === 'navigate' || /\.(html?)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 4. JS/CSS 资源 - Stale-while-revalidate
  if (/\.(js|css)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 5. API 请求 - Network first
  if (url.pathname.startsWith('/api') || url.pathname.includes('.json')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 6. 其他请求 - Network first with offline fallback
  event.respondWith(networkFirst(request));
});

/**
 * 缓存优先策略
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[SW] Cache-first fetch failed:', err.message);
    return new Response('', { status: 408 });
  }
}

/**
 * Stale-while-revalidate 策略
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // 立即返回缓存，同时更新
  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // 如果有缓存，先返回缓存
  if (cached) {
    // 忽略 fetchPromise 的错误
    fetchPromise.catch(() => {});
    return cached;
  }

  // 没有缓存，等待网络响应
  const networkResponse = await fetchPromise;
  if (networkResponse) return networkResponse;

  // 网络失败且没有缓存
  if (request.mode === 'navigate') {
    return new Response(OFFLINE_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  return new Response('Offline', { status: 503 });
}

/**
 * Network first 策略
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[SW] Network-first fetch failed:', err.message);
    const cached = await caches.match(request);
    if (cached) return cached;

    // API 请求返回友好的错误
    if (request.url.includes('/api')) {
      return new Response(JSON.stringify({ error: '网络不可用' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Offline', { status: 503 });
  }
}

/**
 * 后台同步 - 重新获取失败的请求
 */
self.addEventListener('sync', event => {
  console.log(`[SW] Background sync: ${event.tag}`);

  if (event.tag === 'retry-failed') {
    event.waitUntil(retryFailedRequests());
  }

  if (event.tag === 'sync-results') {
    event.waitUntil(syncPendingResults());
  }
});

/**
 * 重试失败的请求
 */
async function retryFailedRequests() {
  console.log('[SW] Retrying failed requests...');
  // 实现失败请求重试逻辑
}

/**
 * 同步待处理的成绩数据
 */
async function syncPendingResults() {
  console.log('[SW] Syncing pending results...');
  // 实现成绩同步逻辑
}

/**
 * 推送通知
 */
self.addEventListener('push', event => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: '竞迹通知', body: event.data.text() };
  }

  const options = {
    body: data.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/badge-72.png',
    tag: data.tag || 'jingji-notify',
    renotify: true,
    requireInteraction: data.requireInteraction || false,
    vibrate: [200, 100, 200],
    data: {
      url: data.url || './',
      ...data
    },
    actions: data.actions || [
      { action: 'open', title: '查看' },
      { action: 'dismiss', title: '忽略' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '竞迹通知', options)
  );
});

/**
 * 通知点击
 */
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const action = event.action;
  const data = event.notification.data;

  if (action === 'dismiss') return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        // 尝试聚焦已打开的窗口
        for (const client of clients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus();
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              data: data
            });
            return;
          }
        }
        // 没有已打开的窗口，打开新窗口
        return self.clients.openWindow(data.url || './');
      })
  );
});

/**
 * 消息处理
 */
self.addEventListener('message', event => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'GET_VERSION':
      event.ports[0]?.postMessage({ version: OFFLINE_VERSION });
      break;
    case 'CLEAR_CACHE':
      caches.delete(CACHE_NAME).then(() => {
        event.ports[0]?.postMessage({ success: true });
      });
      break;
    case 'CACHE_URLS':
      if (Array.isArray(payload?.urls)) {
        caches.open(CACHE_NAME).then(async cache => {
          await Promise.allSettled(
            payload.urls.map(url => cache.add(url).catch(() => null))
          );
          event.ports[0]?.postMessage({ success: true, cached: payload.urls.length });
        });
      }
      break;
  }
});

console.log(`[SW v${OFFLINE_VERSION}] Loaded`);
