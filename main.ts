// token-radar-01's entry point (Node 22, standard library only, no network).
//
// One run reads the sealed snapshot, applies lib/model.ts to every protocol, checks the board it built,
// then writes the whole hand-in to the output directory: board.json, data.js for the static dashboard,
// copies of dashboard/ and screenshots/, and the make.fun dossier the judge reads.
//
// The output directory is /output under the grader; MAKEFUN_OUTPUT_DIR stands in anywhere else:
//   mkdir -p out
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
//   MAKEFUN_OUTPUT_DIR=out node main.ts --check --input ../token-radar-01-kit/input/snapshot.json
//
// --check reads the board already on disk and re-runs the gate's rules against it without writing.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardRow } from './lib/model.ts';
import { boardIssue, buildRadar, dataScript, parseSnapshot, setAside } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps: the text cap shapes the dossier bytes, the rest only refuse. */
const DOSSIER_CAPS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};

/** The gate's board bounds. */
const MIN_ROWS = 100;
const MAX_ROWS = 4_000;
const MIN_STEPS = 3;
const MAX_STEPS = 12;
const MIN_STEP_CHARS = 20;
const MAX_STEP_CHARS = 600;

const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MIN_SCREENSHOTS = 3;

/** Read `--name value` or `--name=value`; otherwise the fallback. */
function option(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const withEquals = args.find((a) => a.startsWith(`--${name}=`));
  if (withEquals !== undefined) return withEquals.slice(name.length + 3);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  return fallback;
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/**
 * The timestamp for data.js. SOURCE_DATE_EPOCH (seconds, the reproducible-builds variable) wins so two
 * runs can produce identical bytes; without it the snapshot's own as_of date is the stamp. Date.now() is
 * never used, so the file never changes just because it was written at a different moment.
 */
function generatedAt(asOf: string): string {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch !== undefined && epoch.trim() !== '') {
    const seconds = Number(epoch);
    if (Number.isFinite(seconds)) {
      const when = new Date(seconds * 1_000);
      if (!Number.isNaN(when.getTime())) return when.toISOString();
    }
  }
  return new Date(`${asOf}T00:00:00.000Z`).toISOString();
}

/** A whole-dollar figure for the one-line summary. */
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * The gate rules lib/model.ts does not already enforce: the board's size and that every farm step is a
 * string whose own bytes are trimmed. Returns the first problem, or null.
 */
function extraBoardIssue(board: BoardRow[]): string | null {
  if (board.length < MIN_ROWS || board.length > MAX_ROWS) {
    return `the board has ${board.length} rows; the gate takes ${MIN_ROWS}..${MAX_ROWS}`;
  }
  for (const row of board) {
    if (!Array.isArray(row.farm_steps)) return `${row.slug} has no farm_steps array`;
    for (const step of row.farm_steps) {
      if (typeof step !== 'string') return `${row.slug} has a farm step that is not a string`;
      if (step !== step.trim()) return `${row.slug} has an untrimmed farm step: ${JSON.stringify(step.slice(0, 48))}`;
    }
  }
  return null;
}

/** The full gate check: the model's own boardIssue first, then the extra bounds. */
function gateIssue(board: BoardRow[], snapshot: ReturnType<typeof parseSnapshot>): string | null {
  const issue = boardIssue(board, snapshot);
  if (issue !== null) return issue;
  return extraBoardIssue(board);
}

/** Copy one directory's plain files into `to`, skipping dot files. Returns the names copied. */
function copyPlainFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    names.push(name);
  }
  return names;
}

/** Read board.json back as rows, refusing a file that is not the board's shape. */
function readWrittenBoard(path: string): BoardRow[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`check: ${path} is not readable JSON`);
  }
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { rows?: unknown }).rows)) {
    fail(`check: ${path} has no rows array`);
  }
  return (raw as { rows: BoardRow[] }).rows;
}

const inputArg = option('input', '/input');
const snapshotFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotFile)) {
  fail(`no snapshot at ${snapshotFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}

const outDir = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));

// ---- check mode: validate what is already on disk, write nothing ----
if (process.argv.includes('--check')) {
  const boardPath = join(outDir, 'board.json');
  if (!existsSync(boardPath)) {
    fail(`check: there is no board at ${boardPath}; run main.ts once without --check first`);
  }
  const written = readWrittenBoard(boardPath);
  const issue = gateIssue(written, snapshot);
  if (issue !== null) fail(`check: the written board fails the gate: ${issue}`);
  const covered = snapshot.watchlist.filter((slug) => written.some((r) => r.slug === slug)).length;
  process.stdout.write(
    `token radar check: ${written.length} rows, ranks 1..${written.length}, implied values non-increasing and not all equal, ` +
      `watchlist ${covered}/${snapshot.watchlist.length}, farm steps ${MIN_STEPS}..${MAX_STEPS} strings of ${MIN_STEP_CHARS}..${MAX_STEP_CHARS} trimmed characters: ok\n`,
  );
  process.exit(0);
}

// ---- build ----
const { board, radar } = buildRadar(snapshot);
const issue = gateIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

const excluded = setAside(snapshot);
const pageData = { ...radar, set_aside: excluded };

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(
  join(outDir, 'data.js'),
  `// generated ${generatedAt(snapshot.as_of)} by main.ts\n${dataScript(pageData)}`,
);

const dashboardFiles = copyPlainFiles(join(root, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyPlainFiles(join(root, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < MIN_SCREENSHOTS) {
  fail(
    `screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in ${MIN_SCREENSHOTS}, ` +
      'the board, a detail view and a filtered view',
  );
}
for (const name of shots) {
  if (!SCREENSHOT_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// The dossier is written last: the scorer rebuilds it from this output and compares the bytes.
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, DOSSIER_CAPS));

// ---- one compact summary ----
const boardSlugs = new Set(board.map((r) => r.slug));
const covered = snapshot.watchlist.filter((slug) => boardSlugs.has(slug)).length;
const top = board[0];
process.stdout.write(
  `token radar: ${board.length} rows, watchlist ${covered}/${snapshot.watchlist.length}, ` +
    `top ${top === undefined ? 'none' : `${top.name} at ${dollars.format(top.implied_value_usd)}`}\n`,
);
process.stdout.write(
  `token radar: wrote board.json, data.js, dashboard/ (${dashboardFiles.length} files), ` +
    `screenshots/ (${shots.length} images) and dossier.json to ${outDir}\n`,
);
