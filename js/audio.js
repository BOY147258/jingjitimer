/**
 * AudioDetector - 音频检测器 V2.0
 *
 * 优化：
 * 1. 改进声音阈值算法，更灵敏
 * 2. 支持频率分析，区分不同声音类型
 * 3. 增加噪声过滤
 * 4. 更快的声音检测响应
 */

export class AudioDetector {
  constructor() {
    this._ctx = null;
    this._analyser = null;
    this._source = null;
    this._running = false;
    this._cooldown = false;
    this._threshold = 0.6; // 降低阈值，提高灵敏度
    this._peakThreshold = 0.75; // 峰值检测阈值
    this._onDetect = null;
    this._onLevel = null;
    this._data = null;
    this._freqData = null;
    this.ready = false;
    this._lastPeakTime = 0;
    this._peakHistory = [];
    this._noiseFloor = 0.1; // 噪声基底
  }

  get threshold() { return this._threshold; }
  set threshold(v) { this._threshold = Math.max(0.01, Math.min(0.99, v)); }

  async initFromStream(stream) {
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._analyser = this._ctx.createAnalyser();
      this._analyser.fftSize = 512;
      this._analyser.smoothingTimeConstant = 0.3; // 降低平滑度，提高响应速度

      // 添加噪声门
      this._noiseGate = this._ctx.createGain();
      this._noiseGate.gain.value = 1;

      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) throw new Error('No audio track');

      const audioOnly = new MediaStream([audioTracks[0]]);
      this._source = this._ctx.createMediaStreamSource(audioOnly);
      this._source.connect(this._analyser);

      this._data = new Uint8Array(this._analyser.frequencyBinCount);
      this._freqData = new Uint8Array(this._analyser.frequencyBinCount);

      // 初始化噪声基底
      this._calibrateNoiseFloor();

      this.ready = true;
    } catch (e) {
      console.error('AudioDetector init error:', e);
      this.ready = false;
    }
  }

  // 校准噪声基底
  _calibrateNoiseFloor() {
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      const s = this.sample();
      if (s) sum += s.level;
    }
    this._noiseFloor = Math.max(0.05, sum / 10);
  }

  /* 返回 { level: 0-1, waveform: Uint8Array, isGunshot: boolean } */
  sample() {
    if (!this._analyser) return null;

    this._analyser.getByteTimeDomainData(this._data);
    this._analyser.getByteFrequencyData(this._freqData);

    // 计算峰值
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < this._data.length; i++) {
      const v = Math.abs(this._data[i] - 128) / 128;
      sum += v;
      if (v > peak) peak = v;
    }

    // 减去噪声基底
    const adjustedPeak = Math.max(0, peak - this._noiseFloor * 0.5);
    const avg = sum / this._data.length;

    // 检测是否是枪声特征（低频能量高，瞬态）
    const isGunshot = this._detectGunshotFeature();

    return {
      level: adjustedPeak,
      avgLevel: avg,
      waveform: this._data,
      isGunshot: isGunshot
    };
  }

  // 检测枪声特征
  _detectGunshotFeature() {
    // 枪声特征：低频能量集中，瞬态响应
    const now = performance.now();
    let lowFreqSum = 0;
    let highFreqSum = 0;

    // 低频段 (0-500Hz)
    const lowEnd = Math.floor(500 / (this._ctx.sampleRate / this._analyser.fftSize));
    for (let i = 0; i < lowEnd && i < this._freqData.length; i++) {
      lowFreqSum += this._freqData[i];
    }

    // 高频段 (2000Hz+)
    const highStart = Math.floor(2000 / (this._ctx.sampleRate / this._analyser.fftSize));
    for (let i = highStart; i < this._freqData.length; i++) {
      highFreqSum += this._freqData[i];
    }

    // 低频能量显著高于高频 → 可能是枪声
    const ratio = lowFreqSum / Math.max(1, highFreqSum);

    // 检测是否是瞬态（峰值突然变化）
    const currentPeak = this._freqData[0] / 255;
    this._peakHistory.push(currentPeak);
    if (this._peakHistory.length > 5) this._peakHistory.shift();

    let isTransient = false;
    if (this._peakHistory.length >= 2) {
      const prev = this._peakHistory[this._peakHistory.length - 2];
      isTransient = currentPeak > prev * 2 && currentPeak > 0.5;
    }

    return ratio > 2 && isTransient;
  }

  startMonitor(onDetect, onLevel) {
    this._onDetect = onDetect;
    this._onLevel = onLevel;
    this._running = true;
    this._loop();
  }

  stopMonitor() {
    this._running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _loop() {
    if (!this._running) return;

    const s = this.sample();
    if (s) {
      this._onLevel?.(s.level, s.waveform);

      // 双重检测：普通阈值 + 枪声特征检测
      const shouldTrigger = s.level >= this._threshold ||
        (s.isGunshot && s.level >= this._threshold * 0.7);

      if (shouldTrigger && !this._cooldown) {
        this._cooldown = true;
        this._onDetect?.();

        // 根据触发类型调整冷却时间
        const cooldownMs = s.isGunshot ? 2000 : 2500;
        setTimeout(() => { this._cooldown = false; }, cooldownMs);
      }
    }

    this._rafId = requestAnimationFrame(() => this._loop());
  }

  resume() {
    if (this._ctx?.state === 'suspended') this._ctx.resume();
  }

  // 重新校准噪声基底
  recalibrate() {
    this._calibrateNoiseFloor();
  }

  destroy() {
    this.stopMonitor();
    if (this._ctx) {
      this._ctx.close();
      this._ctx = null;
    }
    this.ready = false;
  }
}