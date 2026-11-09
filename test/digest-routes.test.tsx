import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/read.js';

// Fixtures live in a temp dir written by this test. runs/ is never touched.
const FULL = '2026-02-01';
const EMPTY = '2026-02-02';
const BAD = '2026-02-03';
const MISSING = '2026-02-09';

const lines = (...rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

let runsDir = '';

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  writeFileSync(
    join(runsDir, `${FULL}.jsonl`),
    lines(
      { at: '2026-02-01T23:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' },
      { at: '2026-02-01T23:01:00+01:00', job: 'digest/render', status: 'ok', owner: null },
      { at: '2026-02-01T23:02:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' },
      { at: '2026-02-01T23:03:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' },
      { at: '2026-02-01T23:04:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' },
      { at: '2026-02-01T23:05:00+01:00', job: 'fixtures/refresh', status: 'ok', owner: 'rook' },
      { at: '2026-02-01T23:06:00+01:00', job: 'notes/backup', status: 'fail', owner: 'lane', error: 'quota exceeded' },
    ),
  );
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(
    join(runsDir, `${BAD}.jsonl`),
    lines({ at: '2026-02-03T23:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' }) +
      '{"at":"2026-02-03T23:01:00+01:00","job":"lane/sy\n',
  );
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

const app = () =>
  createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });

/** The HTML of the table row that holds `job`, from its <tr> to its </tr>. */
function rowHtml(html: string, job: string): string {
  const at = html.indexOf(job);
  const start = html.lastIndexOf('<tr', at);
  const end = html.indexOf('</tr>', at);
  return html.slice(start, end);
}

describe('GET /digest/:night (page)', () => {
  it('200 for a night with a file, with each job name', async () => {
    const res = await app().request(`/digest/${FULL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    for (const job of ['lane/sync', 'digest/render', 'fixtures/refresh', 'notes/backup']) {
      expect(html).toContain(job);
    }
  });

  it('marks a row with 3 retries or a fail as warn', async () => {
    const html = await (await app().request(`/digest/${FULL}`)).text();
    expect(rowHtml(html, 'fixtures/refresh')).toMatch(/\bwarn\b/);
    expect(rowHtml(html, 'notes/backup')).toMatch(/\bwarn\b/);
  });

  it('renders a null owner as an em dash', async () => {
    const html = await (await app().request(`/digest/${FULL}`)).text();
    expect(rowHtml(html, 'digest/render')).toContain('—');
  });

  it('404 for a night with no file, naming the night', async () => {
    const res = await app().request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain(`no run log for ${MISSING}`);
  });

  it('empty file: 200 and says nothing ran', async () => {
    const res = await app().request(`/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('a bad line: 200, the good rows render, and the bad line is counted', async () => {
    const res = await app().request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('lane/sync');
    expect(html).toContain("1 line didn't parse");
  });
});

describe('GET /api/digest/:night (JSON)', () => {
  it('200 with the Night object exactly as readNight returns it', async () => {
    const res = await app().request(`/api/digest/${FULL}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(readNight(runsDir, FULL));
  });

  it('404 for a night with no file', async () => {
    const res = await app().request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: MISSING });
  });

  it('empty file: 200, no rows, no bad lines', async () => {
    const res = await app().request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: EMPTY, rows: [], badLines: 0 });
  });

  it('a bad line: badLines is 1', async () => {
    const res = await app().request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { badLines: number };
    expect(body.badLines).toBe(1);
  });

  it('job order matches the order of the jobs on the HTML page', async () => {
    const json = (await (await app().request(`/api/digest/${FULL}`)).json()) as {
      rows: { job: string }[];
    };
    const html = await (await app().request(`/digest/${FULL}`)).text();
    const positions = json.rows.map((r) => html.indexOf(r.job));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
