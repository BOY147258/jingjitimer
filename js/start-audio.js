// 竞迹计时系统 - 发令音频管理器 V3.0
// 功能：国际田联标准发令音频序列、Web Audio API 合成、多种发令模式

/**
 * 国际田联标准发令程序
 * ┌─────────────────────────────────────────────────────────────┐
 * │  阶段          │  英文              │  时长    │  音频特点  │
 * ├─────────────────────────────────────────────────────────────┤
 * │  1. 各就位     │  On your marks     │  1.5-2s  │  低沉稳定  │
 * │  2. 预备       │  Set              │  1-1.5s  │  略高      │
 * │  3. 枪声       │  (Bang)           │  即时    │  爆裂声    │
 * │  4. 召回       │  (Recall/Abort)   │  必要时  │  哨声     │
 * └─────────────────────────────────────────────────────────────┘
 */

export class StartAudioManager {
  constructor() {
    this._ctx = null;
    this._gainNode = null;
    this._masterGain = null;
    this._initialized = false;

    // 音频参数
    this._volume = 1.0;
    this._currentSound = null;

    // 预加载的音频缓存
    this._audioCache = new Map();

    // 发令序列配置
    this._sequenceConfig = {
      onYourMarks: { duration: 1800, freq: 180, type: 'sine' },
      set: { duration: 1200, freq: 220, type: 'sine' },
      gunshot: { duration: 300, freq: 150, type: 'noise' },
      recall: { duration: 800, freq: 800, type: 'whistle' },
    };
  }

