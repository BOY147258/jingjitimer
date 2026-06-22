/**
 * Service Worker - 竞迹计时器 v3
 * 支持离线缓存、后台同步和推送通知
 */

const CACHE_NAME = 'jingji-timer-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/bundle-all.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// 安装 - 缓存静态资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// 激活 - 清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => {
      console.log('[SW] Claiming clients');
      return self.clients.claim();
    })
  );
});

// 请求拦截
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API 请求使用网络优先
  if (url.pathname.startsWith('/api/') || url.hostname.includes('render.com')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok && event.request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request)
            .then(cached => {
              if (cached) return cached;
              return new Response(
                JSON.stringify({ error: '离线', offline: true }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
              );
            });
        })
    );
    return;
  }

  // 静态资源使用缓存优先
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;

        return fetch(event.request)
          .then(response => {
            if (response.ok && event.request.method === 'GET') {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, clone);
              });
            }
            return response;
          })
          .catch(() => {
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            return new Response('Offline', { status: 503 });
          });
      })
  );
});

// 消息处理
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0]?.postMessage({ success: true });
    });
  }
});
