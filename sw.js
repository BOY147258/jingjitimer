/**
 * Service Worker - 竞迹计时器
 * 支持离线缓存、后台同步和推送通知
 */

const CACHE_NAME = 'jingji-timer-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/timer.js',
  '/js/audio.js',
  '/js/recorder.js',
  '/js/finishline.js',
  '/js/sync2.js',
  '/js/export.js',
  '/js/i18n.js',
  '/js/state.js',
  '/js/storage.js',
  '/js/idb.js',
  '/js/ui-helpers.js',
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
          // 缓存成功的 API 响应
          if (response.ok && event.request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          // 离线时返回缓存或错误
          return caches.match(event.request)
            .then(cached => {
              if (cached) return cached;
              return new Response(
                JSON.stringify({ error: '离线', offline: true }),
                {
                  status: 503,
                  headers: { 'Content-Type': 'application/json' }
                }
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
            // 缓存新的响应
            if (response.ok && event.request.method === 'GET') {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, clone);
              });
            }
            return response;
          })
          .catch(() => {
            // 离线且无缓存时返回离线页面
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            return new Response('Offline', { status: 503 });
          });
      })
  );
});

// 推送通知
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: '竞迹计时器', body: event.data.text() };
  }

  const options = {
    body: data.body || '比赛有更新',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [100, 50, 100, 50, 100],
    data: {
      url: data.url || '/',
      raceId: data.raceId,
      type: data.type
    },
    actions: [
      { action: 'view', title: '查看' },
      { action: 'dismiss', title: '忽略' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '竞迹计时器', options)
  );
});

// 点击通知
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // 如果有打开的窗口，跳转到对应页面
        for (const client of clientList) {
          if (client.url.includes('/') && 'focus' in client) {
            client.focus();
            if (event.notification.data?.url) {
              client.navigate(event.notification.data.url);
            }
            return;
          }
        }
        // 否则打开新窗口
        if (clients.openWindow) {
          return clients.openWindow(event.notification.data?.url || '/');
        }
      })
  );
});

// 后台同步 - 比赛数据
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-race-data') {
    event.waitUntil(syncRaceData());
  }
});

async function syncRaceData() {
  console.log('[SW] Starting background sync...');

  try {
    const db = await openDB();
    const pending = await getAllPendingSync(db);

    for (const item of pending) {
      try {
        const response = await fetch('/api/races', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });

        if (response.ok) {
          await deletePendingSync(db, item.id);
          console.log('[SW] Synced race:', item.id);
        }
      } catch (e) {
        console.error('[SW] Sync failed for item:', item.id, e);
      }
    }

    // 通知所有客户端同步完成
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ type: 'SYNC_COMPLETE' });
    });

    console.log('[SW] Background sync completed');
  } catch (e) {
    console.error('[SW] Background sync error:', e);
  }
}

// IndexedDB 操作
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('jingji-db', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function getAllPendingSync(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingSync', 'readonly');
    const request = tx.objectStore('pendingSync').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function deletePendingSync(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingSync', 'readwrite');
    const request = tx.objectStore('pendingSync').delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// 消息处理
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_NAME });
  }
});
