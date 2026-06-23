// 竞迹计时系统 Service Worker v27
// 优化：更好的离线支持 + 增量更新策略
const CACHE = 'jingjitimer-v27';

// 核心资源 - 必须缓存
const CORE_ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/timer.js',
  './js/audio.js',
  './js/recorder.js',
  './js/sync2.js',
  './js/finishline.js',
  './js/api-client.js',
  './manifest.json',
  './icons/icon.svg',
];

// 静态资源 - 可按需缓存
const STATIC_ASSETS = [
  './admin.html',
  './css/admin.css',
  './js/admin.js',
  './simple.html',
  './qrcode.html',
  './starter-flow.html',
];

// 离线回退HTML
const OFFLINE_PAGE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>竞迹 · 离线模式</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      padding: 20px;
    }
    .offline-card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px;
      padding: 40px;
      text-align: center;
      max-width: 400px;
    }
    .offline-icon { font-size: 64px; margin-bottom: 20px; }
    .offline-title { font-size: 24px; font-weight: 700; margin-bottom: 12px; color: #ff6200; }
    .offline-desc { color: rgba(255,255,255,0.7); line-height: 1.6; margin-bottom: 24px; }
    .offline-hint {
      background: rgba(255,98,0,0.1);
      border: 1px solid rgba(255,98,0,0.3);
      border-radius: 12px;
      padding: 16px;
      font-size: 14px;
      color: rgba(255,255,255,0.8);
    }
    .retry-btn {
      background: #ff6200;
      color: #fff;
      border: none;
      padding: 14px 32px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 20px;
    }
    .retry-btn:active { transform: scale(0.98); }
  </style>
</head>
<body>
  <div class="offline-card">
    <div class="offline-icon">📡</div>
    <div class="offline-title">网络已断开</div>
    <div class="offline-desc">
      竞迹计时系统目前处于离线模式。<br>
      单机模式可在无网络环境下正常使用。<br>
      多设备连接需要恢复网络后重试。
    </div>
    <div class="offline-hint">
      💡 提示：检查您的网络连接，然后点击下方按钮重试
    </div>
    <button class="retry-btn" onclick="location.reload()">🔄 重新连接</button>
  </div>
</body>
</html>
`;

// 安装阶段 - 缓存核心资源
self.addEventListener('install', e => {
  console.log('[SW] Installing v27...');
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => {
        console.log('[SW] Caching core assets...');
        return Promise.allSettled(
          CORE_ASSETS.map(url => cache.add(url).catch(err => {
            console.warn(`[SW] Failed to cache: ${url}`, err);
          }))
        );
      })
      .then(() => {
        console.log('[SW] Skip waiting, activate immediately');
        return self.skipWaiting();
      })
  );
});

// 激活阶段 - 清理旧缓存
self.addEventListener('activate', e => {
  console.log('[SW] Activating v27...');
  e.waitUntil(
    caches.keys()
      .then(keys => {
        return Promise.all(
          keys
            .filter(k => k !== CACHE)
            .map(k => {
              console.log('[SW] Deleting old cache:', k);
              return caches.delete(k);
            })
        );
      })
      .then(() => {
        console.log('[SW] Claiming clients');
        return self.clients.claim();
      })
  );
});

// 获取阶段 - 智能缓存策略
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 只处理同源GET请求
  if (e.request.method !== 'GET') return;
  if (!url.origin.includes(self.location.origin) && !url.hostname.includes('github.io')) return;

  // Google Fonts 等外部资源 - 使用缓存优先
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 核心资源（HTML/JS/CSS） - Stale-while-revalidate
  if (url.pathname.match(/\.(html|js|css)$/) || url.pathname === '/' || url.pathname.endsWith('/')) {
    e.respondWith(
      caches.open(CACHE).then(cache => {
        return cache.match(e.request).then(cached => {
          const fetchPromise = fetch(e.request)
            .then(response => {
              if (response.ok) {
                cache.put(e.request, response.clone());
              }
              return response;
            })
            .catch(() => {
              // 网络失败但有缓存，返回缓存
              if (cached) return cached;
              // 如果是导航请求，返回离线页面
              if (e.request.mode === 'navigate') {
                return new Response(OFFLINE_PAGE, {
                  headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
              }
              return new Response('Offline', { status: 503 });
            });

          // 如果有缓存，先返回缓存，同时更新
          if (cached) {
            fetchPromise.catch(() => {});
            return cached;
          }
          return fetchPromise;
        });
      })
    );
    return;
  }

  // 图片等静态资源 - 缓存优先
  if (url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|webp)$/)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return response;
        }).catch(() => cached || new Response('', { status: 404 }));
      })
    );
    return;
  }

  // 其他请求 - 网络优先
  e.respondWith(
    fetch(e.request)
      .catch(() => caches.match(e.request))
  );
});

// 后台同步 - 重新获取失败的请求
self.addEventListener('sync', e => {
  if (e.tag === 'retry-failed') {
    console.log('[SW] Retrying failed requests...');
  }
});

// 推送通知（预留）
self.addEventListener('push', e => {
  if (e.data) {
    const data = e.data.json();
    self.registration.showNotification(data.title || '竞迹通知', {
      body: data.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: data.tag || 'jingji-notify',
    });
  }
});

// 通知点击
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow('/');
      }
    })
  );
});

console.log('[SW] Service Worker v27 loaded');