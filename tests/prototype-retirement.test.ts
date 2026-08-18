import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

test('repository contains no Google Apps Script implementation', () => {
  expect(existsSync(new URL('../google-apps-script', import.meta.url))).toBe(false);

  const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .trim()
    .split('\n');
  expect(
    trackedFiles.filter(
      (path) =>
        existsSync(new URL(`../${path}`, import.meta.url)) &&
        (path.endsWith('.gs') || basename(path) === 'appsscript.json')
    )
  ).toEqual([]);
});

test('browser exposes no Student data routes', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const routes = [...appSource.matchAll(/path="([^"]+)"/g)].map((match) => match[1]);

  expect(routes).toEqual(['/prototype/school-configuration', '*']);
});
