import fs from 'fs';

// 需要打包的模块
const modules = [
    'js/state.js',
    'js/storage.js', 
    'js/timer.js',
    'js/audio.js',
    'js/recorder.js',
    'js/sync2.js',
    'js/finishline.js',
    'js/api-client.js',
    'js/export.js',
    'js/i18n.js'
];

let bundle = `// 竞迹计时器 - 打包版本 v2\n(function() {
`;

for (const file of modules) {
    if (fs.existsSync(file)) {
        let content = fs.readFileSync(file, 'utf8');
        // 移除 import/export 语句
        content = content.replace(/^import .+ from .+;$/gm, '');
        content = content.replace(/^export (.+)/gm, '$1');
        bundle += `\n// ====== ${file} ======\n${content}\n`;
    }
}

// 添加 app.js
bundle += `\n// ====== app.js ======\n${fs.readFileSync('js/app.js', 'utf8')}`;

bundle += `
// 启动应用
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
})();
`;

fs.writeFileSync('js/bundle-all.js', bundle);
console.log('打包完成: js/bundle-all.js', bundle.length, '字节');
