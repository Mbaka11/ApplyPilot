import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, checkVersions, nextVersion, bumpVersion } from '../scripts/version.mjs';

let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`  ✓ ${name}`); }
check('all production release numbers and changelog agree', () => assert.deepEqual(checkVersions().issues, []));
check('SemVer increments reset less significant components', () => {
  assert.equal(nextVersion('0.4.0', 'patch'), '0.4.1');
  assert.equal(nextVersion('0.4.8', 'minor'), '0.5.0');
  assert.equal(nextVersion('0.4.8', 'major'), '1.0.0');
  assert.throws(() => nextVersion('00.4.0', 'patch'));
  assert.throws(() => nextVersion('0.4.0', 'typo'));
  assert.throws(() => nextVersion('65535.0.0', 'major'));
});
const temp = path.join(ROOT, 'tests', 'output', 'versions');
fs.rmSync(temp, { recursive: true, force: true });
for (const file of ['server/package.json', 'server/package-lock.json', 'extension/manifest.json', 'extension/content/main.js', 'README.md', 'CHANGELOG.md']) {
  fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, file), path.join(temp, file));
}
check('a bump synchronizes every file and opens a new changelog section', () => {
  const current = checkVersions(temp).version;
  const next = bumpVersion('patch', temp);
  assert.equal(next, nextVersion(current, 'patch'));
  assert.deepEqual(checkVersions(temp).issues, []);
  assert.ok(fs.readFileSync(path.join(temp, 'CHANGELOG.md'), 'utf8').includes(`## [${next}]`));
});
check('an accidental stale manifest is rejected', () => {
  const file = path.join(temp, 'extension', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.version = '0.0.1';
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.ok(checkVersions(temp).issues.some((issue) => issue.startsWith('extension/manifest.json:')));
});
console.log(`\n${checks} version-management checks passed.`);
