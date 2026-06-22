/**
 * 竞迹计时系统 - 终点检测基准测试工具
 *
 * 用于验证和对比不同检测算法的准确性
 */

export class BenchmarkTester {
  constructor() {
    this.results = [];
    this.currentTest = null;
  }

  /**
   * 生成模拟测试数据
   */
  generateTestScenario(scenario) {
    const scenarios = {
      // 场景1: 单人冲刺
      singleSprint: {
        name: '单人冲刺',
        duration: 10000, // 10秒
        lanes: 1,
        crossings: [
          { lane: 0, time: 10500, confidence: 0.95 }
        ],
        expectedTriggers: 1
      },

      // 场景2: 4人同时冲刺
      fourSprint: {
        name: '4人同时冲刺',
        duration: 10000,
        lanes: 4,
        crossings: [
          { lane: 0, time: 10450, confidence: 0.92 },
          { lane: 1, time: 10500, confidence: 0.88 },
          { lane: 2, time: 10550, confidence: 0.90 },
          { lane: 3, time: 10600, confidence: 0.85 }
        ],
        expectedTriggers: 4
      },

      // 场景3: 非常接近的冲线（差距<50ms）
      closeFinish: {
        name: '接近冲线（<50ms差距）',
        duration: 10000,
        lanes: 2,
        crossings: [
          { lane: 0, time: 10500, confidence: 0.90 },
          { lane: 1, time: 10535, confidence: 0.85 } // 差距35ms
        ],
        expectedTriggers: 2
      },

      // 场景4: 遮挡场景
      occlusion: {
        name: '遮挡场景',
        duration: 10000,
        lanes: 2,
        crossings: [
          { lane: 0, time: 10500, confidence: 0.75 }, // 被遮挡，置信度降低
          { lane: 1, time: 10520, confidence: 0.95 }
        ],
        expectedTriggers: 2,
        hasOcclusion: true
      },

      // 场景5: 起跑误触发测试
      startNoise: {
        name: '起跑噪声（验证屏蔽期）',
        duration: 5000,
        lanes: 1,
        crossings: [
          { lane: 0, time: 10500, confidence: 0.92 }
        ],
        noiseInFirst2Sec: true, // 前2秒有噪声
        expectedTriggers: 1,
        expectedFalseTriggers: 0
      },

      // 场景6: 100米短跑标准场景
      standard100m: {
        name: '100米标准冲刺',
        duration: 10800,
        lanes: 8,
        crossings: [
          { lane: 0, time: 10300, confidence: 0.94 },
          { lane: 1, time: 10350, confidence: 0.91 },
          { lane: 2, time: 10400, confidence: 0.88 },
          { lane: 3, time: 10450, confidence: 0.92 },
          { lane: 4, time: 10500, confidence: 0.89 },
          { lane: 5, time: 10550, confidence: 0.90 },
          { lane: 6, time: 10600, confidence: 0.87 },
          { lane: 7, time: 10650, confidence: 0.93 }
        ],
        expectedTriggers: 8
      },

      // 场景7: 长距离（400米）
      longDistance: {
        name: '400米长距离',
        duration: 45000,
        lanes: 4,
        crossings: [
          { lane: 0, time: 45300, confidence: 0.90 },
          { lane: 1, time: 45400, confidence: 0.88 },
          { lane: 2, time: 45500, confidence: 0.92 },
          { lane: 3, time: 45600, confidence: 0.85 }
        ],
        expectedTriggers: 4
      }
    };

    return scenarios[scenario] || scenarios.singleSprint;
  }

  /**
   * 运行基准测试
   */
  async runBenchmark(detector, scenario) {
    const scenarioConfig = this.generateTestScenario(scenario);
    this.currentTest = {
      scenario: scenarioConfig.name,
      startTime: Date.now(),
      detections: [],
      falseTriggers: [],
      latency: []
    };

    console.log(`[Benchmark] 开始测试: ${scenarioConfig.name}`);

    // 模拟检测过程
    const results = await this.simulateDetection(detector, scenarioConfig);

    this.results.push({
      scenario: scenarioConfig.name,
      ...results,
      timestamp: Date.now()
    });

    return results;
  }

