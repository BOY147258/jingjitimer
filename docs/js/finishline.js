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
    this._threshold         = 14;   // lower = more sensitive; user can adjust via slider
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
    this._W = 32;
    this._H = 90;
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
    this._analyze();
    this._drawOverlay();
    requestAnimationFrame(() => this._loop());
  }

  _analyze() {
    if (!this._video || this._video.readyState < 2) return;
    const W = this._W, H = this._H;  // W = 4 (vertical line scan)

    // Use display canvas dimensions as reliable proxy for video frame dimensions
    const vw   = this._video.videoWidth  || this._dispCanvas?.offsetWidth  || 640;
    const vh   = this._video.videoHeight || this._dispCanvas?.offsetHeight || 480;
    const srcX = Math.max(0, Math.round(this._linePos * vw) - W / 2);
    const srcW = Math.min(W, vw - srcX);
    // Source-crop to finish line strip only
    if (srcW > 0) {
      this._ctx.drawImage(this._video, srcX, 0, srcW, vh, 0, 0, W, H);
    } else {
      this._ctx.drawImage(this._video, 0, 0, W, H);
    }

    const slice = this._ctx.getImageData(0, 0, W, H);

    if (!this._prevSlice) {
      this._prevSlice = new Uint8Array(slice.data.length);
      this._prevSlice.set(slice.data);
      return;
    }

    // Motion per pixel row across the narrow strip
    const motionPerRow = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      let rowDiff = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        rowDiff += Math.abs(slice.data[i]   - this._prevSlice[i]);
        rowDiff += Math.abs(slice.data[i+1] - this._prevSlice[i+1]);
        rowDiff += Math.abs(slice.data[i+2] - this._prevSlice[i+2]);
      }
      motionPerRow[y] = rowDiff / (W * 3);
    }

    this._prevSlice.set(slice.data);

    let total = 0;
    for (let i = 0; i < H; i++) total += motionPerRow[i];
    const level = Math.min(1, total / (H * this._threshold * 2));
    this._lastMotion = level;

    const blobs = this._detectBlobs(motionPerRow, H);
    this._lastBlobs = blobs;
    this.onLevel?.(level, blobs);

    blobs.forEach(blob => {
      const laneIdx = this._laneFromY(blob.center);
      if (this._cooldowns[laneIdx]) return;

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
      setTimeout(() => { this._cooldowns[laneIdx] = false; }, 1500);
    });
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
    const dW  = this._dispCanvas.width;
    const dH  = this._dispCanvas.height;
    const ctx = this._dispCtx;
    const dpr = window.devicePixelRatio || 1;

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

      // Pill background
      const label  = `${lane + 1}道`;
      const lw     = ctx.measureText(label).width + 10 * dpr;
      const lh     = 16 * dpr;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.roundRect(4 * dpr, midY - lh / 2, lw, lh, 4 * dpr);
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(label, 9 * dpr, midY);
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
  // Scans row brightness across the entire frame to find bright white lane lines
  // painted on the track, then updates _laneCount and _laneDividers.
  // Returns { lanes, dividers } on success, or null if detection failed.
  autoDetectLanes(maxLanes = 8) {
    if (!this._video || this._video.readyState < 2) return null;

    const AW = 200, AH = 150;
    const ac   = document.createElement('canvas');
    ac.width   = AW; ac.height = AH;
    const actx = ac.getContext('2d', { willReadFrequently: true });
    actx.drawImage(this._video, 0, 0, AW, AH);
    const img = actx.getImageData(0, 0, AW, AH).data;

    // Row-average brightness (use center 60% horizontally to avoid edge vignetting)
    const xStart = Math.floor(AW * 0.20);
    const xEnd   = Math.floor(AW * 0.80);
    const xSpan  = xEnd - xStart;
    const rowBrightness = new Float32Array(AH);
    for (let y = 0; y < AH; y++) {
      let sum = 0;
      for (let x = xStart; x < xEnd; x++) {
        const i = (y * AW + x) * 4;
        sum += (img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114);
      }
      rowBrightness[y] = sum / xSpan;
    }

    // Smooth with a 3-row box filter to reduce noise
    const smoothed = new Float32Array(AH);
    for (let y = 0; y < AH; y++) {
      smoothed[y] = (rowBrightness[Math.max(0, y - 1)] +
                     rowBrightness[y] +
                     rowBrightness[Math.min(AH - 1, y + 1)]) / 3;
    }

    // Adaptive threshold: mean + fraction of (max - mean)
    let mean = 0, maxB = 0;
    for (let y = 0; y < AH; y++) { mean += smoothed[y]; if (smoothed[y] > maxB) maxB = smoothed[y]; }
    mean /= AH;
    const thresh = mean + (maxB - mean) * 0.35;

    // Find local maxima above threshold, with minimum gap between peaks
    const MIN_GAP = Math.max(4, Math.floor(AH / (maxLanes + 1)));
    const peaks = [];
    for (let y = 1; y < AH - 1; y++) {
      if (smoothed[y] > thresh &&
          smoothed[y] >= smoothed[y - 1] &&
          smoothed[y] >= smoothed[y + 1]) {
        if (!peaks.length || y - peaks[peaks.length - 1] > MIN_GAP) {
          peaks.push(y);
        }
      }
    }

    // Need 1–(maxLanes-1) dividers to define 2–maxLanes lanes
    if (peaks.length < 1 || peaks.length >= maxLanes) return null;

    const detectedLanes = peaks.length + 1;
    this._laneCount    = detectedLanes;
    this._laneDividers = peaks.map(p => p / AH);
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