  /**
   * 初始化 Web Audio API
   */
  async init() {
    if (this._initialized) return;

    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive',
        sampleRate: 48000,
      });

      // 创建主增益节点
      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.value = this._volume;
      this._masterGain.connect(this._ctx.destination);

      // 创建分析器（用于可视化）
      this._analyser = this._ctx.createAnalyser();
      this._analyser.fftSize = 256;
      this._masterGain.connect(this._analyser);

      this._initialized = true;
      console.log('[Audio] Web Audio API 初始化成功');

      // 预生成常用音频
      await this._preGenerateSounds();
    } catch (e) {
      console.error('[Audio] 初始化失败:', e);
      throw e;
    }
  }

  /**
   * 预生成音频到缓存
   */
  async _preGenerateSounds() {
    // 预生成各种音频
    const sounds = ['onYourMarks', 'set', 'gunshot', 'beep', 'recall'];
    for (const sound of sounds) {
      const buffer = await this._generateSound(sound);
      this._audioCache.set(sound, buffer);
    }
  }

  /**
   * 设置音量 (0-1)
   */
  setVolume(volume) {
    this._volume = Math.max(0, Math.min(1, volume));
    if (this._masterGain) {
      this._masterGain.gain.value = this._volume;
    }
  }

  /**
   * 获取音量
   */
  getVolume() {
    return this._volume;
  }

  /**
   * 暂停/恢复（用于页面切换时）
   */
  suspend() {
    if (this._ctx?.state === 'running') {
      this._ctx.suspend();
    }
  }

  resume() {
    if (this._ctx?.state === 'suspended') {
      this._ctx.resume();
    }
  }

  /**
   * 播放"各就位" (On Your Marks)
   */
  async playOnYourMarks() {
    await this._playSound('onYourMarks');
  }

  /**
   * 播放"预备" (Set)
   */
  async playSet() {
    await this._playSound('set');
  }

  /**
   * 播放枪声 (Gunshot)
   * 这是最关键的声音，需要非常精确
   */
  async playGunshot() {
    return this._playSound('gunshot');
  }

  /**
   * 播放召回哨声 (Recall)
   */
  async playRecall() {
    await this._playSound('recall');
  }

  /**
   * 播放短促提示音
   */
  async playBeep(duration = 100, freq = 880) {
    return this._generateAndPlay({
      type: 'beep',
      duration,
      freq,
    });
  }

  /**
   * 播放错误提示音
   */
  async playError() {
    await this._generateAndPlay({
      type: 'error',
      duration: 300,
      freq: 200,
    });
  }

  /**
   * 执行完整的发令序列
   * @param {Object} options 配置选项
   * @param {number} options.onYourMarksDelay 各就位后的延迟
   * @param {number} options.setDelay 预备后的延迟
   * @param {boolean} options.autoFire 是否自动发令
   * @returns {Promise<{gunTime: number}>} 返回枪响的精确时间
   */
  async executeStartSequence(options = {}) {
    const {
      onYourMarksDelay = 1800,
      setDelay = 1200,
      autoFire = true,
    } = options;

    if (!this._initialized) await this.init();

    const timing = {
      sequenceStart: this._ctx.currentTime,
      onYourMarksTime: null,
      setTime: null,
      gunTime: null,
    };

    // 确保 AudioContext 正在运行
    await this.resume();

    // 1. 播放"各就位"
    timing.onYourMarksTime = this._ctx.currentTime;
    await this.playOnYourMarks();

    // 2. 等待后播放"预备"
    await this._delay(onYourMarksDelay);
    timing.setTime = this._ctx.currentTime;
    await this.playSet();

    if (autoFire) {
      // 3. 等待后发令枪响
      await this._delay(setDelay);
      timing.gunTime = this._ctx.currentTime;
      await this.playGunshot();

      // 返回精确的枪响时间（performance.now()）
      return {
        gunTime: performance.now(),
        audioCtxTime: timing.gunTime,
        sequenceTiming: timing,
      };
    } else {
      // 手动模式：等待外部触发发令
      return {
        gunTime: null,
        audioCtxTime: null,
        sequenceTiming: timing,
        readyForFire: true,
      };
    }
  }

  /**
   * 在"预备"后手动触发枪响
   */
  async fireNow() {
    return this._playSound('gunshot').then(() => ({
      gunTime: performance.now(),
      audioCtxTime: this._ctx.currentTime,
    }));
  }

  /**
   * 生成并播放声音
   */
  async _generateAndPlay(params) {
    if (!this._initialized) await this.init();
    await this.resume();

    const buffer = this._generateSoundBuffer(params);
    const source = this._ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this._masterGain);

    return new Promise((resolve) => {
      source.start();
      source.onended = resolve;
    });
  }

  /**
   * 从缓存播放声音
   */
  async _playSound(name) {
    if (!this._initialized) await this.init();
    await this.resume();

    const buffer = this._audioCache.get(name);
    if (!buffer) {
      console.warn(`[Audio] 声音 ${name} 不存在`);
      return;
    }

    const source = this._ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this._masterGain);

    return new Promise((resolve) => {
      source.start();
      source.onended = resolve;
    });
  }

  /**
   * 异步延迟
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 生成声音缓冲区
   */
  _generateSoundBuffer(params) {
    const { type, duration = 200, freq = 440 } = params;
    const sampleRate = this._ctx.sampleRate;
    const bufferSize = Math.ceil((duration / 1000) * sampleRate);
    const buffer = this._ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);

    switch (type) {
      case 'onYourMarks':
        // 低沉的男声提示音
        return this._generateVoicePrompt(180, duration, 'on your marks');

      case 'set':
        // 稍高的提示音
        return this._generateVoicePrompt(220, duration, 'set');

      case 'gunshot':
        // 真实的枪声：瞬态噪声 + 低频冲击
        return this._generateGunshot();

      case 'whistle':
        // 哨声
        return this._generateWhistle(freq, duration);

      case 'beep':
        // 短促蜂鸣
        return this._generateBeep(freq, duration);

      case 'error':
        // 错误音
        return this._generateErrorSound();

      default:
        // 默认正弦波
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.sin(2 * Math.PI * freq * i / sampleRate) * 0.5;
        }
        return buffer;
    }
  }

  /**
   * 生成类人声提示（使用音调组合模拟）
   */
  _generateVoicePrompt(baseFreq, duration, text) {
    const sampleRate = this._ctx.sampleRate;
    const bufferSize = Math.ceil((duration / 1000) * sampleRate);
    const buffer = this._ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);

    // 语音合成参数
    const pitch = baseFreq;
    const attackTime = 0.05;
    const sustainTime = duration / 1000 - 0.1;
    const releaseTime = 0.05;

    for (let i = 0; i < bufferSize; i++) {
      const t = i / sampleRate;
      let amplitude = 0;

      // 包络
      if (t < attackTime) {
        amplitude = t / attackTime;
      } else if (t < attackTime + sustainTime) {
        amplitude = 1;
      } else {
        amplitude = Math.max(0, 1 - (t - attackTime - sustainTime) / releaseTime);
      }

      // 基频 + 泛音（模拟人声质感）
      let sample = 0;
      sample += Math.sin(2 * Math.PI * pitch * t) * 0.6;
      sample += Math.sin(2 * Math.PI * pitch * 2 * t) * 0.2;
      sample += Math.sin(2 * Math.PI * pitch * 3 * t) * 0.1;
      sample += Math.sin(2 * Math.PI * pitch * 0.5 * t) * 0.3; // 次谐波增加厚重感

      // 添加轻微的颤音
      const vibrato = 1 + 0.02 * Math.sin(2 * Math.PI * 5 * t);
      sample *= vibrato;

      // 添加轻微的噪声（增加真实感）
      sample += (Math.random() - 0.5) * 0.02;

      data[i] = sample * amplitude * 0.7;
    }

    return buffer;
  }

  /**
   * 生成真实枪声
   * 枪声特点：
   * 1. 瞬态冲击 (0-5ms): 极高能量，低频
   * 2. 爆裂噪声 (5-50ms): 宽带噪声
   * 3. 衰减尾音 (50-200ms): 低频衰减
   */
  _generateGunshot() {
    const sampleRate = this._ctx.sampleRate;
    const duration = 0.3; // 300ms
    const bufferSize = Math.ceil(duration * sampleRate);
    const buffer = this._ctx.createBuffer(2, bufferSize, sampleRate); // 立体声
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    for (let i = 0; i < bufferSize; i++) {
      const t = i / sampleRate;

      let sample = 0;

      // 1. 瞬态冲击 (0-5ms)
      if (t < 0.005) {
        const envelope = Math.exp(-t * 500);
        const shock = Math.sin(2 * Math.PI * 80 * t) * envelope;
        sample += shock * 1.2;

        // 添加极高频瞬态
        sample += Math.sin(2 * Math.PI * 2000 * t) * envelope * 0.3;
      }

      // 2. 爆裂噪声 (0-100ms)
      if (t < 0.1) {
        const noiseEnvelope = Math.exp(-t * 30);
        const noise = (Math.random() * 2 - 1);
        // 低通滤波效果（简化）
        const filtered = noise * noiseEnvelope;
        sample += filtered * 0.8;

        // 中频成分
        sample += Math.sin(2 * Math.PI * 400 * t) * Math.exp(-t * 50) * 0.4;
      }

      // 3. 衰减尾音 (0-300ms)
      const tailEnvelope = Math.exp(-t * 15);
      sample += Math.sin(2 * Math.PI * 60 * t) * tailEnvelope * 0.3; // 低频嗡鸣

      // 添加空间感（左右声道略有不同）
      const stereoOffset = 0.02 * Math.sin(2 * Math.PI * 30 * t);

      // 输出（限制峰值）
      const outL = Math.max(-1, Math.min(1, sample * 0.85));
      const outR = Math.max(-1, Math.min(1, sample * 0.85 + stereoOffset));

      left[i] = outL;
      right[i] = outR;
    }

    // 归一化
    this._normalizeBuffer(buffer);

    return buffer;
  }

  /**
   * 生成哨声
   */
  _generateWhistle(freq, duration) {
    const sampleRate = this._ctx.sampleRate;
    const bufferSize = Math.ceil((duration / 1000) * sampleRate);
    const buffer = this._ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      const t = i / sampleRate;

      // 包络
      const attack = Math.min(1, t / 0.02);
      const release = Math.exp(-(t - duration / 1000 + 0.05) * 10);
      const envelope = attack * Math.min(1, release);

      // 哨声特征：纯正弦波 + 轻微调制
      const carrier = Math.sin(2 * Math.PI * freq * t);
      const modulation = 1 + 0.1 * Math.sin(2 * Math.PI * 8 * t);
      const tremolo = 1 + 0.05 * Math.sin(2 * Math.PI * 30 * t);

      data[i] = carrier * modulation * tremolo * envelope * 0.6;
    }

    return buffer;
  }

  /**
   * 生成蜂鸣声
   */
  _generateBeep(freq, duration) {
    const sampleRate = this._ctx.sampleRate;
    const bufferSize = Math.ceil((duration / 1000) * sampleRate);
    const buffer = this._ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      const t = i / sampleRate;

      // 短促包络
      const envelope = Math.sin(Math.PI * i / bufferSize);

      // 正弦波
      data[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.5;
    }

    return buffer;
  }

  /**
   * 生成错误提示音
   */
  _generateErrorSound() {
    const sampleRate = this._ctx.sampleRate;
    const duration = 0.3;
    const bufferSize = Math.ceil(duration * sampleRate);
    const buffer = this._ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);

    const freq1 = 200;
    const freq2 = 150;

    for (let i = 0; i < bufferSize; i++) {
      const t = i / sampleRate;

      // 短促的双音
      const envelope = Math.exp(-t * 15);

      // 交替频率
      const freq = t < duration / 2000 ? freq1 : freq2;

      data[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.5;
    }

    return buffer;
  }

  /**
   * 归一化音频缓冲区
   */
  _normalizeBuffer(buffer) {
    let maxAmp = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        maxAmp = Math.max(maxAmp, Math.abs(data[i]));
      }
    }

    if (maxAmp > 0.01) {
      const normFactor = 0.95 / maxAmp;
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < data.length; i++) {
          data[i] *= normFactor;
        }
      }
    }
  }

  /**
   * 获取音频分析器（用于可视化）
   */
  getAnalyser() {
    return this._analyser;
  }

  /**
   * 清理资源
   */
  destroy() {
    if (this._ctx) {
      this._ctx.close();
      this._ctx = null;
    }
    this._initialized = false;
    this._audioCache.clear();
  }
}

// ── 导出单例 ────────────────────────────────────────────────────────────────
export const startAudio = new StartAudioManager();
