// 竞迹 AI 计时系统 — 高级统计分析模块

/**
 * 统计分析器
 * 提供成绩分析、趋势预测、数据可视化等功能
 */
export class StatsAnalyzer {
  constructor() {
    this.results = [];
    this.athletes = new Map();
    this.events = new Map();
  }

  // ── 加载数据 ──────────────────────────────────────────────────────────
  loadData(results, athletes = [], events = []) {
    this.results = results;

    // 构建索引
    athletes.forEach(a => this.athletes.set(a.id, a));
    events.forEach(e => this.events.set(e.id, e));
  }

  // ── 个人成绩分析 ──────────────────────────────────────────────────────
  analyzeAthlete(athleteName) {
    const athleteResults = this.results.filter(r =>
      r.athleteName === athleteName && r.timeMs
    ).sort((a, b) => a.recordedAt - b.recordedAt);

    if (athleteResults.length === 0) return null;

    const times = athleteResults.map(r => r.timeMs);
    const bestTime = Math.min(...times);
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const worstTime = Math.max(...times);

    // 计算标准差（稳定性指标）
    const variance = times.reduce((sum, t) => sum + Math.pow(t - avgTime, 2), 0) / times.length;
    const stdDev = Math.sqrt(variance);
    const consistency = 1 - Math.min(1, stdDev / avgTime); // 0-1，1表示非常稳定

    // 进步趋势（线性回归）
    const trend = this.calculateTrend(
      athleteResults.map((r, i) => i),
      times
    );

    // 排名统计
    const ranks = athleteResults.filter(r => r.rank).map(r => r.rank);
    const avgRank = ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;
    const podiums = ranks.filter(r => r <= 3).length;
    const wins = ranks.filter(r => r === 1).length;

    return {
      name: athleteName,
      totalRaces: athleteResults.length,
      bestTime,
      avgTime: Math.round(avgTime),
      worstTime,
      stdDev: Math.round(stdDev),
      consistency: Math.round(consistency * 100),
      trend: trend.slope < 0 ? 'improving' : trend.slope > 0 ? 'declining' : 'stable',
      trendValue: trend.slope,
      avgRank: avgRank ? Math.round(avgRank * 10) / 10 : null,
      podiums,
      wins,
      winRate: athleteResults.length > 0 ? Math.round(wins / athleteResults.length * 100) : 0,
      recentForm: this.calculateRecentForm(athleteResults.slice(-5)),
      timeline: athleteResults.map(r => ({
        date: r.recordedAt,
        time: r.timeMs,
        rank: r.rank,
        event: this.events.get(r.eventId)?.name || '未知',
      })),
    };
  }

