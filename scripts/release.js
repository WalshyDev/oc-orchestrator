#!/usr/bin/env node

const { execFileSync } = require('node:child_process');

const releaseType = process.argv[2];
const allowedReleaseTypes = new Set(['patch', 'minor', 'major']);

if (!allowedReleaseTypes.has(releaseType)) {
  console.error(`Expected release type to be one of: ${Array.from(allowedReleaseTypes).join(', ')}`);
  process.exit(1);
}

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

const gitStatus = execFileSync('git', ['status', '--porcelain'], {
  encoding: 'utf8',
}).trim();

if (gitStatus) {
  console.error('Release requires a clean git working tree.');
  process.exit(1);
}

run('npm', ['run', 'typecheck']);
run('npm', ['test']);
run('npm', ['version', releaseType, '--no-git-tag-version']);

const version = execFileSync('node', ['-p', "require('./package.json').version"], {
  encoding: 'utf8',
}).trim();

run('git', ['add', 'package.json', 'package-lock.json']);
run('git', ['commit', '-m', version]);