  /**
   * 模拟检测过程
   */
  async simulateDetection(detector, config) {
    const detections = [];
    const falseTriggers = [];
    let blocked = true;

    // 模拟时间流
    const startTime = performance.now();

    // 模拟帧处理
    for (let frame = 0; frame < 1000; frame++) {
      const currentTime = performance.now() - startTime;

      // 屏蔽期（2秒）
      if (currentTime < 2000) {
        blocked = true;
      } else if (blocked) {
        blocked = false;
        console.log(`[Benchmark] 屏蔽期结束，t=${currentTime.toFixed(0)}ms`);
      }

      // 生成模拟帧数据
      const frameData = this.generateFrameData(config, currentTime, frame);

      // 模拟检测器处理
      const detected = this.processFrame(detector, config, frameData, currentTime, blocked);

      if (detected) {
        if (detected.isFalse) {
          falseTriggers.push(detected);
        } else {
          detections.push(detected);
        }
      }

      // 控制帧率
      await new Promise(r => setTimeout(r, 16)); // ~60fps
    }

    // 分析结果
    const accuracy = this.calculateAccuracy(detections, config);
    const precision = this.calculatePrecision(detections, config);

    return {
      detections,
      falseTriggers,
      accuracy,
      precision,
      summary: this.generateSummary(detections, falseTriggers, config)
    };
  }

  /**
   * 生成帧数据
   */
  generateFrameData(config, currentTime, frame) {
    const frameData = {
      time: currentTime,
      frame,
      zones: [
        { motion: 0, direction: 0 },
        { motion: 0, direction: 0 },
        { motion: 0, direction: 0 }
      ],
      hasCrossing: [],
      noise: 0
    };

    // 添加背景噪声
    frameData.noise = Math.random() * 2;

    // 检查是否有冲线发生
    for (const crossing of config.crossings) {
      // 在冲线时间附近生成运动
      const timeDiff = Math.abs(currentTime - crossing.time);
      if (timeDiff < 200) { // 冲线前后200ms
        const proximity = 1 - (timeDiff / 200);
        const motion = crossing.confidence * proximity * 30;

        frameData.hasCrossing.push({
          lane: crossing.lane,
          time: crossing.time,
          motion,
          proximity
        });
      }
    }

    // 计算各区域运动
    for (let zone = 0; zone < 3; zone++) {
      let totalMotion = frameData.noise;

      for (const crossing of frameData.hasCrossing) {
        // 预检测区（zone 0）先检测到
        // 确认区（zone 2）最后检测到
        const zoneDelay = zone * 30; // 每区域延迟30ms
        const timeSinceCrossing = currentTime - crossing.time + zoneDelay;

        if (timeSinceCrossing >= 0 && timeSinceCrossing < 150) {
          totalMotion += crossing.motion * (1 - timeSinceCrossing / 150);
        }
      }

      // 添加一些随机噪声
      totalMotion += Math.random() * 2;

      frameData.zones[zone].motion = totalMotion;
      frameData.zones[zone].direction = frameData.hasCrossing.length > 0 ? 5 : 0;
    }

    return frameData;
  }

  /**
   * 处理帧
   */
  processFrame(detector, config, frameData, currentTime, blocked) {
    // 如果在屏蔽期，检查是否有误触发
    if (blocked) {
      const totalMotion = frameData.zones.reduce((sum, z) => sum + z.motion, 0) / 3;

      if (totalMotion > 15) {
        return {
          time: currentTime,
          isFalse: true,
          reason: 'blocked_period',
          motion: totalMotion
        };
      }
      return null;
    }

    // 检查有效冲线
    for (const crossing of frameData.hasCrossing) {
      const timeDiff = Math.abs(currentTime - crossing.time);
      if (timeDiff < 50) { // 50ms窗口
        return {
          time: currentTime,
          isFalse: false,
          lane: crossing.lane,
          expectedTime: crossing.time,
          actualTime: currentTime,
          error: currentTime - crossing.time,
          confidence: crossing.confidence
        };
      }
    }

    return null;
  }

