// One release version: server/package.json is the source of truth.
// Run from any directory: node scripts/version.mjs check | bump patch|minor|major
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (root, file) => JSON.parse(read(root, file));
const valid = (version) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) && version.split('.').every((n) => Number(n) <= 65535);

export function nextVersion(current, kind) {
  if (!valid(current)) throw new Error(`Invalid release version: ${current}`);
  if (!['patch', 'minor', 'major'].includes(kind)) throw new Error('Choose patch, minor or major.');
  const [major, minor, patch] = current.split('.').map(Number);
  const next = kind === 'major' ? `${major + 1}.0.0` : kind === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
  if (!valid(next)) throw new Error('Release version exceeds Chrome manifest limits.');
  return next;
}

export function checkVersions(root = ROOT) {
  const version = json(root, 'server/package.json').version;
  const lock = json(root, 'server/package-lock.json');
  const values = {
    'extension/manifest.json': json(root, 'extension/manifest.json').version,
    'extension/content/main.js': read(root, 'extension/content/main.js').match(/AP\.VERSION = '([^']+)'/)?.[1],
    'server/package-lock.json': lock.version,
    'server/package-lock.json (root package)': lock.packages?.['']?.version,
    'README.md badge': read(root, 'README.md').match(/version-(\d+\.\d+\.\d+)-blue/)?.[1],
  };
  const issues = Object.entries(values).filter(([, value]) => value !== version).map(([file, value]) => `${file}: ${value ?? 'missing'} (expected ${version})`);
  if (!valid(version)) issues.push(`Invalid server/package.json version: ${version}`);
  if (!read(root, 'CHANGELOG.md').includes(`## [${version}]`)) issues.push(`CHANGELOG.md: missing ${version} release section`);
  return { version, issues };
}

export function bumpVersion(kind, root = ROOT) {
  const pkg = json(root, 'server/package.json');
  const version = nextVersion(pkg.version, kind);
  const lock = json(root, 'server/package-lock.json');
  const manifest = json(root, 'extension/manifest.json');
  let content = read(root, 'extension/content/main.js');
  let readme = read(root, 'README.md');
  let changelog = read(root, 'CHANGELOG.md');
  // Validate all expected markers before writing anything.
  if (!/AP\.VERSION = '[^']+';/.test(content) || !/version-\d+\.\d+\.\d+-blue/.test(readme) || !lock.packages?.['']) throw new Error('Missing release metadata; no files were changed.');
  pkg.version = manifest.version = lock.version = lock.packages[''].version = version;
  content = content.replace(/AP\.VERSION = '[^']+';/, `AP.VERSION = '${version}';`);
  readme = readme.replace(/version-\d+\.\d+\.\d+-blue/, `version-${version}-blue`);
  if (!changelog.includes(`## [${version}]`)) {
    const position = changelog.indexOf('\n## ');
    if (position < 0) throw new Error('Missing changelog headings; no files were changed.');
    changelog = `${changelog.slice(0, position)}\n\n## [${version}]\n\n- Document this release before publishing.\n${changelog.slice(position)}`;
  }
  for (const [file, data] of [
    ['server/package.json', JSON.stringify(pkg, null, 2) + '\n'],
    ['server/package-lock.json', JSON.stringify(lock, null, 2) + '\n'],
    ['extension/manifest.json', JSON.stringify(manifest, null, 2) + '\n'],
    ['extension/content/main.js', content], ['README.md', readme], ['CHANGELOG.md', changelog],
  ]) fs.writeFileSync(path.join(root, file), data);
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command, kind, ...rest] = process.argv.slice(2);
    if (rest.length || !['check', 'bump'].includes(command) || (command === 'check' && kind)) throw new Error('Usage: node scripts/version.mjs check | bump patch|minor|major');
    if (command === 'bump') console.log(`Bumped to ${bumpVersion(kind)}. Update CHANGELOG.md, run tests, then publish a new tag.`);
    const { version, issues } = checkVersions();
    if (issues.length) throw new Error(issues.join('\n'));
    console.log(`ApplyPilot v${version}: release versions agree.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
