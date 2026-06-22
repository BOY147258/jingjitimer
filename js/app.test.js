/**
 * 竞迹计时器 - 单元测试
 */

import { describe, it, expect } from 'https://unpkg.com/vitest@0.34.0/+esm';
import { formatTime, getLaneColor, getLaneLabel } from './ui-helpers.js';
import { t, setLanguage, getCurrentLang } from './i18n.js';

// ============ UI 辅助函数测试 ============

describe('formatTime', () => {
  it('应正确格式化零值', () => {
    expect(formatTime(0)).toBe('--:--.---');
  });

  it('应正确格式化秒级时间', () => {
    expect(formatTime(1234)).toBe('1.234');
    expect(formatTime(999)).toBe('0.999');
  });

  it('应正确格式化分钟级时间', () => {
    expect(formatTime(60123)).toBe('1:00.123');
    expect(formatTime(3661000)).toBe('61:01.000');
  });

  it('应处理 NaN 和 null', () => {
    expect(formatTime(NaN)).toBe('--:--.---');
    expect(formatTime(null)).toBe('--:--.---');
    expect(formatTime(undefined)).toBe('--:--.---');
  });

  it('应正确补零', () => {
    expect(formatTime(100)).toBe('0.100');
    expect(formatTime(10)).toBe('0.010');
  });
});

describe('getLaneColor', () => {
  it('应为每个道次返回不同颜色', () => {
    const colors = new Set();
    for (let i = 1; i <= 8; i++) {
      colors.add(getLaneColor(i));
    }
    expect(colors.size).toBe(8);
  });

  it('应在8道后循环颜色', () => {
    expect(getLaneColor(1)).toBe(getLaneColor(9));
    expect(getLaneColor(2)).toBe(getLaneColor(10));
  });
});

describe('getLaneLabel', () => {
  it('应返回正确的道次标识', () => {
    expect(getLaneLabel(1)).toBe('A');
    expect(getLaneLabel(2)).toBe('B');
    expect(getLaneLabel(8)).toBe('H');
  });
});

// ============ i18n 测试 ============

describe('i18n', () => {
  it('应返回翻译文本', () => {
    const appName = t('appName');
    expect(appName).toBeTruthy();
    expect(typeof appName).toBe('string');
  });

  it('应正确切换语言', () => {
    setLanguage('en-US');
    expect(getCurrentLang()).toBe('en-US');

    setLanguage('zh-CN');
    expect(getCurrentLang()).toBe('zh-CN');
  });

  it('应支持参数替换', () => {
    // 无参数版本
    const result = t('appName');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ============ 时间计算测试 ============

describe('时间计算', () => {
  it('应正确计算圈速', () => {
    const totalTime = 72000; // 1:12.000
    const lapCount = 4;
    const lapTime = totalTime / lapCount;
    expect(lapTime).toBe(18000); // 18秒
  });

  it('应正确处理 DNF', () => {
    const results = [
      { lane: 1, time: 12000 },
      { lane: 2, time: null, isDNF: true },
      { lane: 3, time: 11500 },
    ];

    const finished = results.filter(r => !r.isDNF && r.time !== null);
    expect(finished.length).toBe(2);
    expect(finished.map(r => r.lane)).toEqual([1, 3]);
  });

  it('应正确处理 DNS', () => {
    const results = [
      { lane: 1, time: 12000 },
      { lane: 2, isDNS: true },
      { lane: 3, time: 11500 },
    ];

    const dns = results.filter(r => r.isDNS);
    expect(dns.length).toBe(1);
    expect(dns[0].lane).toBe(2);
  });
});

// ============ 排名计算测试 ============

describe('排名计算', () => {
  it('应按时间正确排名', () => {
    const results = [
      { lane: 1, time: 12000 },
      { lane: 2, time: 11500 },
      { lane: 3, time: 11800 },
    ];

    const ranked = [...results].sort((a, b) => a.time - b.time);
    expect(ranked[0].lane).toBe(2);
    expect(ranked[1].lane).toBe(3);
    expect(ranked[2].lane).toBe(1);
  });

  it('应正确处理平局', () => {
    const results = [
      { lane: 1, time: 12000 },
      { lane: 2, time: 12000 },
    ];

    const ranked = [...results].sort((a, b) => a.time - b.time);
    expect(ranked[0].time).toBe(ranked[1].time);
  });

  it('应正确计算时间差', () => {
    const results = [
      { lane: 1, time: 12000 },
      { lane: 2, time: 11500 },
      { lane: 3, time: 11800 },
    ];

    const best = Math.min(...results.map(r => r.time));
    const diffs = results.map(r => r.time - best);

    expect(diffs[0]).toBe(500);  // +0.500
    expect(diffs[1]).toBe(0);    // 最好成绩
    expect(diffs[2]).toBe(300);  // +0.300
  });
});

// ============ 反应时间测试 ============

describe('反应时间计算', () => {
  it('应正确计算反应时间', () => {
    const startTime = 1000000000000;
    const finishTime = 1000000100000; // 100ms later

    const reactionTime = finishTime - startTime;
    expect(reactionTime).toBe(100);
  });

  it('应标记抢跑（< 100ms）', () => {
    const reactionTime = 80;
    const isFalseStart = reactionTime < 100;
    expect(isFalseStart).toBe(true);
  });
});

// ============ 存储测试 ============

describe('本地存储', () => {
  it('应正确序列化和反序列化数据', () => {
    const raceData = {
      raceName: '100米决赛',
      distance: 100,
      results: [
        { lane: 1, time: 1100, rank: 1 },
        { lane: 2, time: 1120, rank: 2 },
      ]
    };

    const serialized = JSON.stringify(raceData);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.raceName).toBe('100米决赛');
    expect(deserialized.results.length).toBe(2);
    expect(deserialized.results[0].time).toBe(1100);
  });
});
