const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function tests(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? tests(target) : entry.name.endsWith('.test.js') ? [target] : [];
  });
}
const result = spawnSync(process.execPath, ['--test', ...tests(root)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