  // ── 计算趋势（线性回归）──────────────────────────────────────────────
  calculateTrend(xValues, yValues) {
    const n = xValues.length;
    if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

    const sumX = xValues.reduce((a, b) => a + b, 0);
    const sumY = yValues.reduce((a, b) => a + b, 0);
    const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
    const sumX2 = xValues.reduce((sum, x) => sum + x * x, 0);
    const sumY2 = yValues.reduce((sum, y) => sum + y * y, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // 计算 R² (拟合优度)
    const yMean = sumY / n;
    const ssTotal = yValues.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
    const ssResidual = yValues.reduce((sum, y, i) => {
      const predicted = slope * xValues[i] + intercept;
      return sum + Math.pow(y - predicted, 2);
    }, 0);
    const r2 = ssTotal > 0 ? 1 - (ssResidual / ssTotal) : 0;

    return { slope, intercept, r2 };
  }

  // ── 计算近期状态 ──────────────────────────────────────────────────────
  calculateRecentForm(recentResults) {
    if (recentResults.length === 0) return 'unknown';

    const times = recentResults.map(r => r.timeMs).filter(t => t);
    if (times.length < 2) return 'insufficient_data';

    const avgRecent = times.reduce((a, b) => a + b, 0) / times.length;
    const allTimes = this.results
      .filter(r => r.athleteName === recentResults[0].athleteName && r.timeMs)
      .map(r => r.timeMs);
    const avgAll = allTimes.reduce((a, b) => a + b, 0) / allTimes.length;

    const improvement = (avgAll - avgRecent) / avgAll;

    if (improvement > 0.05) return 'excellent';   // 提升5%+
    if (improvement > 0.02) return 'good';        // 提升2-5%
    if (improvement > -0.02) return 'stable';     // 波动<2%
    if (improvement > -0.05) return 'declining';  // 下降2-5%
    return 'poor';                                 // 下降5%+
  }

  // ── 团队/班级分析 ──────────────────────────────────────────────────────
  analyzeTeam(teamName) {
    const teamResults = this.results.filter(r => r.team === teamName && r.timeMs);

    if (teamResults.length === 0) return null;

    // 统计运动员
    const athleteSet = new Set(teamResults.map(r => r.athleteName));
    const athletes = Array.from(athleteSet);

    // 计算团队成绩
    const times = teamResults.map(r => r.timeMs);
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const bestTime = Math.min(...times);

    // 奖牌统计
    const medals = {
      gold: teamResults.filter(r => r.rank === 1).length,
      silver: teamResults.filter(r => r.rank === 2).length,
      bronze: teamResults.filter(r => r.rank === 3).length,
    };

    // 前三名运动员
    const athleteStats = athletes.map(name => {
      const athleteData = this.analyzeAthlete(name);
      return athleteData;
    }).filter(Boolean).sort((a, b) => a.bestTime - b.bestTime);

    return {
      name: teamName,
      totalAthletes: athletes.length,
      totalRaces: teamResults.length,
      avgTime: Math.round(avgTime),
      bestTime,
      medals,
      totalMedals: medals.gold + medals.silver + medals.bronze,
      topAthletes: athleteStats.slice(0, 10),
      participationRate: athleteStats.length > 0
        ? Math.round(teamResults.length / athleteStats.length * 10) / 10
        : 0,
    };
  }

  // ── 比赛项目分析 ──────────────────────────────────────────────────────
  analyzeEvent(eventId) {
    const eventResults = this.results.filter(r => r.eventId === eventId && r.timeMs);

    if (eventResults.length === 0) return null;

    const times = eventResults.map(r => r.timeMs);
    const record = Math.min(...times);
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

    // 分布分析（四分位数）
    const sorted = [...times].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const median = sorted[Math.floor(sorted.length * 0.5)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];

    // 记录保持者
    const recordHolder = eventResults.find(r => r.timeMs === record);

    return {
      eventId,
      eventName: this.events.get(eventId)?.name || '未知项目',
      totalRaces: eventResults.length,
      record,
      recordHolder: recordHolder?.athleteName || '未知',
      recordDate: recordHolder?.recordedAt,
      avgTime: Math.round(avgTime),
      median: Math.round(median),
      distribution: { q1, median, q3 },
      competitiveness: this.calculateCompetitiveness(sorted),
    };
  }

  // ── 计算竞争激烈程度 ──────────────────────────────────────────────────
  calculateCompetitiveness(sortedTimes) {
    if (sortedTimes.length < 3) return 'low';

    const top3 = sortedTimes.slice(0, 3);
    const gap = top3[2] - top3[0];
    const avgTime = sortedTimes.reduce((a, b) => a + b, 0) / sortedTimes.length;
    const gapPercent = gap / avgTime;

    if (gapPercent < 0.02) return 'very_high';  // 差距<2%
    if (gapPercent < 0.05) return 'high';       // 差距2-5%
    if (gapPercent < 0.10) return 'moderate';   // 差距5-10%
    return 'low';                               // 差距>10%
  }

  // ── 预测成绩（基于历史趋势）──────────────────────────────────────────
  predictPerformance(athleteName, racesAhead = 1) {
    const athleteResults = this.results
      .filter(r => r.athleteName === athleteName && r.timeMs)
      .sort((a, b) => a.recordedAt - b.recordedAt);

    if (athleteResults.length < 3) {
      return { prediction: null, confidence: 0, reason: 'insufficient_data' };
    }

    const times = athleteResults.map(r => r.timeMs);
    const xValues = athleteResults.map((_, i) => i);
    const trend = this.calculateTrend(xValues, times);

    // 预测未来成绩
    const nextX = athleteResults.length + racesAhead - 1;
    const prediction = Math.round(trend.slope * nextX + trend.intercept);

    // 置信度基于R²和数据量
    const dataFactor = Math.min(1, athleteResults.length / 10);
    const confidence = Math.round(trend.r2 * dataFactor * 100);

    return {
      prediction,
      confidence,
      trend: trend.slope < 0 ? 'improving' : 'declining',
      basedOnRaces: athleteResults.length,
      trendStrength: Math.abs(trend.slope),
    };
  }

  // ── 对比两名运动员 ────────────────────────────────────────────────────
  compareAthletes(name1, name2) {
    const athlete1 = this.analyzeAthlete(name1);
    const athlete2 = this.analyzeAthlete(name2);

    if (!athlete1 || !athlete2) return null;

    return {
      athlete1: name1,
      athlete2: name2,
      comparison: {
        bestTime: {
          winner: athlete1.bestTime < athlete2.bestTime ? name1 : name2,
          diff: Math.abs(athlete1.bestTime - athlete2.bestTime),
        },
        avgTime: {
          winner: athlete1.avgTime < athlete2.avgTime ? name1 : name2,
          diff: Math.abs(athlete1.avgTime - athlete2.avgTime),
        },
        consistency: {
          winner: athlete1.consistency > athlete2.consistency ? name1 : name2,
          diff: Math.abs(athlete1.consistency - athlete2.consistency),
        },
        wins: {
          winner: athlete1.wins > athlete2.wins ? name1 : name2,
          diff: Math.abs(athlete1.wins - athlete2.wins),
        },
      },
      headToHead: this.analyzeHeadToHead(name1, name2),
    };
  }

  // ── 直接对抗分析 ──────────────────────────────────────────────────────
  analyzeHeadToHead(name1, name2) {
    // 找出两人同场竞技的比赛
    const athlete1Results = this.results.filter(r => r.athleteName === name1);
    const athlete2Results = this.results.filter(r => r.athleteName === name2);

    const commonRaces = [];
    athlete1Results.forEach(r1 => {
      const r2 = athlete2Results.find(r =>
        r.eventId === r1.eventId &&
        r.round === r1.round &&
        r.group === r1.group
      );
      if (r2) {
        commonRaces.push({
          event: this.events.get(r1.eventId)?.name || '未知',
          date: r1.recordedAt,
          [name1]: { time: r1.timeMs, rank: r1.rank },
          [name2]: { time: r2.timeMs, rank: r2.rank },
          winner: r1.timeMs < r2.timeMs ? name1 : name2,
        });
      }
    });

    const wins1 = commonRaces.filter(r => r.winner === name1).length;
    const wins2 = commonRaces.filter(r => r.winner === name2).length;

    return {
      totalMeetings: commonRaces.length,
      wins: { [name1]: wins1, [name2]: wins2 },
      races: commonRaces,
    };
  }

  // ── 生成排行榜 ────────────────────────────────────────────────────────
  generateLeaderboard(criteria = 'bestTime', limit = 10) {
    const athleteNames = [...new Set(this.results.map(r => r.athleteName))];
    const leaderboard = athleteNames
      .map(name => this.analyzeAthlete(name))
      .filter(Boolean);

    // 根据标准排序
    switch (criteria) {
      case 'bestTime':
        leaderboard.sort((a, b) => a.bestTime - b.bestTime);
        break;
      case 'avgTime':
        leaderboard.sort((a, b) => a.avgTime - b.avgTime);
        break;
      case 'wins':
        leaderboard.sort((a, b) => b.wins - a.wins);
        break;
      case 'consistency':
        leaderboard.sort((a, b) => b.consistency - a.consistency);
        break;
      case 'improvement':
        leaderboard.sort((a, b) => a.trendValue - b.trendValue); // 负值=进步
        break;
      default:
        leaderboard.sort((a, b) => a.bestTime - b.bestTime);
    }

    return leaderboard.slice(0, limit);
  }
}

// ── 导出工具函数 ────────────────────────────────────────────────────────
export function formatTime(ms) {
  if (!ms && ms !== 0) return '--:--.--';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function getFormColor(form) {
  const colors = {
    excellent: '#00e676',
    good: '#76ff03',
    stable: '#ffd600',
    declining: '#ff9100',
    poor: '#ff1744',
  };
  return colors[form] || '#666';
}

export function getFormLabel(form) {
  const labels = {
    excellent: '状态极佳',
    good: '状态良好',
    stable: '状态稳定',
    declining: '状态下滑',
    poor: '状态不佳',
    unknown: '未知',
    insufficient_data: '数据不足',
  };
  return labels[form] || '未知';
}
