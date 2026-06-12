import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function dbPath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

export function readDB(name) {
  const p = dbPath(name);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

export function writeDB(name, data) {
  const p = dbPath(name);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

export function nextId(records) {
  if (!records.length) return 1;
  return Math.max(...records.map(r => r.id || 0)) + 1;
}

export function findById(records, id) {
  return records.find(r => r.id === Number(id)) || null;
}

export function insertRecord(name, record) {
  const data = readDB(name);
  record.id = nextId(data);
  record.createdAt = Date.now();
  data.push(record);
  writeDB(name, data);
  return record;
}

// 批量插入（优化大量数据写入）
export function insertRecordsBatch(name, records) {
  const data = readDB(name);
  const startId = nextId(data);
  const now = Date.now();

  records.forEach((record, index) => {
    record.id = startId + index;
    record.createdAt = now;
    data.push(record);
  });

  writeDB(name, data);
  return records;
}

// 批量更新（优化大量数据更新）
export function updateRecordsBatch(name, updates) {
  const data = readDB(name);
  const updateMap = new Map(updates.map(u => [u.id, u]));

  data.forEach((record, index) => {
    const update = updateMap.get(record.id);
    if (update) {
      data[index] = { ...record, ...update, updatedAt: Date.now() };
    }
  });

  writeDB(name, data);
  return data;
}

export function updateRecord(name, id, patch) {
  const data = readDB(name);
  const idx = data.findIndex(r => r.id === Number(id));
  if (idx < 0) return null;
  data[idx] = { ...data[idx], ...patch, updatedAt: Date.now() };
  writeDB(name, data);
  return data[idx];
}

export function deleteRecord(name, id) {
  const data = readDB(name);
  const idx = data.findIndex(r => r.id === Number(id));
  if (idx < 0) return false;
  data.splice(idx, 1);
  writeDB(name, data);
  return true;
}

// 批量删除
export function deleteRecordsBatch(name, ids) {
  const data = readDB(name);
  const idSet = new Set(ids.map(id => Number(id)));
  const filtered = data.filter(r => !idSet.has(r.id));
  writeDB(name, filtered);
  return filtered.length !== data.length;
}

// 条件查询
export function queryRecords(name, filterFn) {
  const data = readDB(name);
  return filterFn ? data.filter(filterFn) : data;
}

// 分页查询（优化大量数据）
export function queryRecordsPaginated(name, { page = 1, pageSize = 20, filterFn = null, sortFn = null }) {
  let data = readDB(name);

  if (filterFn) {
    data = data.filter(filterFn);
  }

  if (sortFn) {
    data.sort(sortFn);
  }

  const total = data.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const items = data.slice(start, start + pageSize);

  return {
    items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    }
  };
}

// 数据统计
export function getStats(name) {
  const data = readDB(name);
  return {
    total: data.length,
    createdToday: data.filter(r => {
      const today = new Date().setHours(0, 0, 0, 0);
      return r.createdAt >= today;
    }).length,
    lastCreated: data.length > 0 ? data[data.length - 1].createdAt : null
  };
}