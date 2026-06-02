// 竞迹 AI 计时系统 — 比赛状态机
// 定义标准的比赛流程状态和转换规则

// ── 状态定义 ────────────────────────────────────────────────────────────────
export const RaceState = {
  IDLE: 'IDLE',                     // 空闲：等待开始新枪次
  READY: 'READY',                   // 准备：已创建枪次，等待进入各就位
  ON_YOUR_MARKS: 'ON_YOUR_MARKS',   // 各就位：运动员准备
  SET: 'SET',                       // 预备：ready position
  SCHEDULED: 'SCHEDULED',           // 已预约：定时发令（startAt 已设置）
  RUNNING: 'RUNNING',               // 进行中：计时中
  REVIEW: 'REVIEW',                 // 复核：AI 识别完成，等待人工确认
  PUBLISHED: 'PUBLISHED',           // 已发布：成绩确认并公示
  ABORTED: 'ABORTED',               // 已召回：需要重跑
};

// ── 状态转换规则 ────────────────────────────────────────────────────────────
export const StateTransitions = {
  [RaceState.IDLE]: [RaceState.READY],
  [RaceState.READY]: [RaceState.ON_YOUR_MARKS, RaceState.IDLE],
  [RaceState.ON_YOUR_MARKS]: [RaceState.SET, RaceState.ABORTED, RaceState.READY],
  [RaceState.SET]: [RaceState.SCHEDULED, RaceState.ABORTED, RaceState.ON_YOUR_MARKS],
  [RaceState.SCHEDULED]: [RaceState.RUNNING, RaceState.ABORTED],
  [RaceState.RUNNING]: [RaceState.REVIEW, RaceState.ABORTED],
  [RaceState.REVIEW]: [RaceState.PUBLISHED, RaceState.ABORTED, RaceState.RUNNING],
  [RaceState.PUBLISHED]: [RaceState.IDLE],
  [RaceState.ABORTED]: [RaceState.IDLE],
};

// ── 验证状态转换 ────────────────────────────────────────────────────────────
export function canTransition(from, to) {
  const allowed = StateTransitions[from] || [];
  return allowed.includes(to);
}

export function validateTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid state transition: ${from} → ${to}`);
  }
}

// ── 枪次（Shot）数据结构 ────────────────────────────────────────────────────
/**
 * Shot（枪次）表示一次完整的发令-计时-成绩记录过程
 *
 * @typedef {Object} Shot
 * @property {number} id - 枪次 ID
 * @property {string} roomCode - 房间号
 * @property {number} eventId - 项目 ID（可选，关联到 events 表）
 * @property {number} round - 轮次（预赛/半决赛/决赛）
 * @property {number} group - 组别（第几组）
 * @property {string} eventName - 项目名称（如：男子100米预赛第1组）
 * @property {number} laneCount - 道次数量（默认 8）
 * @property {string} state - 当前状态（RaceState）
 * @property {number} scheduledStartAt - 预约发令时间（Unix 时间戳）
 * @property {number} actualStartAt - 实际发令时间（Unix 时间戳）
 * @property {number} createdAt - 创建时间
 * @property {number} updatedAt - 更新时间
 * @property {Array<LaneResult>} lanes - 各道次成绩
 * @property {Object} metadata - 元数据（风速、温度等）
 */

/**
 * LaneResult（道次成绩）
 *
 * @typedef {Object} LaneResult
 * @property {number} lane - 道次（0-7）
 * @property {string} athleteName - 运动员姓名
 * @property {string} athleteNumber - 号码布
 * @property {string} team - 单位/班级
 * @property {number} finishTimeMs - 终点时间（相对于 actualStartAt 的毫秒数）
 * @property {number} aiConfidence - AI 识别置信度（0-1）
 * @property {boolean} needsReview - 是否需要人工复核
 * @property {string} aiMethod - AI 识别方法（'video' | 'manual' | 'sensor'）
 * @property {number} rank - 排名
 * @property {string} notes - 备注
 */

// ── 创建新枪次 ──────────────────────────────────────────────────────────────
export function createShot(params) {
  const {
    roomCode,
    eventId = null,
    round = 1,
    group = 1,
    eventName = '',
    laneCount = 8,
  } = params;

  return {
    roomCode,
    eventId,
    round,
    group,
    eventName,
    laneCount,
    state: RaceState.IDLE,
    scheduledStartAt: null,
    actualStartAt: null,
    lanes: Array.from({ length: laneCount }, (_, i) => ({
      lane: i,
      athleteName: '',
      athleteNumber: '',
      team: '',
      finishTimeMs: null,
      aiConfidence: 0,
      needsReview: false,
      aiMethod: 'manual',
      rank: null,
      notes: '',
    })),
    metadata: {
      windSpeed: null,
      temperature: null,
      humidity: null,
    },
  };
}

// ── 状态转换辅助函数 ────────────────────────────────────────────────────────
export function transitionTo(shot, newState) {
  validateTransition(shot.state, newState);
  return {
    ...shot,
    state: newState,
    updatedAt: Date.now(),
  };
}

// ── 自动排名 ────────────────────────────────────────────────────────────────
export function rankLanes(lanes) {
  const withTime = lanes
    .map((lane, idx) => ({ ...lane, originalIndex: idx }))
    .filter(lane => lane.finishTimeMs != null && lane.finishTimeMs > 0);

  withTime.sort((a, b) => a.finishTimeMs - b.finishTimeMs);

  const ranked = lanes.map(lane => ({ ...lane }));
  withTime.forEach((lane, idx) => {
    ranked[lane.originalIndex].rank = idx + 1;
  });

  return ranked;
}

// ── 检查是否需要复核 ────────────────────────────────────────────────────────
export function checkNeedsReview(lanes) {
  return lanes.some(lane =>
    lane.finishTimeMs != null &&
    (lane.aiConfidence < 0.85 || lane.needsReview)
  );
}

// ── 格式化时间显示 ──────────────────────────────────────────────────────────
export function formatTime(ms) {
  if (!ms && ms !== 0) return '--:--.--';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const c = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

// ── 状态显示名称 ────────────────────────────────────────────────────────────
export const StateDisplayNames = {
  [RaceState.IDLE]: '空闲',
  [RaceState.READY]: '准备',
  [RaceState.ON_YOUR_MARKS]: '各就位',
  [RaceState.SET]: '预备',
  [RaceState.SCHEDULED]: '待发令',
  [RaceState.RUNNING]: '计时中',
  [RaceState.REVIEW]: '复核中',
  [RaceState.PUBLISHED]: '已发布',
  [RaceState.ABORTED]: '已召回',
};
