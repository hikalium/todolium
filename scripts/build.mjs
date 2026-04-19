import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

copyFileSync('index.css', 'dist/index.css');
copyFileSync('generated/src/engine.js', 'dist/engine.js');
copyFileSync('client.js', 'dist/client.js');

// Make client.js a module (it now imports engine.js directly)
const html = readFileSync('index.html', 'utf-8')
  .replace('<script src="client.js"></script>', '<script type="module" src="client.js"></script>');
writeFileSync('dist/index.html', html);

console.log('Build complete → dist/');
