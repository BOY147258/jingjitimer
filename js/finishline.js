// AI finish line detection via pixel motion analysis
export class FinishLineDetector {
  constructor() {
    this._video             = null;
    this._canvas            = null;
    this._ctx               = null;
    this._dispCanvas        = null;
    this._dispCtx           = null;
    this._prevSlice         = null;
    this._linePos           = 0.5;
    this._threshold         = 12;   // lower = more sensitive; user can adjust via slider
    this._running           = false;
    this._laneCount         = 4;
    this._laneDividers      = [];
    this._cooldowns         = [];
    this._lastMotion        = 0;
    this._lastBlobs         = [];
    this._lastCrossingTs    = -Infinity;  // performance.now() of last crossing
    this._lastCrossingLane  = -1;
    this.onCrossing         = null;  // cb(laneIdx, perfTimestamp)
    this.onLevel            = null;  // cb(level 0–1, blobsArray)
    this.onCloseFinish      = null;  // cb(firstLane, secondLane, diffMs) — fired when gap < 300ms
    // Analysis canvas: narrow strip centered on finish line (wider = more robust)
    this._W = 48;
    this._H = 120;
    // Lanes permanently locked after first crossing (cleared on race reset)
    this._laneDone     = new Set();
    // Optional per-lane finish time strings for overlay display
    this._laneFinishLabel = {};
    // Cooldown between crossings per lane (ms). Increase for multi-lap to prevent double-count.
    this.cooldownMs    = 1200;
    // 性能优化相关
    this._frameBuffer      = [];      // 帧缓冲区，用于多帧分析
    this._frameBufferSize  = 3;       // 缓冲区大小
    this._skipFrames       = 0;       // 跳帧计数器
    this._adaptiveSkip     = 1;       // 自适应跳帧（1=不跳，2=跳一半）
    this._lastFrameTime    = 0;       // 上一帧时间
    this._fps              = 0;       // 当前帧率
    this._performanceMode  = 'balanced'; // 'high' | 'balanced' | 'low'
    // 高级检测算法
    this._motionHistory    = [];      // 运动历史记录，用于趋势分析
    this._historySize      = 5;       // 历史记录大小
    this._edgeEnhancement  = true;    // 边缘增强
  }

  // Permanently lock a lane after its athlete crosses. Pass optional display label (e.g. "13.24").
  setLaneDone(laneIdx, label = '✓') {
    this._laneDone.add(laneIdx);
    this._cooldowns[laneIdx] = true;   // immediate suppression
    this._laneFinishLabel[laneIdx] = label;
  }

  // Clear all locks — call at race start / reset.
  resetLaneDone() {
    this._laneDone.clear();
    this._laneFinishLabel = {};
    this._cooldowns = new Array(this._laneCount).fill(false);
  }

  get threshold()  { return this._threshold; }
  set threshold(v) { this._threshold = Math.max(5, Math.min(100, v)); }

  get linePos()  { return this._linePos; }
  set linePos(v) { this._linePos = Math.max(0.05, Math.min(0.95, v)); }

  // Reset lane dividers to even spacing for given lane count
  _resetDividers(n) {
    this._laneDividers = [];
    for (let i = 1; i < n; i++) {
      this._laneDividers.push(i / n);
    }
  }

  // Map a blob's vertical center (0–H pixels) to a lane index (0-based)
  _laneFromY(centerY) {
    const relY = centerY / this._H;
    for (let i = 0; i < this._laneDividers.length; i++) {
      if (relY < this._laneDividers[i]) return i;
    }
    return this._laneCount - 1;
  }

  init(videoEl, displayCanvas, laneCount = 4) {
    this._video      = videoEl;
    this._dispCanvas = displayCanvas;
    this._dispCtx    = displayCanvas.getContext('2d');
    this._laneCount  = laneCount;
    this._cooldowns  = new Array(laneCount).fill(false);
    this._resetDividers(laneCount);

    this._prevSlice = null;  // reset when re-initing

    this._canvas = document.createElement('canvas');
    this._canvas.width  = this._W;
    this._canvas.height = this._H;
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
  }

