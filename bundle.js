import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 打包所有模块到一个 IIFE
const modules = {
  './timer.js': 'js/timer.js',
  './audio.js': 'js/audio.js', 
  './recorder.js': 'js/recorder.js',
  './sync2.js': 'js/sync2.js',
  './finishline.js': 'js/finishline.js',
  './api-client.js': 'js/api-client.js',
  './export.js': 'js/export.js',
  './i18n.js': 'js/i18n.js',
};

let bundle = `// 竞迹计时器 - 打包版本 (自动生成)
`;

Object.entries(modules).forEach(([importPath, filePath]) => {
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf-8');
    // 移除 import/export 语句
    const cleaned = content
      .replace(new RegExp(`import\s+.*from\s+['"]${importPath}['"]\s*;?`, 'g'), '')
      .replace(new RegExp(`export\s+(const|let|var|function|class)\s+`, 'g'), 'const ')
      .replace(/export\s+{\s*([\w,\s]+)\s*}\s*;/g, '')
      .replace(/export\s+default\s+/g, '// default: ')
      .replace(/^export\s+/gm, '// export: ');
    bundle += `\n// ── ${filePath} ──────────────────────────\n` + cleaned + '\n';
  }
});

// 移除 app.js 的 import 语句
const appContent = readFileSync('js/app.js', 'utf-8');
const appCleaned = appContent
  .replace(/^import\s+.*from\s+['"][^'"]+['"]\s*;?\s*$/gm, '');

bundle += `\n// ── js/app.js (主程序) ──────────────────────\n` + appCleaned;

writeFileSync('dist/app-bundled.js', bundle, 'utf-8');
console.log('打包完成: dist/app-bundled.js');
