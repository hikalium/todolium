import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

copyFileSync('index.css', 'dist/index.css');
copyFileSync('generated/src/engine.js', 'dist/engine.js');
copyFileSync('node_modules/humanize-duration/humanize-duration.js', 'dist/humanize-duration.js');
copyFileSync('client.js', 'dist/client.js');

// Strip Socket.IO script tag and make client.js a module
const html = readFileSync('index.html', 'utf-8')
  .replace('  <script src="/socket.io/socket.io.js"></script>\n', '')
  .replace('<script src="client.js"></script>', '<script type="module" src="client.js"></script>');
writeFileSync('dist/index.html', html);

console.log('Build complete → dist/');
