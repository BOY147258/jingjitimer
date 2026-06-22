/**
 * 成绩导出模块 - 支持 CSV、XLSX、PDF 格式
 *
 * 使用 SheetJS (xlsx) 库生成真正的 Excel 文件
 */

// SheetJS CDN 加载器
let XLSX = null;

async function loadSheetJS() {
  if (XLSX) return XLSX;

  return new Promise((resolve, reject) => {
    if (window.XLSX) {
      XLSX = window.XLSX;
      resolve(XLSX);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload = () => {
      XLSX = window.XLSX;
      resolve(XLSX);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

/**
 * 格式化时间显示
 */
function formatTime(ms) {
  if (ms == null) return '';
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const centiseconds = Math.floor((totalSeconds % 1) * 100);

  if (minutes > 0) {
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
  }
  return `${seconds}.${String(centiseconds).padStart(2, '0')}`;
}

/**
 * 生成导出文件名
 */
function generateFilename(parts, extension) {
  const cleaned = parts
    .filter(Boolean)
    .map(p => p.replace(/[\\/:*?"<>|]/g, '-').trim())
    .join('_');
  return `${cleaned}.${extension}`;
}

// ── CSV 导出 ─────────────────────────────────────────────

/**
 * 导出 CSV 格式
 */
function exportCSV(race, options = {}) {
  const {
    orgName = '',
    raceName = '田径比赛',
    distance = 0,
    delimiter = ','
  } = options;

  const sorted = race.lanes.filter(l => l.time != null).sort((a, b) => a.time - b.time);
  const dnf = race.lanes.filter(l => l.time == null);
  const maxLaps = Math.max(0, ...race.lanes.map(l => l.lapTimes?.length || 0));

  // BOM for UTF-8 Excel compatibility
  let csv = '﻿';

  // 标题行
  const headers = ['名次', '道次', '姓名'];
  if (maxLaps > 1) {
    for (let i = 1; i <= maxLaps; i++) {
      headers.push(`第${i}圈`);
    }
  }
  headers.push('成绩', '备注');
  csv += headers.join(delimiter) + '\n';

  // 数据行
  sorted.forEach((l, i) => {
    const row = [
      i + 1,
      l.id + 1,
      l.name || `运动员${l.id + 1}`
    ];

    if (maxLaps > 1) {
      for (let j = 0; j < maxLaps; j++) {
        row.push(l.lapTimes?.[j] != null ? formatTime(l.lapTimes[j]) : '');
      }
    }

    row.push(formatTime(l.time), '');
    csv += row.join(delimiter) + '\n';
  });

  dnf.forEach(l => {
    const row = [
      'DNF',
      l.id + 1,
      l.name || `运动员${l.id + 1}`
    ];

    if (maxLaps > 1) {
      for (let j = 0; j < maxLaps; j++) {
        row.push('');
      }
    }

    row.push('', l.dnf ? 'DNF' : 'DNS');
    csv += row.join(delimiter) + '\n';
  });

  // 下载
  downloadBlob(csv, generateFilename([orgName, raceName, `第${race.round}轮第${race.group}组`], 'csv'), 'text/csv;charset=utf-8');
}

// ── XLSX 导出 ────────────────────────────────────────────

/**
 * 导出 XLSX 格式（真正的 Excel 文件）
 */
async function exportXLSX(race, options = {}) {
  await loadSheetJS();

  const {
    orgName = '',
    raceName = '田径比赛',
    distance = 0,
    includeWeather = true,
    includeBest = true,
    includeLapTimes = true,
    includePhotos = false
  } = options;

  const wb = XLSX.utils.book_new();

  // 1. 成绩总表
  const resultsSheet = createResultsSheet(race, { includeLapTimes });
  XLSX.utils.book_append_sheet(wb, resultsSheet, '成绩单');

  // 2. 详细数据
  const detailSheet = createDetailSheet(race, options);
  XLSX.utils.book_append_sheet(wb, detailSheet, '详细数据');

  // 3. 统计信息（如果有）
  if (includeBest || distance) {
    const statsSheet = createStatsSheet(race, options);
    XLSX.utils.book_append_sheet(wb, statsSheet, '统计');
  }

  // 下载
  const fname = generateFilename([orgName, raceName, `第${race.round}轮第${race.group}组`], 'xlsx');
  XLSX.writeFile(wb, fname);
}

/**
 * 创建成绩单工作表
 */
function createResultsSheet(race, options = {}) {
  const { includeLapTimes = true } = options;

  const sorted = race.lanes.filter(l => l.time != null).sort((a, b) => a.time - b.time);
  const dnf = race.lanes.filter(l => l.time == null);
  const maxLaps = Math.max(0, ...race.lanes.map(l => l.lapTimes?.length || 0));

  // 标题行
  const headers = ['名次', '道次', '姓名'];
  if (includeLapTimes && maxLaps > 1) {
    for (let i = 1; i <= maxLaps; i++) {
      headers.push(`第${i}圈`);
    }
  }
  headers.push('成绩');

  const data = [headers];

  // 冠军高亮
  sorted.forEach((l, i) => {
    const row = [i + 1, l.id + 1, l.name || `运动员${l.id + 1}`];

    if (includeLapTimes && maxLaps > 1) {
      for (let j = 0; j < maxLaps; j++) {
        row.push(l.lapTimes?.[j] != null ? formatTime(l.lapTimes[j]) : '');
      }
    }

    row.push(formatTime(l.time));
    data.push(row);
  });

  // DNF
  dnf.forEach(l => {
    const row = ['-', l.id + 1, l.name || `运动员${l.id + 1}`];

    if (includeLapTimes && maxLaps > 1) {
      for (let j = 0; j < maxLaps; j++) {
        row.push('');
      }
    }

    row.push(l.dnf ? 'DNF' : 'DNS');
    data.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(data);

  // 设置列宽
  ws['!cols'] = [
    { wch: 6 },   // 名次
    { wch: 6 },   // 道次
    { wch: 12 },  // 姓名
    ...(includeLapTimes && maxLaps > 1 ? Array(maxLaps).fill({ wch: 10 }) : []),
    { wch: 12 }   // 成绩
  ];

  return ws;
}

/**
 * 创建详细数据工作表
 */
function createDetailSheet(race, options = {}) {
  const { orgName = '', raceName = '', distance = 0 } = options;

  const data = [
    ['竞迹 JingJi 成绩详细数据'],
    [],
    ['比赛信息'],
    ['组织', orgName],
    ['比赛名称', raceName],
    ['距离', `${distance}m`],
    ['日期', race.date || new Date().toLocaleDateString('zh-CN')],
    ['轮次', `第 ${race.round || 1} 轮`],
    ['组次', `第 ${race.group || 1} 组`],
    [],
    ['道次', '姓名', '成绩', '排名', '备注', '分段时间']
  ];

  const sorted = race.lanes.filter(l => l.time != null).sort((a, b) => a.time - b.time);

  sorted.forEach((l, i) => {
    const splits = l.lapTimes?.map(t => formatTime(t)).join(', ') || '';
    data.push([
      l.id + 1,
      l.name || `运动员${l.id + 1}`,
      formatTime(l.time),
      i + 1,
      '',
      splits
    ]);
  });

  const dnf = race.lanes.filter(l => l.time == null);
  dnf.forEach(l => {
    data.push([
      l.id + 1,
      l.name || `运动员${l.id + 1}`,
      l.dnf ? 'DNF' : 'DNS',
      '',
      l.dnf ? '未完成' : '未出发',
      ''
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [
    { wch: 8 }, { wch: 15 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 30 }
  ];

  return ws;
}

/**
 * 创建统计工作表
 */
function createStatsSheet(race, options = {}) {
  const { distance = 0 } = options;

  const finished = race.lanes.filter(l => l.time != null);
  const times = finished.map(l => l.time).filter(t => t != null);

  const data = [
    ['竞迹 JingJi 成绩统计'],
    [],
    ['统计项目', '数值'],
    ['参赛人数', race.lanes.length],
    ['完成人数', finished.length],
    ['未完成人数', race.lanes.length - finished.length],
  ];

  if (times.length > 0) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    data.push(
      ['最快成绩', formatTime(min)],
      ['最慢成绩', formatTime(max)],
      ['平均成绩', formatTime(avg)]
    );

    // 配速计算（如果知道距离）
    if (distance > 0) {
      const pacePerKm = min / distance * 1000;
      data.push(['冠军配速', `${formatTime(pacePerKm)}/km']);
    }
  }

  data.push([], ['生成时间', new Date().toLocaleString('zh-CN')]);

  return XLSX.utils.aoa_to_sheet(data);
}

// ── PDF 导出 ─────────────────────────────────────────────

/**
 * 导出 PDF 格式（简化文本PDF）
 */
function exportPDF(race, options = {}) {
  const {
    orgName = '',
    raceName = '田径比赛',
    distance = 0,
    includeBest = true,
    includeLapTimes = true
  } = options;

  const sorted = race.lanes.filter(l => l.time != null).sort((a, b) => a.time - b.time);
  const dnf = race.lanes.filter(l => l.time == null);
  const medals = ['🥇', '🥈', '🥉'];
  const maxLaps = Math.max(0, ...race.lanes.map(l => l.lapTimes?.length || 0));

  // 构建简单的文本内容用于PDF
  let textLines = [];

  // 标题
  textLines.push(`═══ ${orgName || '田径比赛'} 成绩单 ═══`);
  textLines.push('');
  textLines.push(`比赛: ${raceName}`);
  textLines.push(`距离: ${distance}m`);
  textLines.push(`日期: ${race.date || new Date().toLocaleDateString('zh-CN')}`);
  textLines.push(`组别: 第 ${race.round || 1} 轮 · 第 ${race.group || 1} 组`);
  textLines.push('─'.repeat(40));

  // 冠军成绩
  if (includeBest && sorted.length > 0) {
    const best = sorted[0];
    textLines.push(`★ 冠军: ${best.name || '运动员1'} - ${formatTime(best.time)}`);
    textLines.push('─'.repeat(40));
  }

  // 成绩表
  textLines.push('【比赛成绩】');
  textLines.push('');

  // 表头
  let header = '名次    姓名';
  if (includeLapTimes && maxLaps > 1) {
    for (let i = 1; i <= maxLaps; i++) {
      header += `     第${i}圈`;
    }
  }
  header += '        成绩';
  textLines.push(header);
  textLines.push('─'.repeat(50));

  // 名次
  sorted.forEach((l, i) => {
    let line = `${i === 0 ? medals[0] : (i === 1 ? medals[1] : (i === 2 ? medals[2] : ` ${i + 1}.`))}   `;
    line += (l.name || `运动员${l.id + 1}`).padEnd(8);

    if (includeLapTimes && maxLaps > 1) {
      for (let j = 0; j < maxLaps; j++) {
        const lap = l.lapTimes?.[j];
        line += `   ${lap != null ? formatTime(lap).padStart(6) : '      -'}`;
      }
    }

    line += `   ${formatTime(l.time)}`;
    textLines.push(line);
  });

  // DNF
  if (dnf.length > 0) {
    textLines.push('');
    textLines.push('【未完成】');
    dnf.forEach(l => {
      textLines.push(`  ${(l.name || `运动员${l.id + 1}`).padEnd(10)}  ${l.dnf ? 'DNF' : 'DNS'}`);
    });
  }

  textLines.push('─'.repeat(50));
  textLines.push(`由 竞迹 JingJi 生成 · ${new Date().toLocaleString('zh-CN')}`);

  // 生成简单的PDF（纯文本）
  const pdfContent = generateSimplePDF(textLines.join('\n'));
  downloadBlob(pdfContent, generateFilename([orgName, raceName, `第${race.round}轮第${race.group}组`], 'pdf'), 'application/pdf');
}

/**
 * 生成简单PDF（文本型）
 */
function generateSimplePDF(text) {
  // 使用 jsPDF CDN
  return new Promise((resolve) => {
    // 动态加载 jsPDF
    if (window.jspdf && window.jspdf.jsPDF) {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();

      doc.setFont('helvetica');
      doc.setFontSize(10);

      const lines = text.split('\n');
      let y = 20;

      lines.forEach(line => {
        if (y > 280) {
          doc.addPage();
          y = 20;
        }
        doc.text(line, 20, y);
        y += 6;
      });

      resolve(doc.output('arraybuffer'));
    } else {
      // 后备方案：生成文本文件
      resolve(new TextEncoder().encode(text).buffer);
    }
  });
}

// ── 分组合并导出 ─────────────────────────────────────────

/**
 * 导出多组成绩（合并PDF）
 */
async function exportMultiGroup(results, options = {}) {
  const { format = 'pdf' } = options;

  if (format === 'xlsx') {
    await loadSheetJS();
    const wb = XLSX.utils.book_new();

    results.forEach((race, i) => {
      const sheet = createResultsSheet(race);
      XLSX.utils.book_append_sheet(wb, sheet, `第${race.group}组`);
    });

    XLSX.writeFile(wb, `多组成绩_${Date.now()}.xlsx`);
  } else {
    // PDF - 简单合并
    let allText = '';
    results.forEach(race => {
      const sorted = race.lanes.filter(l => l.time != null).sort((a, b) => a.time - b.time);
      allText += `\n═══ 第 ${race.group} 组 ═══\n`;
      sorted.forEach((l, i) => {
        allText += `${i + 1}. ${l.name || '运动员'} - ${formatTime(l.time)}\n`;
      });
    });

    const blob = new Blob([allText], { type: 'text/plain' });
    downloadBlob(blob, `多组成绩_${Date.now()}`, 'text/plain');
  }
}

// ── 工具函数 ─────────────────────────────────────────────

/**
 * 下载 Blob
 */
function downloadBlob(blob, filename, mimeType) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── 导出绑定 ─────────────────────────────────────────────

/**
 * 初始化导出功能（绑定到 app.js）
 */
export function initExport(DOM, state) {
  // CSV 导出
  if (DOM.btnExportCsv) {
    DOM.btnExportCsv.addEventListener('click', () => {
      const history = JSON.parse(localStorage.getItem('jingji_history') || '[]');
      const race = history[0];
      if (!race) {
        showToast?.('暂无成绩可导出', 'warn');
        return;
      }
      exportCSV(race, {
        orgName: state.orgName,
        raceName: state.raceName,
        distance: state.distance
      });
    });
  }

  // XLSX 导出
  if (DOM.btnExportXlsx) {
    DOM.btnExportXlsx.addEventListener('click', async () => {
      const history = JSON.parse(localStorage.getItem('jingji_history') || '[]');
      const race = history[0];
      if (!race) {
        showToast?.('暂无成绩可导出', 'warn');
        return;
      }
      try {
        await exportXLSX(race, {
          orgName: state.orgName,
          raceName: state.raceName,
          distance: state.distance,
          includeBest: true,
          includeLapTimes: true
        });
      } catch (e) {
        console.error('XLSX export failed:', e);
        showToast?.('导出失败，请重试', 'error');
      }
    });
  }

  // PDF 导出
  if (DOM.btnExportPdf) {
    DOM.btnExportPdf.addEventListener('click', () => {
      const history = JSON.parse(localStorage.getItem('jingji_history') || '[]');
      const race = history[0];
      if (!race) {
        showToast?.('暂无成绩可导出', 'warn');
        return;
      }
      exportPDF(race, {
        orgName: state.orgName,
        raceName: state.raceName,
        distance: state.distance,
        includeBest: true,
        includeLapTimes: true
      });
    });
  }
}

// 导出主要函数供外部调用
export { exportCSV, exportXLSX, exportPDF, exportMultiGroup, formatTime };
