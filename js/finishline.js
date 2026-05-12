// AI finish line detection via pixel motion analysis
export class FinishLineDetector {
  constructor() {
    this._video         = null;
    this._canvas        = null;  // low-res analysis canvas
    this._ctx           = null;
    this._dispCanvas    = null;  // display canvas (overlay on top of video)
    this._dispCtx       = null;
    this._prevSlice     = null;
    this._linePos       = 0.5;   // 0–1 fraction of video width
    this._sliceW        = 6;     // pixel width of sample strip
    this._threshold     = 20;    // motion threshold (0–255 avg pixel diff)
    this._running       = false;
    this._laneCount     = 4;
    this._laneDividers  = [];    // Y positions (0–1) of lane boundaries, length = laneCount-1
    this._cooldowns     = [];    // per-lane cooldown flags
    this._lastMotion    = 0;
    this._lastBlobs     = [];
    this.onCrossing     = null;  // cb(laneIdx, perfTimestamp)
    this.onLevel        = null;  // cb(level 0–1, blobsArray)
    // Analysis canvas dimensions (kept low for performance)
    this._W = 160;
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
    const W = this._W, H = this._H;

    this._ctx.drawImage(this._video, 0, 0, W, H);

    const lineX  = Math.floor(this._linePos * W);
    const sliceX = Math.max(0, lineX - Math.floor(this._sliceW / 2));
    const slice  = this._ctx.getImageData(sliceX, 0, this._sliceW, H);

    if (!this._prevSlice) {
      this._prevSlice = new Uint8Array(slice.data.length);
      this._prevSlice.set(slice.data);
      return;
    }

    // Calculate motion per pixel row
    const motionPerRow = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      let rowDiff = 0;
      for (let x = 0; x < this._sliceW; x++) {
        const i = (y * this._sliceW + x) * 4;
        rowDiff += Math.abs(slice.data[i]   - this._prevSlice[i]);
        rowDiff += Math.abs(slice.data[i+1] - this._prevSlice[i+1]);
        rowDiff += Math.abs(slice.data[i+2] - this._prevSlice[i+2]);
      }
      motionPerRow[y] = rowDiff / (this._sliceW * 3);
    }

    this._prevSlice.set(slice.data);

    // Overall motion level (for visualization)
    let total = 0;
    for (let i = 0; i < H; i++) total += motionPerRow[i];
    const level = Math.min(1, total / (H * this._threshold * 2));
    this._lastMotion = level;

    // Detect blobs (groups of rows with high motion)
    const blobs = this._detectBlobs(motionPerRow, H);
    this._lastBlobs = blobs;
    this.onLevel?.(level, blobs);

    // Each blob = one athlete crossing — map to lane by vertical position
    blobs.forEach(blob => {
      const laneIdx = this._laneFromY(blob.center);

      if (!this._cooldowns[laneIdx]) {
        this._cooldowns[laneIdx] = true;
        this.onCrossing?.(laneIdx, performance.now());
        // Cooldown: 1.5s per lane to prevent double-counting
        setTimeout(() => { this._cooldowns[laneIdx] = false; }, 1500);
      }
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
