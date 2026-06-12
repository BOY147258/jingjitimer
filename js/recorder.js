/**
 * VideoRecorder - 视频录制器 V2.0
 *
 * 优化：
 * 1. 支持多种编解码器
 * 2. 改进录制稳定性
 * 3. 支持后台录制
 * 4. 更好的错误处理
 */

export class VideoRecorder {
  constructor() {
    this._stream = null;
    this._recorder = null;
    this._chunks = [];
    this._blob = null;
    this._recording = false;
    this.hasVideo = false;
    this._mimeType = 'video/webm;codecs=vp9,opus';
    this._startTime = null;
  }

  initFromStream(stream) {
    this._stream = stream;
    this.hasVideo = stream.getVideoTracks().length > 0;

    // 选择最佳编码格式
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm',
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4'
    ];

    for (const mime of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mime)) {
        this._mimeType = mime;
        break;
      }
    }
  }

  start() {
    if (!this._stream || this._recording) return;
    this._chunks = [];
    this._blob = null;
    this._startTime = Date.now();

    try {
      const options = { mimeType: this._mimeType };
      this._recorder = new MediaRecorder(this._stream, options);
    } catch {
      this._recorder = new MediaRecorder(this._stream);
    }

    this._recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) this._chunks.push(e.data);
    };

    this._recorder.start(150); // 每150ms请求数据，减少丢帧
    this._recording = true;
  }

  stop() {
    if (!this._recorder || !this._recording) return Promise.resolve(null);
    return new Promise(resolve => {
      this._recorder.onstop = () => {
        const type = this._recorder.mimeType || 'video/webm';
        this._blob = new Blob(this._chunks, { type });
        this._recording = false;
        resolve(this._blob);
      };
      this._recorder.stop();
    });
  }

  // 暂停录制
  pause() {
    if (this._recorder && this._recording) {
      this._recorder.pause();
    }
  }

  // 恢复录制
  resume() {
    if (this._recorder && this._recording) {
      this._recorder.resume();
    }
  }

  getObjectURL() {
    if (!this._blob) return null;
    return URL.createObjectURL(this._blob);
  }

  download(filename) {
    if (!this._blob) return;
    const ext = this._blob.type.includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(this._blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ? `${filename}.${ext}` : `race-${this._startTime || Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  get recording() { return this._recording; }
  get hasBlob() { return !!this._blob; }

  // 获取录制时长（秒）
  get duration() {
    if (!this._startTime) return 0;
    return Math.floor((Date.now() - this._startTime) / 1000);
  }
}