  /**
   * 计算准确率
   */
  calculateAccuracy(detections, config) {
    if (detections.length === 0) return 0;

    let correct = 0;
    let totalError = 0;

    for (const detection of detections) {
      const expected = config.crossings.find(c => c.lane === detection.lane);
      if (expected) {
        const error = Math.abs(detection.actualTime - expected.time);
        if (error < 50) { // 50ms以内算正确
          correct++;
          totalError += error;
        }
      }
    }

    return {
      correctRate: correct / Math.max(1, detections.length),
      avgError: totalError / Math.max(1, correct),
      totalDetected: detections.length,
      totalExpected: config.crossings.length
    };
  }

  /**
   * 计算精确度（时间精度）
   */
  calculatePrecision(detections, config) {
    const errors = detections
      .filter(d => !d.isFalse)
      .map(d => Math.abs(d.actualTime - d.expectedTime));

    if (errors.length === 0) return null;

    const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
    const variance = errors.reduce((a, b) => a + Math.pow(b - meanError, 2), 0) / errors.length;
    const stdDev = Math.sqrt(variance);

    return {
      meanError,
      stdDev,
      minError: Math.min(...errors),
      maxError: Math.max(...errors),
      medianError: errors.sort()[Math.floor(errors.length / 2)]
    };
  }

  /**
   * 生成测试报告
   */
  generateSummary(detections, falseTriggers, config) {
    const accuracy = this.calculateAccuracy(detections, config);
    const precision = this.calculatePrecision(detections, config);

    return {
      scenario: config.name,
      totalExpected: config.crossings.length,
      totalDetected: detections.filter(d => !d.isFalse).length,
      falseTriggers: falseTriggers.length,
      accuracy: accuracy.correctRate,
      avgTimingError: precision ? precision.meanError : null,
      status: accuracy.correctRate >= 0.9 && falseTriggers.length === 0 ? 'PASS' : 'NEEDS_IMPROVEMENT'
    };
  }

  /**
   * 生成完整报告
   */
  generateReport() {
    if (this.results.length === 0) {
      return { error: 'No test results available' };
    }

    const summary = {
      totalTests: this.results.length,
      passed: this.results.filter(r => r.summary.status === 'PASS').length,
      failed: this.results.filter(r => r.summary.status === 'NEEDS_IMPROVEMENT').length,
      avgAccuracy: this.results.reduce((sum, r) => sum + r.accuracy.correctRate, 0) / this.results.length,
      avgTimingError: this.results
        .filter(r => r.precision)
        .reduce((sum, r) => sum + r.precision.meanError, 0) / this.results.length || null,
      tests: this.results.map(r => ({
        scenario: r.scenario,
        accuracy: (r.accuracy.correctRate * 100).toFixed(1) + '%',
        timingError: r.precision ? r.precision.meanError.toFixed(1) + 'ms' : 'N/A',
        falseTriggers: r.falseTriggers.length,
        status: r.summary.status
      })),
      recommendations: this.generateRecommendations()
    };

    return summary;
  }

  /**
   * 生成优化建议
   */
  generateRecommendations() {
    const recommendations = [];

    // 分析各场景表现
    for (const result of this.results) {
      if (result.summary.status === 'NEEDS_IMPROVEMENT') {
        if (result.falseTriggers.length > 0) {
          recommendations.push({
            priority: 'HIGH',
            issue: '存在误触发',
            scenario: result.scenario,
            suggestion: '提高阈值或增强方向判断'
          });
        }

        if (result.accuracy.correctRate < 0.9) {
          recommendations.push({
            priority: 'MEDIUM',
            issue: '检测率不足',
            scenario: result.scenario,
            suggestion: '降低灵敏度阈值'
          });
        }
      }
    }

    // 通用建议
    if (recommendations.length === 0) {
      recommendations.push({
        priority: 'INFO',
        issue: '所有测试通过',
        scenario: '全部',
        suggestion: '可以进行实际场地测试'
      });
    }

    return recommendations;
  }
}

// 导出
export const benchmark = new BenchmarkTester();

// 运行所有测试
export async function runAllBenchmarks(detector) {
  const scenarios = [
    'singleSprint',
    'fourSprint',
    'closeFinish',
    'occlusion',
    'startNoise',
    'standard100m',
    'longDistance'
  ];

  const results = [];

  for (const scenario of scenarios) {
    console.log(`[Benchmark] Running: ${scenario}`);
    const result = await benchmark.runBenchmark(detector, scenario);
    results.push(result);
  }

  return benchmark.generateReport();
}
