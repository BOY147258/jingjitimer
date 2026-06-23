import { readDB, writeDB, insertRecord, updateRecord, deleteRecord, findById } from './db.js';
import {
  RaceState,
  canTransition,
  validateTransition,
  createShot,
  transitionTo,
  rankLanes,
  checkNeedsReview,
} from './state-machine.js';

// ── helpers ──────────────────────────────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
function err(res, msg, status = 400) { json(res, { error: msg }, status); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e6) reject(new Error('too large')); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function msToDisplay(ms) {
  if (!ms && ms !== 0) return '';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const c = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2,'0')}.${String(c).padStart(2,'0')}`;
}

// ── router ───────────────────────────────────────────────────────────────────
export async function handleAPI(req, res) {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.replace(/^\/api/, '').split('/').filter(Boolean);
  const method = req.method.toUpperCase();

  // POST /api/meets
  // GET  /api/meets
  // GET  /api/meets/:id
  // PUT  /api/meets/:id
  // DELETE /api/meets/:id

  try {
    // ── shots (枪次管理) ───────────────────────────────────────────────────
    if (parts[0] === 'shots') {
      // GET /api/shots — 获取所有枪次
      if (method === 'GET' && !parts[1]) {
        let shots = readDB('shots').reverse(); // 最新的在前
        const roomCode = url.searchParams.get('roomCode');
        const state = url.searchParams.get('state');
        if (roomCode) shots = shots.filter(s => s.roomCode === roomCode);
        if (state) shots = shots.filter(s => s.state === state);
        return json(res, shots);
      }

      // POST /api/shots — 创建新枪次
      if (method === 'POST') {
        const b = await readBody(req);
        if (!b.roomCode) return err(res, 'roomCode required');

        const shot = createShot({
          roomCode: b.roomCode,
          eventId: b.eventId || null,
          round: b.round || 1,
          group: b.group || 1,
          eventName: b.eventName || '',
          laneCount: b.laneCount || 8,
        });

        const saved = insertRecord('shots', shot);
        return json(res, saved, 201);
      }

      // GET /api/shots/:id — 获取单个枪次
      if (method === 'GET' && parts[1]) {
        const shot = findById(readDB('shots'), Number(parts[1]));
        return shot ? json(res, shot) : err(res, 'not found', 404);
      }

      // PUT /api/shots/:id — 更新枪次
      if (method === 'PUT' && parts[1]) {
        const b = await readBody(req);
        const updated = updateRecord('shots', Number(parts[1]), b);
        return updated ? json(res, updated) : err(res, 'not found', 404);
      }

      // POST /api/shots/:id/transition — 状态转换
      if (method === 'POST' && parts[1] === 'transition') {
        const b = await readBody(req);
        const { shotId, newState, data } = b;
        if (!shotId || !newState) return err(res, 'shotId and newState required');

        const shot = findById(readDB('shots'), Number(shotId));
        if (!shot) return err(res, 'shot not found', 404);

        // 验证状态转换
        if (!canTransition(shot.state, newState)) {
          return err(res, `Cannot transition from ${shot.state} to ${newState}`, 400);
        }

        // 执行转换
        let updates = { state: newState, updatedAt: Date.now() };

        // 根据目标状态添加额外数据
        if (newState === RaceState.SCHEDULED && data?.scheduledStartAt) {
          updates.scheduledStartAt = data.scheduledStartAt;
        }
        if (newState === RaceState.RUNNING && data?.actualStartAt) {
          updates.actualStartAt = data.actualStartAt;
        }
        if (data?.lanes) {
          updates.lanes = data.lanes;
        }

        const updated = updateRecord('shots', Number(shotId), updates);
        return json(res, updated);
      }

      // POST /api/shots/:id/finish — 终点计时（批量更新道次成绩）
      if (method === 'POST' && parts[1] && parts[2] === 'finish') {
        const b = await readBody(req);
        const shot = findById(readDB('shots'), Number(parts[1]));
        if (!shot) return err(res, 'shot not found', 404);

        // 更新道次成绩
        let lanes = shot.lanes.map(lane => {
          const update = (b.lanes || []).find(l => l.lane === lane.lane);
          return update ? { ...lane, ...update } : lane;
        });

        // 自动排名
        lanes = rankLanes(lanes);

        // 检查是否需要复核
        const needsReview = checkNeedsReview(lanes);
        const newState = needsReview ? RaceState.REVIEW : RaceState.PUBLISHED;

        const updated = updateRecord('shots', Number(parts[1]), {
          lanes,
          state: newState,
          updatedAt: Date.now(),
        });

        return json(res, updated);
      }

      // POST /api/shots/:id/publish — 发布成绩
      if (method === 'POST' && parts[1] && parts[2] === 'publish') {
        const shot = findById(readDB('shots'), Number(parts[1]));
        if (!shot) return err(res, 'shot not found', 404);

        if (shot.state !== RaceState.REVIEW && shot.state !== RaceState.RUNNING) {
          return err(res, `Cannot publish from state ${shot.state}`, 400);
        }

        const updated = updateRecord('shots', Number(parts[1]), {
          state: RaceState.PUBLISHED,
          updatedAt: Date.now(),
        });

        return json(res, updated);
      }

      // POST /api/shots/:id/abort — 召回重跑
      if (method === 'POST' && parts[1] && parts[2] === 'abort') {
        const b = await readBody(req);
        const shot = findById(readDB('shots'), Number(parts[1]));
        if (!shot) return err(res, 'shot not found', 404);

        const updated = updateRecord('shots', Number(parts[1]), {
          state: RaceState.ABORTED,
          updatedAt: Date.now(),
          metadata: {
            ...shot.metadata,
            abortReason: b.reason || '召回',
          },
        });

        return json(res, updated);
      }

      // DELETE /api/shots/:id — 删除枪次
      if (method === 'DELETE' && parts[1]) {
        deleteRecord('shots', Number(parts[1]));
        return json(res, { ok: true });
      }
    }

    // ── meets ──────────────────────────────────────────────────────────────
    if (parts[0] === 'meets') {
      if (method === 'GET' && !parts[1]) {
        return json(res, readDB('meets').reverse());
      }
      if (method === 'POST') {
        const b = await readBody(req);
        if (!b.name) return err(res, 'name required');
        const meet = insertRecord('meets', {
          name: b.name,
          date: b.date || new Date().toISOString().slice(0,10),
          location: b.location || '',
          notes: b.notes || '',
        });
        return json(res, meet, 201);
      }
      if (parts[1]) {
        const id = Number(parts[1]);
        if (method === 'GET') {
          const meet = findById(readDB('meets'), id);
          return meet ? json(res, meet) : err(res, 'not found', 404);
        }
        if (method === 'PUT') {
          const b = await readBody(req);
          const updated = updateRecord('meets', id, b);
          return updated ? json(res, updated) : err(res, 'not found', 404);
        }
        if (method === 'DELETE') {
          deleteRecord('meets', id);
          return json(res, { ok: true });
        }
      }
    }

    // ── events ─────────────────────────────────────────────────────────────
    if (parts[0] === 'events') {
      if (method === 'GET' && !parts[1]) {
        let events = readDB('events');
        if (url.searchParams.get('meetId')) {
          events = events.filter(e => e.meetId === Number(url.searchParams.get('meetId')));
        }
        return json(res, events);
      }
      if (method === 'POST') {
        const b = await readBody(req);
        if (!b.name || !b.meetId) return err(res, 'name and meetId required');
        const ev = insertRecord('events', {
          meetId:        Number(b.meetId),
          name:          b.name,
          distance:      b.distance || '',
          laps:          Number(b.laps) || 1,
          totalRounds:   Number(b.totalRounds) || 1,
          groupsPerRound:Number(b.groupsPerRound) || 1,
          advanceCount:  Number(b.advanceCount) || 0,
          gender:        b.gender || 'mixed',
          windSpeed:     b.windSpeed || null,
        });
        return json(res, ev, 201);
      }
      if (parts[1]) {
        const id = Number(parts[1]);
        if (method === 'GET') {
          const ev = findById(readDB('events'), id);
          return ev ? json(res, ev) : err(res, 'not found', 404);
        }
        if (method === 'PUT') {
          const b = await readBody(req);
          const updated = updateRecord('events', id, b);
          return updated ? json(res, updated) : err(res, 'not found', 404);
        }
        if (method === 'DELETE') {
          deleteRecord('events', id);
          return json(res, { ok: true });
        }
      }
    }

    // ── athletes ───────────────────────────────────────────────────────────
    if (parts[0] === 'athletes') {
      if (method === 'GET' && !parts[1]) {
        let athletes = readDB('athletes');
        if (url.searchParams.get('q')) {
          const q = url.searchParams.get('q').toLowerCase();
          athletes = athletes.filter(a =>
            a.name?.toLowerCase().includes(q) ||
            a.number?.toLowerCase().includes(q) ||
            a.team?.toLowerCase().includes(q)
          );
        }
        return json(res, athletes);
      }
      if (method === 'POST') {
        const b = await readBody(req);
        if (!b.name) return err(res, 'name required');
        const ath = insertRecord('athletes', {
          name:   b.name,
          number: b.number || '',
          team:   b.team || '',
          gender: b.gender || '',
          dob:    b.dob || '',
        });
        return json(res, ath, 201);
      }
      if (method === 'PUT' && parts[1]) {
        const b = await readBody(req);
        const updated = updateRecord('athletes', Number(parts[1]), b);
        return updated ? json(res, updated) : err(res, 'not found', 404);
      }
      if (method === 'DELETE' && parts[1]) {
        deleteRecord('athletes', Number(parts[1]));
        return json(res, { ok: true });
      }
    }

    // ── results ────────────────────────────────────────────────────────────
    if (parts[0] === 'results') {
      if (method === 'GET' && !parts[1]) {
        let results = readDB('results');
        if (url.searchParams.get('eventId')) {
          results = results.filter(r => r.eventId === Number(url.searchParams.get('eventId')));
        }
        if (url.searchParams.get('meetId')) {
          const events = readDB('events').filter(e => e.meetId === Number(url.searchParams.get('meetId')));
          const eids = new Set(events.map(e => e.id));
          results = results.filter(r => eids.has(r.eventId));
        }
        return json(res, results);
      }
      if (method === 'POST') {
        const b = await readBody(req);
        if (!b.eventId) return err(res, 'eventId required');
        const result = insertRecord('results', {
          eventId:      Number(b.eventId),
          round:        Number(b.round) || 1,
          group:        Number(b.group) || 1,
          athleteName:  b.athleteName || '',
          athleteId:    b.athleteId ? Number(b.athleteId) : null,
          number:       b.number || '',
          team:         b.team || '',
          laneIndex:    b.laneIndex ?? null,
          timeMs:       b.timeMs ?? null,
          lapTimes:     b.lapTimes || [],
          rank:         b.rank ?? null,
          qualified:    b.qualified ?? false,
          windSpeed:    b.windSpeed ?? null,
          videoOffset:  b.videoOffset ?? null,
          notes:        b.notes || '',
          recordedAt:   b.recordedAt || Date.now(),
        });
        return json(res, result, 201);
      }
      if (parts[1]) {
        const id = Number(parts[1]);
        if (method === 'PUT') {
          const b = await readBody(req);
          const updated = updateRecord('results', id, b);
          return updated ? json(res, updated) : err(res, 'not found', 404);
        }
        if (method === 'DELETE') {
          deleteRecord('results', id);
          return json(res, { ok: true });
        }
      }
    }

    // ── stats ──────────────────────────────────────────────────────────────
    if (parts[0] === 'stats' && method === 'GET') {
      const meets    = readDB('meets');
      const events   = readDB('events');
      const athletes = readDB('athletes');
      const results  = readDB('results');

      const byEvent = {};
      results.forEach(r => {
        if (!byEvent[r.eventId]) byEvent[r.eventId] = [];
        byEvent[r.eventId].push(r);
      });

      // Best time per event
      const eventBests = events.map(ev => {
        const evResults = (byEvent[ev.id] || []).filter(r => r.timeMs);
        evResults.sort((a, b) => a.timeMs - b.timeMs);
        return {
          eventId: ev.id,
          eventName: ev.name,
          best: evResults[0] || null,
          count: evResults.length,
        };
      });

      // 个人最佳成绩统计
      const athleteStats = {};
      results.forEach(r => {
        if (!r.athleteName || !r.timeMs) return;
        if (!athleteStats[r.athleteName]) {
          athleteStats[r.athleteName] = {
            name: r.athleteName,
            races: 0,
            bestTime: Infinity,
            avgTime: 0,
            totalTime: 0,
            podiums: 0, // 前三名次数
            wins: 0,    // 第一名次数
          };
        }
        const stat = athleteStats[r.athleteName];
        stat.races++;
        stat.totalTime += r.timeMs;
        if (r.timeMs < stat.bestTime) stat.bestTime = r.timeMs;
        if (r.rank === 1) stat.wins++;
        if (r.rank <= 3) stat.podiums++;
      });

      // 计算平均成绩
      Object.values(athleteStats).forEach(stat => {
        stat.avgTime = Math.round(stat.totalTime / stat.races);
        if (stat.bestTime === Infinity) stat.bestTime = null;
      });

      // 最佳运动员排行（按最佳成绩）
      const topAthletes = Object.values(athleteStats)
        .filter(s => s.bestTime !== null)
        .sort((a, b) => a.bestTime - b.bestTime)
        .slice(0, 10);

      // 比赛统计
      const raceStats = {
        totalRaces: results.length,
        completedRaces: results.filter(r => r.timeMs).length,
        avgFinishTime: 0,
      };

      const validTimes = results.filter(r => r.timeMs).map(r => r.timeMs);
      if (validTimes.length > 0) {
        raceStats.avgFinishTime = Math.round(
          validTimes.reduce((a, b) => a + b, 0) / validTimes.length
        );
      }

      // 趋势分析：最近7天的比赛数量
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const recentTrend = [];
      for (let i = 6; i >= 0; i--) {
        const dayStart = now - i * dayMs;
        const dayEnd = dayStart + dayMs;
        const count = results.filter(r =>
          r.recordedAt >= dayStart && r.recordedAt < dayEnd
        ).length;
        recentTrend.push({
          date: new Date(dayStart).toISOString().slice(0, 10),
          count,
        });
      }

      return json(res, {
        totalMeets:    meets.length,
        totalEvents:   events.length,
        totalAthletes: athletes.length,
        totalResults:  results.length,
        eventBests,
        athleteStats: Object.values(athleteStats),
        topAthletes,
        raceStats,
        recentTrend,
      });
    }

    // ── export CSV ─────────────────────────────────────────────────────────
    if (parts[0] === 'export' && parts[1] === 'csv' && method === 'GET') {
      const meetId  = url.searchParams.get('meetId');
      const eventId = url.searchParams.get('eventId');
      const format  = url.searchParams.get('format') || 'standard'; // 'standard' | 'detailed'

      let results = readDB('results');
      let events  = readDB('events');
      const meets = readDB('meets');

      if (eventId) {
        results = results.filter(r => r.eventId === Number(eventId));
        events  = events.filter(e => e.id === Number(eventId));
      } else if (meetId) {
        const eids = new Set(events.filter(e => e.meetId === Number(meetId)).map(e => e.id));
        results = results.filter(r => eids.has(r.eventId));
        events  = events.filter(e => e.meetId === Number(meetId));
      }

      const evMap   = Object.fromEntries(events.map(e => [e.id, e]));
      const meetMap = Object.fromEntries(meets.map(m => [m.id, m]));

      let headers, rows;

      if (format === 'detailed') {
        // 详细格式：包含更多统计信息
        headers = [
          '赛事', '项目', '轮次', '组别', '姓名', '号码', '单位', '道次',
          '时间', '成绩(ms)', '圈次成绩', '排名', '晋级', 'AI置信度', 'AI方法',
          '记录时间', '备注'
        ];
        rows = results.map(r => {
          const ev   = evMap[r.eventId] || {};
          const meet = meetMap[ev.meetId] || {};
          return [
            meet.name || '',
            ev.name || '',
            r.round,
            r.group,
            r.athleteName,
            r.number,
            r.team,
            r.laneIndex != null ? r.laneIndex + 1 : '',
            msToDisplay(r.timeMs),
            r.timeMs ?? '',
            (r.lapTimes || []).map(msToDisplay).join(' | '),
            r.rank ?? '',
            r.qualified ? '是' : '否',
            r.aiConfidence != null ? `${Math.round(r.aiConfidence * 100)}%` : '',
            r.aiMethod || '',
            r.recordedAt ? new Date(r.recordedAt).toISOString() : '',
            r.notes || '',
          ].map(csvEscape);
        });
      } else {
        // 标准格式
        headers = ['赛事', '项目', '轮次', '组别', '姓名', '号码', '单位', '道次', '时间', '成绩(ms)', '圈次成绩', '排名', '晋级', '记录时间'];
        rows = results.map(r => {
          const ev   = evMap[r.eventId] || {};
          const meet = meetMap[ev.meetId] || {};
          return [
            meet.name || '',
            ev.name || '',
            r.round,
            r.group,
            r.athleteName,
            r.number,
            r.team,
            r.laneIndex != null ? r.laneIndex + 1 : '',
            msToDisplay(r.timeMs),
            r.timeMs ?? '',
            (r.lapTimes || []).map(msToDisplay).join(' | '),
            r.rank ?? '',
            r.qualified ? '是' : '否',
            r.recordedAt ? new Date(r.recordedAt).toISOString() : '',
          ].map(csvEscape);
        });
      }

      const bom = '﻿';
      const csv = bom + [headers.map(csvEscape), ...rows].map(r => r.join(',')).join('\r\n');

      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="jingjin-results.csv"',
      });
      return res.end(csv);
    }

    // ── rank/reorder ────────────────────────────────────────────────────────
    if (parts[0] === 'rank' && method === 'POST') {
      const b = await readBody(req);
      const { eventId, round, group } = b;
      if (!eventId) return err(res, 'eventId required');

      const results = readDB('results');
      const filtered = results.filter(r =>
        r.eventId === Number(eventId) &&
        (round == null || r.round === Number(round)) &&
        (group == null || r.group === Number(group)) &&
        r.timeMs != null
      );
      filtered.sort((a, b) => a.timeMs - b.timeMs);
      const ev = findById(readDB('events'), Number(eventId));
      const advanceCount = ev?.advanceCount || 0;

      filtered.forEach((r, i) => {
        updateRecord('results', r.id, {
          rank: i + 1,
          qualified: advanceCount > 0 ? (i < advanceCount) : false,
        });
      });

      return json(res, { ranked: filtered.length });
    }

    err(res, 'not found', 404);
  } catch (e) {
    console.error('[API]', e);
    err(res, 'internal error', 500);
  }
}
