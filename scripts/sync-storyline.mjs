/**
 * sync-storyline.mjs
 *
 * Pre-build script that ensures the StoryLine submodule is checked out at the
 * latest tagged release and validates that the expected model interfaces still
 * exist.  Run via `npm run sync-sl-models`.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const slDir = path.join(root, 'vendor', 'storyline');

// ── 1.  Make sure the submodule directory exists ────────────────────
if (!existsSync(slDir)) {
  console.error('❌  vendor/storyline not found. Run `git submodule update --init --recursive`.');
  process.exit(1);
}

// ── 2.  Check out the latest tagged release ─────────────────────────
try {
  const latestTag = execSync('git describe --tags --abbrev=0', { cwd: slDir, encoding: 'utf-8' }).trim();
  if (latestTag) {
    execSync(`git checkout ${latestTag}`, { cwd: slDir, stdio: 'pipe' });
    console.log(`✅  StoryLine submodule pinned to tag: ${latestTag}`);
  } else {
    console.log('⚠️  No tags found in StoryLine repo — using current commit.');
  }
} catch {
  console.log('⚠️  Could not determine latest tag — using current commit.');
}

// ── 3.  Validate expected model files exist ─────────────────────────
const expectedModels = [
  'models/Scene.ts',
  'models/Character.ts',
  'models/Location.ts',
  'models/StoryLineProject.ts',
  'models/PlotGridData.ts',
];

let allPresent = true;
for (const model of expectedModels) {
  const full = path.join(slDir, model);
  if (!existsSync(full)) {
    console.error(`❌  Missing expected model file: vendor/storyline/${model}`);
    allPresent = false;
  }
}

if (!allPresent) {
  console.error('StoryLine model validation failed. Check that the submodule is correct.');
  process.exit(1);
}

console.log('✅  All StoryLine model files present.');