  start(onCrossing, onLevel) {
    this.onCrossing = onCrossing;
    this.onLevel    = onLevel;
    this._running   = true;
    this._loop();
  }

  stop() { this._running = false; }

  _loop() {
    if (!this._running) return;

    // 计算帧率和自适应跳帧
    const now = performance.now();
    const delta = now - this._lastFrameTime;
    if (this._lastFrameTime > 0) {
      this._fps = Math.round(1000 / delta);
      // 根据性能模式和实际帧率调整跳帧策略
      if (this._performanceMode === 'high' || this._fps >= 30) {
        this._adaptiveSkip = 1; // 不跳帧
      } else if (this._fps >= 20) {
        this._adaptiveSkip = 2; // 处理一半帧
      } else {
        this._adaptiveSkip = 3; // 处理三分之一帧
      }
    }
    this._lastFrameTime = now;

    // 跳帧逻辑
    this._skipFrames++;
    if (this._skipFrames % this._adaptiveSkip === 0) {
      this._analyze();
    }

    this._drawOverlay();
    requestAnimationFrame(() => this._loop());
  }

  // 设置性能模式
  setPerformanceMode(mode) {
    this._performanceMode = mode; // 'high' | 'balanced' | 'low'
    if (mode === 'high') {
      this._W = 48; // 更宽的检测带
      this._frameBufferSize = 5;
    } else if (mode === 'balanced') {
      this._W = 48;
      this._frameBufferSize = 3;
    } else {
      this._W = 24;
      this._frameBufferSize = 2;
    }
    // 重新初始化canvas
    if (this._canvas) {
      this._canvas.width = this._W;
      this._canvas.height = this._H;
    }
  }

  // 获取当前性能统计
  getPerformanceStats() {
    return {
      fps: this._fps,
      skipRate: this._adaptiveSkip,
      mode: this._performanceMode,
      detectionWidth: this._W,
      bufferSize: this._frameBufferSize
    };
  }

  // Returns true when the raw video pixels are rotated 90° relative to the display.
  // Happens on iOS: camera always delivers portrait pixels even when phone is landscape.
  _isAxesSwapped() {
    const vw = this._video?.videoWidth  || 0;
    const vh = this._video?.videoHeight || 0;
    const dw = this._dispCanvas?.offsetWidth  || 0;
    const dh = this._dispCanvas?.offsetHeight || 0;
    if (!vw || !vh || !dw || !dh) return false;
    return (vw < vh) !== (dw < dh);   // one is portrait, the other landscape
  }

