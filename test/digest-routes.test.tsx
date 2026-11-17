import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

const line = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify({ at, job, status, owner, ...(error ? { error } : {}) });

// Jobs deliberately written out of order, so "sorted by job" is checked.
const MAIN =
  [
    line('2026-11-01T23:00:00+01:00', 'zeta/cleanup', 'ok', 'rook'),
    line('2026-11-01T23:05:00+01:00', 'alpha/sync', 'retry', 'lane-07'),
    line('2026-11-01T23:06:00+01:00', 'alpha/sync', 'ok', 'lane-07'),
    line('2026-11-01T23:10:00+01:00', 'mid/orphan', 'ok', null),
    line('2026-11-01T23:15:00+01:00', 'beta/export', 'fail', 'rook', 'disk full'),
  ].join('\n') + '\n';
const MAIN_JOBS = ['alpha/sync', 'beta/export', 'mid/orphan', 'zeta/cleanup'];

const BAD =
  [
    line('2026-11-02T01:00:00+01:00', 'good/one', 'ok', 'rook'),
    'this is not json {',
    line('2026-11-02T01:05:00+01:00', 'good/two', 'ok', 'rook'),
  ].join('\n') + '\n';

let dir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-digest-'));
  fs.writeFileSync(path.join(dir, '2026-11-01.jsonl'), MAIN);
  fs.writeFileSync(path.join(dir, '2026-11-02.jsonl'), BAD);
  fs.writeFileSync(path.join(dir, '2026-11-03.jsonl'), '');
  app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: dir });
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const positions = (html: string, names: string[]) => names.map((n) => html.indexOf(n));
const inOrder = (pos: number[]) => pos.every((p) => p >= 0) && [...pos].sort((a, b) => a - b).join() === pos.join();

describe('GET /digest/:night', () => {
  it('renders 200 HTML with the lane banner and one table, jobs sorted', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const res = await app.request('/digest/2026-11-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('TEST-MARKER');
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(inOrder(positions(html, MAIN_JOBS))).toBe(true);
  });

  it('shows "no marker set" when LANE_MARKER is unset', async () => {
    delete process.env.LANE_MARKER;
    const html = await (await app.request('/digest/2026-11-01')).text();
    expect(html).toContain('no marker set');
  });

  it('shows a null owner as an em dash', async () => {
    const html = await (await app.request('/digest/2026-11-01')).text();
    expect(html).toContain('—');
  });

  it('returns 404 for a night with no file', async () => {
    const res = await app.request('/digest/2026-11-30');
    expect(res.status).toBe(404);
  });

  it('says "nothing ran" for the empty night', async () => {
    const res = await app.request('/digest/2026-11-03');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('still renders a night with a bad line', async () => {
    const res = await app.request('/digest/2026-11-02');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('good/one');
    expect(html).toContain('good/two');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns 200 JSON with night, rows, badLines and counts', async () => {
    const res = await app.request('/api/digest/2026-11-01');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as Night;
    expect(Object.keys(body).sort()).toEqual(['badLines', 'counts', 'night', 'rows']);
    expect(body.night).toBe('2026-11-01');
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => r.job)).toEqual(MAIN_JOBS);
    expect(body.rows.find((r) => r.job === 'mid/orphan')?.owner).toBeNull();
    expect(body.counts).toEqual({ ok: 3, retry: 1, fail: 1 });
  });

  it('lists the same jobs in the same order as the page', async () => {
    const body = (await (await app.request('/api/digest/2026-11-01')).json()) as Night;
    const html = await (await app.request('/digest/2026-11-01')).text();
    const jobs = body.rows.map((r) => r.job);
    expect(jobs).toEqual(MAIN_JOBS);
    expect(inOrder(positions(html, jobs))).toBe(true);
  });

  it('returns 404 for a night with no file', async () => {
    const res = await app.request('/api/digest/2026-11-30');
    expect(res.status).toBe(404);
  });

  it('returns 200 with no rows for the empty night', async () => {
    const res = await app.request('/api/digest/2026-11-03');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.rows).toEqual([]);
  });

  it('counts the bad line and keeps the good rows', async () => {
    const res = await app.request('/api/digest/2026-11-02');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['good/one', 'good/two']);
  });
});
