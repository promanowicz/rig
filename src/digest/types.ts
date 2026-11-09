// Plan morning-digest § 1. The contract every part of § 2 builds against.

export type RunStatus = 'ok' | 'retry' | 'fail';

/** One line of runs/<night>.jsonl, after parsing at the edge. */
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

/** One row per job for the night. Times keep the log's offset (styleguide). */
export type DigestRow = {
  job: string;
  /** Last non-null owner seen for the job; `null` renders as `—`. */
  owner: string | null;
  /** Lines for this job, any status. */
  runs: number;
  /** Lines with status `retry`. */
  retries: number;
  /** Status of the job's last line. */
  lastStatus: RunStatus;
  /** Most recent `error` seen for the job, or `null` if none. */
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string;
  /** Sorted by job. The page and the JSON both use this order (ADR 0001). */
  rows: DigestRow[];
  /** Non-empty lines that did not parse into a RunLine. Counted, never thrown. */
  badLines: number;
};

/**
 * Reads runs/<night>.jsonl. Returns `null` when the night has no file (or the night is not a
 * YYYY-MM-DD date), so routes can answer 404. An empty file gives `rows: []`.
 */
export type ReadNight = (runsDir: string, night: string) => Night | null;