  _analyze() {
    if (!this._video || this._video.readyState < 2) return;
    const W = this._W, H = this._H;

    const vw = this._video.videoWidth  || 640;
    const vh = this._video.videoHeight || 480;

    // When the camera delivers portrait pixels but the display is landscape (common on iOS),
    // the finish-line axis in raw pixels is Y (not X), and the lane axis is X (not Y).
    const swapped = this._isAxesSwapped();

    if (!swapped) {
      // ── Normal (landscape raw video) ─────────────────
      // Take a thin vertical strip at the finish-line X position.
      const srcX = Math.max(0, Math.round(this._linePos * vw) - W / 2);
      const srcW = Math.min(W, vw - srcX);
      this._ctx.drawImage(this._video, srcX, 0, Math.max(1, srcW), vh, 0, 0, W, H);
    } else {
      // ── Portrait raw video in landscape display ───────
      // Finish-line position maps to a Y position in raw pixels.
      // Lane axis = X axis of raw video → map to analysis canvas Y axis.
      const srcY = Math.max(0, Math.round(this._linePos * vh) - W / 2);
      const srcH = Math.min(W, vh - srcY);
      // Draw the horizontal strip rotated 90° so raw-X becomes canvas-Y.
      this._ctx.save();
      this._ctx.translate(W, 0);
      this._ctx.rotate(Math.PI / 2);
      // After rotation: canvas X→Y, canvas Y→-X+W
      // drawImage dest (0,0,H,W) in rotated space fills the W×H analysis canvas.
      this._ctx.drawImage(this._video, 0, srcY, vw, Math.max(1, srcH), 0, 0, H, W);
      this._ctx.restore();
    }

    const slice = this._ctx.getImageData(0, 0, W, H);

    if (!this._prevSlice) {
      this._prevSlice = new Uint8Array(slice.data.length);
      this._prevSlice.set(slice.data);
      return;
    }

    // 边缘增强预处理（可选）
    let processedData = slice.data;
    if (this._edgeEnhancement) {
      processedData = this._applyEdgeEnhancement(slice.data, W, H);
    }

    // Motion per pixel row across the narrow strip
    const motionPerRow = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      let rowDiff = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        rowDiff += Math.abs(processedData[i]   - this._prevSlice[i]);
        rowDiff += Math.abs(processedData[i+1] - this._prevSlice[i+1]);
        rowDiff += Math.abs(processedData[i+2] - this._prevSlice[i+2]);
      }
      motionPerRow[y] = rowDiff / (W * 3);
    }

    this._prevSlice.set(slice.data);

    // 多帧平滑 - 添加到缓冲区
    this._frameBuffer.push(motionPerRow);
    if (this._frameBuffer.length > this._frameBufferSize) {
      this._frameBuffer.shift();
    }

    // 使用多帧平均值（减少抖动）
    const smoothedMotion = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      let sum = 0;
      for (let frame of this._frameBuffer) {
        sum += frame[y];
      }
      smoothedMotion[y] = sum / this._frameBuffer.length;
    }

    let total = 0;
    for (let i = 0; i < H; i++) total += smoothedMotion[i];
    const level = Math.min(1, total / (H * this._threshold * 2));
    this._lastMotion = level;

    // 运动趋势分析
    this._motionHistory.push(level);
    if (this._motionHistory.length > this._historySize) {
      this._motionHistory.shift();
    }

    const blobs = this._detectBlobs(smoothedMotion, H);
    this._lastBlobs = blobs;
    this.onLevel?.(level, blobs);

    blobs.forEach(blob => {
      const laneIdx = this._laneFromY(blob.center);
      if (this._cooldowns[laneIdx]) return;

      // 趋势验证：检测是否是真实的上升趋势（减少误触发）
      const isTrending = this._isMotionTrending();
      if (!isTrending && blob.peak < this._threshold * 1.2) {
        return; // 运动不够强或不是趋势性的，忽略
      }

      const ts     = performance.now();
      const diffMs = ts - this._lastCrossingTs;

      // Fire close-finish callback when two lanes cross within 300ms
      if (diffMs < 300 && this._lastCrossingLane >= 0 && this._lastCrossingLane !== laneIdx) {
        this.onCloseFinish?.(this._lastCrossingLane, laneIdx, Math.round(diffMs));
      }

      this._lastCrossingTs   = ts;
      this._lastCrossingLane = laneIdx;

      this._cooldowns[laneIdx] = true;
      this.onCrossing?.(laneIdx, ts);
      // Reset cooldown after cooldownMs — but only if the lane isn't permanently locked
      // cooldownMs is set higher (3000ms) for multi-lap races to prevent double-counting
      setTimeout(() => {
        if (!this._laneDone.has(laneIdx)) this._cooldowns[laneIdx] = false;
      }, this.cooldownMs);
    });
  }

  // 边缘增强算法（Sobel算子简化版）
  _applyEdgeEnhancement(data, W, H) {
    const enhanced = new Uint8ClampedArray(data.length);
    enhanced.set(data);

    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = (y * W + x) * 4;

        // 简化的Sobel算子（仅检测水平边缘）
        const gx =
          -data[((y-1)*W + (x-1))*4] - 2*data[((y-1)*W + x)*4] - data[((y-1)*W + (x+1))*4] +
           data[((y+1)*W + (x-1))*4] + 2*data[((y+1)*W + x)*4] + data[((y+1)*W + (x+1))*4];

        const magnitude = Math.min(255, Math.abs(gx) * 0.5);

        // 增强边缘
        enhanced[i] = Math.min(255, data[i] + magnitude * 0.3);
        enhanced[i+1] = Math.min(255, data[i+1] + magnitude * 0.3);
        enhanced[i+2] = Math.min(255, data[i+2] + magnitude * 0.3);
      }
    }

    return enhanced;
  }

  // 检测运动是否呈上升趋势
  _isMotionTrending() {
    if (this._motionHistory.length < 3) return true; // 数据不足，假设有效

    const recent = this._motionHistory.slice(-3);
    let rising = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i] > recent[i-1]) rising++;
    }

    return rising >= 2; // 至少2次上升
  }

  _detectBlobs(motionPerRow, H) {
    const THRESH  = this._threshold * 0.7;
    const MIN_PX  = Math.floor(H * 0.08);  // blob must be ≥8% of height

    const blobs = [];
    let start = -1;
    let maxM  = 0;

    for (let y = 0; y <= H; y++) {
      const m = y < H ? motionPerRow[y] : 0;
      if (m > THRESH && start < 0) { start = y; maxM = m; }
      else if (m > THRESH)         { if (m > maxM) maxM = m; }
      else if (start >= 0) {
        if (y - start >= MIN_PX) {
          blobs.push({
            top:    start,
            bottom: y,
            center: (start + y) / 2,
            peak:   maxM,
          });
        }
        start = -1; maxM = 0;
      }
    }
    return blobs;
  }

  _drawOverlay() {
    if (!this._dispCanvas) return;

    // ── Sync canvas buffer to current CSS layout size every frame ──
    // This is the only reliable way to handle orientation changes on all devices.
    const dpr = window.devicePixelRatio || 1;
    const cssW = this._dispCanvas.offsetWidth;
    const cssH = this._dispCanvas.offsetHeight;
    if (cssW > 0 && cssH > 0) {
      const needW = Math.round(cssW * dpr);
      const needH = Math.round(cssH * dpr);
      if (this._dispCanvas.width !== needW || this._dispCanvas.height !== needH) {
        this._dispCanvas.width  = needW;
        this._dispCanvas.height = needH;
        this._prevSlice = null;   // reset motion diff after resize
      }
    } else {
      return;  // canvas not laid out yet (hidden parent)
    }

    const dW  = this._dispCanvas.width;
    const dH  = this._dispCanvas.height;
    const ctx = this._dispCtx;

    ctx.clearRect(0, 0, dW, dH);

    // ── Draw lane dividers (horizontal) ──
    this._drawLaneDividers(ctx, dW, dH, dpr);

    const lineX  = Math.floor(this._linePos * dW);
    const motion = this._lastMotion;
    const col    = motion > 0.6 ? '#ff1744' : motion > 0.25 ? '#ffd600' : '#00e676';

    // Semi-transparent vertical band behind line
    ctx.fillStyle = `${col}22`;
    ctx.fillRect(lineX - 2, 0, 4, dH);

    // Glow line
    ctx.shadowColor = col;
    ctx.shadowBlur  = 16 * dpr;
    ctx.strokeStyle = col;
    ctx.lineWidth   = 3 * dpr;
    ctx.setLineDash([12 * dpr, 5 * dpr]);
    ctx.beginPath();
    ctx.moveTo(lineX, 0);
    ctx.lineTo(lineX, dH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    // "终点线" pill label at top
    const fontSize = Math.max(11, 13 * dpr);
    ctx.font = `bold ${fontSize}px -apple-system,sans-serif`;
    ctx.textAlign = 'center';
    const labelW = ctx.measureText('终点线').width + 16 * dpr;
    const labelH = fontSize + 10 * dpr;
    const labelX = lineX - labelW / 2;
    const labelY = 6 * dpr;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect(labelX, labelY, labelW, labelH, 4 * dpr);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.fillText('终点线', lineX, labelY + labelH - 6 * dpr);

    // Drag handle (circle in the middle of the line)
    const cy = dH / 2;
    const r  = 18 * dpr;
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur  = 8 * dpr;
    ctx.beginPath();
    ctx.arc(lineX, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Arrows inside handle ← →
    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.round(14 * dpr)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('↔', lineX, cy);
    ctx.textBaseline = 'alphabetic';

    // Motion bar (right edge)
    const barH = Math.floor(motion * dH * 0.8);
    ctx.fillStyle = `rgba(0,230,118,${0.25 + motion * 0.55})`;
    ctx.fillRect(dW - 10 * dpr, dH - barH, 8 * dpr, barH);

    // Highlight active blobs on the finish line
    this._lastBlobs.forEach(blob => {
      const bTop = (blob.top    / this._H) * dH;
      const bBot = (blob.bottom / this._H) * dH;
      const lane = this._laneFromY(blob.center) + 1;
      ctx.fillStyle = 'rgba(255,23,68,0.35)';
      ctx.fillRect(lineX - 12 * dpr, bTop, 24 * dpr, bBot - bTop);
      // Lane number tag
      ctx.fillStyle = '#ff1744';
      ctx.font = `bold ${Math.round(12 * dpr)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${lane}`, lineX, (bTop + bBot) / 2);
      ctx.textBaseline = 'alphabetic';
    });
  }

  _drawLaneDividers(ctx, dW, dH, dpr) {
    if (this._laneCount < 2) return;

    ctx.save();
    const handleX = dW * 0.5;
    const handleR = 14 * dpr;

    this._laneDividers.forEach((divY, i) => {
      const y = Math.floor(divY * dH);

      // Horizontal divider line
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth   = 1.5 * dpr;
      ctx.setLineDash([8 * dpr, 5 * dpr]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(dW, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Drag handle circle
      ctx.fillStyle   = 'rgba(255,255,255,0.75)';
      ctx.shadowColor = 'rgba(255,255,255,0.4)';
      ctx.shadowBlur  = 6 * dpr;
      ctx.beginPath();
      ctx.arc(handleX, y, handleR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // ↕ arrow
      ctx.fillStyle = '#000';
      ctx.font = `bold ${Math.round(11 * dpr)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↕', handleX, y);
      ctx.textBaseline = 'alphabetic';
    });

    // Lane number labels (left side, between dividers)
    ctx.font      = `bold ${Math.round(11 * dpr)}px -apple-system,sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let lane = 0; lane < this._laneCount; lane++) {
      const topY    = lane === 0 ? 0 : this._laneDividers[lane - 1] * dH;
      const bottomY = lane === this._laneCount - 1 ? dH : this._laneDividers[lane] * dH;
      const midY    = (topY + bottomY) / 2;
      const done    = this._laneDone.has(lane);

      // Tint done lanes with a soft green strip
      if (done) {
        ctx.fillStyle = 'rgba(0,230,118,0.08)';
        ctx.fillRect(0, topY, dW, bottomY - topY);
      }

      // Lane number pill
      const laneLabel = `${lane + 1}道`;
      const lw = ctx.measureText(laneLabel).width + 10 * dpr;
      const lh = 16 * dpr;
      ctx.fillStyle = done ? 'rgba(0,180,90,0.75)' : 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.roundRect(4 * dpr, midY - lh / 2, lw, lh, 4 * dpr);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(laneLabel, 9 * dpr, midY);

      // If done, show finish time on the right side of the lane
      if (done && this._laneFinishLabel[lane]) {
        const timeLabel = this._laneFinishLabel[lane];
        ctx.textAlign = 'right';
        ctx.font = `bold ${Math.round(13 * dpr)}px -apple-system,sans-serif`;
        const tw = ctx.measureText(timeLabel).width + 14 * dpr;
        const th = 20 * dpr;
        ctx.fillStyle = 'rgba(0,140,70,0.8)';
        ctx.beginPath();
        ctx.roundRect(dW - tw - 6 * dpr, midY - th / 2, tw, th, 5 * dpr);
        ctx.fill();
        ctx.fillStyle = '#00ff88';
        ctx.fillText(timeLabel, dW - 13 * dpr, midY);
        ctx.textAlign = 'left';
        ctx.font = `bold ${Math.round(11 * dpr)}px -apple-system,sans-serif`;
      }
    }

    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  // Capture current video frame + overlay as data URL (called at crossing moment)
  captureFrame(width = 640, height = 360, label = null) {
    if (!this._video || this._video.readyState < 2) return null;
    try {
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      const ctx = c.getContext('2d');
      ctx.drawImage(this._video, 0, 0, width, height);

      // Draw lane dividers (white dashed horizontal lines)
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([6, 4]);
      for (const d of this._laneDividers) {
        const y = Math.round(d * height);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
      ctx.setLineDash([]);

      // Draw finish line (red dashed vertical)
      const lx = Math.round(this._linePos * width);
      ctx.strokeStyle = 'rgba(255,23,68,0.95)';
      ctx.lineWidth   = 2.5;
      ctx.setLineDash([10, 5]);
      ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, height); ctx.stroke();
      ctx.setLineDash([]);

      // Draw label bar (name + time) at bottom
      if (label) {
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.fillRect(0, height - 36, width, 36);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 17px -apple-system, "PingFang SC", sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, 10, height - 8);
        ctx.textBaseline = 'alphabetic';
      }

      return c.toDataURL('image/jpeg', 0.85);
    } catch { return null; }
  }

  // Auto-detect lane count and divider positions from a full video frame.
  // Works with both landscape raw video AND portrait raw video (iOS in landscape mode).
  // Returns { lanes, dividers } on success, or null if detection failed.
  autoDetectLanes(maxLanes = 8) {
    if (!this._video || this._video.readyState < 2) return null;

    const AW = 200, AH = 150;
    const ac   = document.createElement('canvas');
    ac.width   = AW; ac.height = AH;
    const actx = ac.getContext('2d', { willReadFrequently: true });
    actx.drawImage(this._video, 0, 0, AW, AH);
    const img  = actx.getImageData(0, 0, AW, AH).data;

    // When camera delivers portrait pixels in landscape mode (iOS), lane lines
    // appear as COLUMNS (not rows) in the raw image → analyze column brightness.
    const swapped = this._isAxesSwapped();
    const N       = swapped ? AW : AH;   // number of slices along the lane axis

    const sliceBrightness = new Float32Array(N);
    if (!swapped) {
      // Lane axis = Y (rows). Average brightness across center 60% of X.
      const x0 = Math.floor(AW * 0.20), x1 = Math.floor(AW * 0.80);
      for (let y = 0; y < AH; y++) {
        let s = 0;
        for (let x = x0; x < x1; x++) {
          const i = (y * AW + x) * 4;
          s += img[i] * 0.299 + img[i+1] * 0.587 + img[i+2] * 0.114;
        }
        sliceBrightness[y] = s / (x1 - x0);
      }
    } else {
      // Lane axis = X (columns). Average brightness across center 60% of Y.
      const y0 = Math.floor(AH * 0.20), y1 = Math.floor(AH * 0.80);
      for (let x = 0; x < AW; x++) {
        let s = 0;
        for (let y = y0; y < y1; y++) {
          const i = (y * AW + x) * 4;
          s += img[i] * 0.299 + img[i+1] * 0.587 + img[i+2] * 0.114;
        }
        sliceBrightness[x] = s / (y1 - y0);
      }
    }

    // 3-slice box-filter smoothing
    const smoothed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      smoothed[i] = (sliceBrightness[Math.max(0, i-1)] +
                     sliceBrightness[i] +
                     sliceBrightness[Math.min(N-1, i+1)]) / 3;
    }

    // Adaptive threshold: mean + 30% of dynamic range
    let mean = 0, maxB = 0;
    for (let i = 0; i < N; i++) { mean += smoothed[i]; if (smoothed[i] > maxB) maxB = smoothed[i]; }
    mean /= N;
    const thresh = mean + (maxB - mean) * 0.30;   // 30% → more lenient

    // Local-maxima peaks with minimum spacing
    const MIN_GAP = Math.max(3, Math.floor(N / (maxLanes + 1)));
    const peaks = [];
    for (let i = 1; i < N - 1; i++) {
      if (smoothed[i] > thresh &&
          smoothed[i] >= smoothed[i-1] &&
          smoothed[i] >= smoothed[i+1]) {
        if (!peaks.length || i - peaks[peaks.length-1] > MIN_GAP) {
          peaks.push(i);
        }
      }
    }

    if (peaks.length < 1 || peaks.length >= maxLanes) return null;

    const detectedLanes = peaks.length + 1;
    this._laneCount    = detectedLanes;
    this._laneDividers = peaks.map(p => p / N);  // 0–1 fractions along the lane axis
    this._cooldowns    = new Array(detectedLanes).fill(false);
    return { lanes: detectedLanes, dividers: this._laneDividers.slice() };
  }

  // Allow user to reposition finish line and lane dividers by touch/click
  bindDrag(displayCanvas) {
    displayCanvas.style.touchAction = 'none';
    displayCanvas.style.cursor = 'grab';

    let dragging = null; // 'line' | { divider: index }

    const hitTest = (clientX, clientY) => {
      const rect = displayCanvas.getBoundingClientRect();
      const fx = (clientX - rect.left) / rect.width;
      const fy = (clientY - rect.top)  / rect.height;

      // Check finish line handle (circle at vertical centre)
      const lineDist = Math.abs(fx - this._linePos);
      const lineCyDist = Math.abs(fy - 0.5);
      if (lineDist < 0.06 && lineCyDist < 0.07) return 'line';

      // Check lane divider handles (centred horizontally, at divider Y)
      for (let i = 0; i < this._laneDividers.length; i++) {
        const dyDist = Math.abs(fy - this._laneDividers[i]);
        const dxDist = Math.abs(fx - 0.5);
        if (dyDist < 0.06 && dxDist < 0.12) return { divider: i };
      }

      // Anywhere near the vertical finish line → drag line
      if (lineDist < 0.08) return 'line';

      return null;
    };

    const onMove = (clientX, clientY) => {
      if (dragging === null) return;
      const rect = displayCanvas.getBoundingClientRect();
      const fx = (clientX - rect.left) / rect.width;
      const fy = (clientY - rect.top)  / rect.height;

      if (dragging === 'line') {
        this._linePos = Math.max(0.05, Math.min(0.95, fx));
      } else {
        const i   = dragging.divider;
        const min = i === 0
          ? 0.05
          : this._laneDividers[i - 1] + 0.04;
        const max = i === this._laneDividers.length - 1
          ? 0.95
          : this._laneDividers[i + 1] - 0.04;
        this._laneDividers[i] = Math.max(min, Math.min(max, fy));
      }
    };

    const onStart = (clientX, clientY) => {
      dragging = hitTest(clientX, clientY) ?? 'line';
      displayCanvas.style.cursor = 'grabbing';
      onMove(clientX, clientY);
    };

    const onEnd = () => {
      dragging = null;
      displayCanvas.style.cursor = 'grab';
    };

    displayCanvas.addEventListener('touchstart', e => {
      e.preventDefault();
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    displayCanvas.addEventListener('touchmove', e => {
      e.preventDefault();
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    displayCanvas.addEventListener('touchend', onEnd);

    displayCanvas.addEventListener('mousedown', e => onStart(e.clientX, e.clientY));
    displayCanvas.addEventListener('mousemove', e => { if (dragging !== null) onMove(e.clientX, e.clientY); });
    displayCanvas.addEventListener('mouseup',   onEnd);
    displayCanvas.addEventListener('mouseleave', onEnd);
  }
}
