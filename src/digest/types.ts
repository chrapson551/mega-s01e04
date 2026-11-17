// Plan morning-digest § 1. The contract every part of § 2 builds on: the reader (#2) implements
// `readNight` in `src/digest/read.ts`; the page, the JSON, the board link and the route tests use
// these types and that one function, so the page and the JSON can never disagree (ADR 0001).

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, as written by the lane.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job for the night.
export type DigestRow = {
  job: string;
  // Owner on the job's latest line. `null` is kept; views show it as `—`.
  owner: string | null;
  // Lines for this job.
  runs: number;
  // Lines with status `retry`.
  retries: number;
  // Lines with status `fail`.
  fails: number;
  // Status of the job's latest line.
  lastStatus: RunStatus;
  // `error` of the latest line that has one, else null.
  lastError: string | null;
  // `at` of the job's first and latest line.
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string;
  // Sorted by job. The page and the JSON both show them in this order.
  rows: DigestRow[];
  // Lines that did not parse as a run line. Counted, never thrown.
  badLines: number;
  // Parsed lines per status, for the status board link.
  counts: Record<RunStatus, number>;
};

// `night` is `YYYY-MM-DD`. Returns null when there is no runs/<night>.jsonl (or the night is not
// a valid date string), so routes can answer 404. An empty file gives a Night with no rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;

// A row the page marks: retries of 3 or more, or any `fail`.
export function needsAttention(row: DigestRow): boolean {
  return row.retries >= 3 || row.fails > 0;
}
