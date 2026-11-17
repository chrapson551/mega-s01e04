import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('gives 5 jobs sorted by job and 1 bad line', () => {
    expect(night).not.toBeNull();
    expect(night!.night).toBe('2026-10-28');
    expect(night!.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night!.badLines).toBe(1);
  });

  it('counts parsed lines per status', () => {
    expect(night!.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('builds one row per job', () => {
    const byJob = Object.fromEntries(night!.rows.map((r) => [r.job, r]));
    expect(byJob['fixtures/refresh']).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      fails: 0,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(byJob['lane/sync']).toMatchObject({
      runs: 8,
      retries: 1,
      fails: 0,
      lastStatus: 'ok',
      lastError: 'lock held',
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
    expect(byJob['notes/backup']).toMatchObject({ runs: 1, fails: 1, lastStatus: 'fail', lastError: 'quota exceeded' });
    expect(byJob['digest/render']).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok', lastError: null });
    expect(byJob['rig/rotate-logs']).toMatchObject({ owner: 'lane-07', runs: 1, lastError: null });
  });
});

describe('readNight edge cases', () => {
  let dir: string;
  const write = (name: string, text: string) => writeFileSync(join(dir, name), text);

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-digest-read-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the file does not exist', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('returns null when the runs dir does not exist', () => {
    expect(readNight(join(dir, 'nope'), '2026-01-01')).toBeNull();
  });

  it('gives a Night with no rows for an empty file', () => {
    write('2026-01-02.jsonl', '');
    expect(readNight(dir, '2026-01-02')).toEqual({
      night: '2026-01-02',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('does not count blank lines or a trailing newline as bad', () => {
    write('2026-01-03.jsonl', '\n{"at":"t1","job":"a","status":"ok","owner":"x"}\n\n   \n');
    const night = readNight(dir, '2026-01-03');
    expect(night!.badLines).toBe(0);
    expect(night!.rows).toHaveLength(1);
  });

  it('keeps a row whose owner is null', () => {
    write('2026-01-04.jsonl', '{"at":"t1","job":"a","status":"ok","owner":null}\n');
    expect(readNight(dir, '2026-01-04')!.rows).toEqual([
      {
        job: 'a',
        owner: null,
        runs: 1,
        retries: 0,
        fails: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: 't1',
        lastAt: 't1',
      },
    ]);
  });

  it('counts invalid lines as bad, never throws', () => {
    write(
      '2026-01-05.jsonl',
      [
        'not json',
        '[]',
        'null',
        '{"job":"a","status":"ok","owner":"x"}',
        '{"at":"t","status":"ok","owner":"x"}',
        '{"at":"t","job":"a","status":"done","owner":"x"}',
        '{"at":"t","job":"a","status":"ok"}',
        '{"at":"t","job":"a","status":"ok","owner":5}',
        '{"at":"t","job":"a","status":"ok","owner":"x","error":42}',
        '{"at":"t","job":"a","status":"fail","owner":"x","error":"boom"}',
      ].join('\n'),
    );
    const night = readNight(dir, '2026-01-05')!;
    expect(night.badLines).toBe(9);
    expect(night.counts).toEqual({ ok: 0, retry: 0, fail: 1 });
    expect(night.rows).toHaveLength(1);
  });

  it('uses the latest line for owner and status, file order', () => {
    write(
      '2026-01-06.jsonl',
      [
        '{"at":"t1","job":"b","status":"retry","owner":"x","error":"e1"}',
        '{"at":"t2","job":"a","status":"ok","owner":"y"}',
        '{"at":"t3","job":"b","status":"fail","owner":null,"error":"e2"}',
        '{"at":"t4","job":"b","status":"ok","owner":"z"}',
      ].join('\r\n'),
    );
    const night = readNight(dir, '2026-01-06')!;
    expect(night.rows.map((r) => r.job)).toEqual(['a', 'b']);
    expect(night.rows[1]).toEqual({
      job: 'b',
      owner: 'z',
      runs: 3,
      retries: 1,
      fails: 1,
      lastStatus: 'ok',
      lastError: 'e2',
      firstAt: 't1',
      lastAt: 't4',
    });
  });

  it.each(['../2026-10-28', '2026-10-28/', '2026-1-28', '2026-13-01', '2026-02-30', '', 'latest', ' 2026-10-28'])(
    'returns null for an invalid night %j',
    (night) => {
      expect(readNight('runs', night)).toBeNull();
    },
  );

  it('does not follow a traversal even when the target exists', () => {
    write('2026-01-07.jsonl', '{"at":"t","job":"a","status":"ok","owner":"x"}\n');
    expect(readNight(join(dir, 'sub'), '../2026-01-07')).toBeNull();
  });
});
