/**
 * IndexedDB 数据库模块 - 离线存储
 */
const DB_NAME = 'jingji-db';
const DB_VERSION = 1;
let dbInstance = null;

/**
 * 打开数据库连接
 */
export async function openDB() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 比赛记录存储
      if (!db.objectStoreNames.contains('races')) {
        const raceStore = db.createObjectStore('races', { keyPath: 'id', autoIncrement: true });
        raceStore.createIndex('timestamp', 'timestamp');
        raceStore.createIndex('distance', 'distance');
        raceStore.createIndex('raceName', 'raceName');
      }

      // 待同步数据
      if (!db.objectStoreNames.contains('pendingSync')) {
        db.createObjectStore('pendingSync', { keyPath: 'id', autoIncrement: true });
      }

      // 运动员数据
      if (!db.objectStoreNames.contains('athletes')) {
        db.createObjectStore('athletes', { keyPath: 'id' });
        db.createObjectStore('athletes').createIndex('name', 'name');
      }
    };
  });
}

/**
 * 保存比赛记录
 */
export async function saveRace(race) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('races', 'readwrite');
    const request = tx.objectStore('races').add(race);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 获取所有比赛记录
 */
export async function getRaces(limit = 50) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('races', 'readonly');
    const request = tx.objectStore('races').getAll();
    request.onsuccess = () => resolve(request.result.slice(0, limit));
    request.onerror = () => reject(request.error);
  });
}

/**
 * 按距离筛选比赛
 */
export async function getRacesByDistance(distance) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('races', 'readonly');
    const index = tx.objectStore('races').index('distance');
    const request = index.getAll(distance);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 搜索比赛记录
 */
export async function searchRaces(query) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('races', 'readonly');
    const request = tx.objectStore('races').getAll();
    request.onsuccess = () => {
      const q = query.toLowerCase();
      const results = request.result.filter(race =>
        race.raceName?.toLowerCase().includes(q) ||
        race.orgName?.toLowerCase().includes(q)
      );
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 保存运动员
 */
export async function saveAthlete(athlete) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('athletes', 'readwrite');
    const request = tx.objectStore('athletes').put(athlete);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 获取运动员
 */
export async function getAthlete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('athletes', 'readonly');
    const request = tx.objectStore('athletes').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 添加待同步数据
 */
export async function addPendingSync(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingSync', 'readwrite');
    const request = tx.objectStore('pendingSync').add({
      ...data,
      timestamp: Date.now()
    });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 获取待同步数据数量
 */
export async function getPendingSyncCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingSync', 'readonly');
    const request = tx.objectStore('pendingSync').count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 清除所有数据
 */
export async function clearAllData() {
  const db = await openDB();
  const stores = ['races', 'athletes', 'pendingSync'];

  for (const storeName of stores) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
