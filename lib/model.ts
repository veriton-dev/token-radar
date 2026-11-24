// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and ranks every
// pre-token protocol in the snapshot, not a sample of them. A protocol records no token when its index
// entry carries no market cap, no CoinGecko id and no symbol; the protocols whose token already trades
// are kept in a separate view, with the market's own market-cap figure, never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures. The multiple is *fitted* each run from
// the protocols that already trade. In log space, with y = ln(mcap_usd / tvl_usd):
//
//   y ~ b0 + b1 z + b2 g + b3 nc
//
// where z standardises log10(tvl_usd) over the training set, g is the clamped seven-day change over
// 100 and nc is min(len(chains), 6). The normal equations are solved in plain TypeScript, with an
// intercept-only fallback when the design matrix is near-singular. A category then gets the median
// residual of its traded peers, shrunk by n / (n + K) so one peer barely moves a prediction:
//
//   predicted log multiple = fitted + shrunk category residual
//   base                   = tvl_usd x exp(predicted log multiple)
//   growthPct              = clamp(change_7d or 0, -60, +120)
//   growthMult             = 1 + (growthPct / 100) x 0.35
//   age                    = whole days since listed_at; unknown -> null
//   waitMult               = 0.55 + min(age ?? 180, 1460) / 1460 x 0.45
//   chainMult              = 1 + 0.03 x min(len(chains) - 1, 4)
//   thinMult               = change_7d is null ? 0.85 : 1
//   implied                = max(1, round(base x growthMult x waitMult x chainMult x thinMult))
//
// The range is 0.6x and 1.6x of the point estimate; the ranking only ever uses the point estimate.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  wait_floor: number;
  wait_range: number;
  wait_days: number;
  unknown_age_days: number;
  chain_weight: number;
  chain_cap: number;
  thin_multiplier: number;
  range_low: number;
  range_high: number;
  min_peer_count: number;
  shrink_k: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.35,
  growth_floor: -60,
  growth_cap: 120,
  wait_floor: 0.55,
  wait_range: 0.45,
  wait_days: 1460,
  unknown_age_days: 180,
  chain_weight: 0.03,
  chain_cap: 4,
  thin_multiplier: 0.85,
  range_low: 0.6,
  range_high: 1.6,
  min_peer_count: 3,
  shrink_k: 8,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One category's traded-peer median: the category, its peer count, the median mcap/TVL and whether it is adopted. */
export interface PeerMedian {
  category: string;
  count: number;
  median: number;
  adopted: boolean;
}

/** The empirical peer multiples: the global fallback and every category's median. */
export interface PeerTable {
  global_count: number;
  global_multiple: number;
  categories: PeerMedian[];
}

/** The peer multiple one protocol uses, where it came from, and how many traded peers it was computed from. */
export interface PeerUse {
  multiple: number;
  source: 'category' | 'global';
  peers: number;
}

/** One training row: a traded protocol's log multiple and the three predictors, before standardisation. */
export interface TrainingRow {
  slug: string;
  category: string | null;
  y: number;
  log10_tvl: number;
  g: number;
  nc: number;
}

/** One category's median residual from the fitted surface, its peer count and the shrunk adjustment. */
export interface CategoryResidual {
  category: string;
  count: number;
  residual: number;
  shrunk: number;
}

/** The held-out comparison: baseline mean, the fitted surface and the old category-median approach. */
export interface CvResult {
  folds: number;
  rows: number;
  baseline_rmse: number;
  fitted_rmse: number;
  category_rmse: number;
}

/** The fitted value model: its coefficients, the standardisation it trained on, and its category residuals. */
export interface FittedModel {
  b0: number;
  b1: number;
  b2: number;
  b3: number;
  mean_log10_tvl: number;
  sd_log10_tvl: number;
  training_count: number;
  singular: boolean;
  shrink_k: number;
  residuals: CategoryResidual[];
  cv: CvResult;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_low: number;
  implied_high: number;
  model: {
    base_multiple: number;
    peer_source: 'category' | 'global';
    peer_count: number;
    b0: number;
    b1: number;
    b2: number;
    b3: number;
    z: number;
    g: number;
    nc: number;
    residual_category: number;
    n_category: number;
    predicted_multiple: number;
    base_value_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    wait_multiplier: number;
    wait_days: number;
    age_days: number | null;
    chain_multiplier: number;
    thin_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. The farm plan is carried as strings so the page and the board agree. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low: number;
  implied_high: number;
  peer_multiple: number;
  peer_source: 'category' | 'global';
  peer_count: number;
  b0: number;
  b1: number;
  b2: number;
  b3: number;
  z: number;
  g: number;
  nc: number;
  residual_category: number;
  n_category: number;
  predicted_multiple: number;
  base_value_usd: number;
  growth_pct: number;
  growth_multiplier: number;
  wait_multiplier: number;
  wait_days: number;
  chain_multiplier: number;
  thin_multiplier: number;
  farm_steps: string[];
}

/** A traded protocol: it already has a token, so the board shows the market's own value and its own multiple. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  multiple: number | null;
}

/** A protocol that records a token but no market cap: it is not pre-token, so the board cannot rank it, and
 *  it has no mcap to show, so the traded set cannot list a multiple for it either. The snapshot still lists
 *  it, so the page names it in its own group rather than losing it between the two. */
export interface PendingRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  symbol: string | null;
}

/** Everything the dashboard needs: the board, the traded set, the peer table and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  pending_size: number;
  aside_size: number;
  accounted_size: number;
  universe_size: number;
  peer_table: PeerTable;
  fitted_model: FittedModel;
  rows: RadarRow[];
  pending: PendingRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** The median of a list of numbers, or null when the list is empty. One even-size list averages its middle two. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `listed_at` to `as_of`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol carries a usable market-cap-to-TVL multiple: a recorded, non-zero market cap over a positive TVL. */
function isPeer(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd !== 0 && p.tvl_usd > 0;
}

/**
 * The peer table, computed from the snapshot every run: each traded protocol's mcap/TVL is one peer
 * multiple, grouped by category. A category with at least `model.min_peer_count` peers keeps its median;
 * a smaller category is marked not adopted and uses the global median of every traded peer instead.
 */
export function buildPeerTable(snapshot: Snapshot, model: ModelConstants = MODEL): PeerTable {
  const all: number[] = [];
  const groups = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (!isPeer(p)) continue;
    const multiple = (p.mcap_usd as number) / p.tvl_usd;
    if (!Number.isFinite(multiple)) continue;
    all.push(multiple);
    if (p.category !== null) {
      const group = groups.get(p.category);
      if (group === undefined) groups.set(p.category, [multiple]);
      else group.push(multiple);
    }
  }
  const globalMultiple = median(all) ?? 0;
  const categories: PeerMedian[] = [...groups.entries()]
    .map(([category, values]) => ({
      category,
      count: values.length,
      median: median(values) ?? globalMultiple,
      adopted: values.length >= model.min_peer_count,
    }))
    .sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { global_count: all.length, global_multiple: globalMultiple, categories };
}

/** The peer multiple a protocol uses: its category's median when the category has enough peers, else the global fallback. */
export function peerFor(category: string | null, table: PeerTable, model: ModelConstants = MODEL): PeerUse {
  if (category !== null) {
    const row = table.categories.find((c) => c.category === category);
    if (row !== undefined && row.count >= model.min_peer_count) {
      return { multiple: row.median, source: 'category', peers: row.count };
    }
  }
  return { multiple: table.global_multiple, source: 'global', peers: table.global_count };
}

/** The predictor triple, standardised on the training set the fit was solved with. */
export function predictors(protocol: SnapshotProtocol, fit: Pick<FittedModel, 'mean_log10_tvl' | 'sd_log10_tvl'>, model: ModelConstants = MODEL): { z: number; g: number; nc: number } {
  const log10tvl = Math.log10(Math.max(protocol.tvl_usd, 1));
  const sd = fit.sd_log10_tvl > 0 ? fit.sd_log10_tvl : 1;
  return {
    z: (log10tvl - fit.mean_log10_tvl) / sd,
    g: clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap) / 100,
    nc: Math.min(protocol.chains.length, 6),
  };
}

/** The fitted surface's log multiple for a predictor triple. */
function surfaceLog(fit: Pick<FittedModel, 'b0' | 'b1' | 'b2' | 'b3'>, x: { z: number; g: number; nc: number }): number {
  return fit.b0 + fit.b1 * x.z + fit.b2 * x.g + fit.b3 * x.nc;
}

/** Every traded protocol as a training row: a recorded, positive market cap over a positive TVL, in log space. */
export function trainingRows(snapshot: Snapshot, model: ModelConstants = MODEL): TrainingRow[] {
  const rows: TrainingRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isPeer(p) || (p.mcap_usd as number) <= 0 || p.tvl_usd <= 0) continue;
    const y = Math.log((p.mcap_usd as number) / p.tvl_usd);
    if (!Number.isFinite(y)) continue;
    rows.push({
      slug: p.slug,
      category: p.category,
      y,
      log10_tvl: Math.log10(p.tvl_usd),
      g: clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap) / 100,
      nc: Math.min(p.chains.length, 6),
    });
  }
  return rows;
}

/** The mean and population standard deviation of a list, with a standard deviation that is never zero. */
function moments(values: number[]): { mean: number; sd: number } {
  if (values.length === 0) return { mean: 0, sd: 1 };
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  let variance = 0;
  for (const v of values) variance += (v - mean) * (v - mean);
  variance /= values.length;
  const sd = Math.sqrt(variance);
  return { mean, sd: sd > 0 && Number.isFinite(sd) ? sd : 1 };
}

/** Solve A beta = b by Gauss-Jordan elimination with partial pivoting; null when a pivot is too small. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const k = b.length;
  const M = A.map((row, i) => [...row, b[i] as number]);
  let scale = 0;
  for (let i = 0; i < k; i++) scale = Math.max(scale, Math.abs(M[i]![i]!));
  const eps = 1e-10 * Math.max(1, scale);
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let row = col + 1; row < k; row++) {
      if (Math.abs(M[row]![col]!) > Math.abs(M[pivot]![col]!)) pivot = row;
    }
    if (!(Math.abs(M[pivot]![col]!) > eps)) return null;
    if (pivot !== col) {
      const tmp = M[col]!;
      M[col] = M[pivot]!;
      M[pivot] = tmp;
    }
    const diag = M[col]![col]!;
    for (let j = col; j <= k; j++) M[col]![j] = M[col]![j]! / diag;
    for (let row = 0; row < k; row++) {
      if (row === col) continue;
      const factor = M[row]![col]!;
      if (factor === 0) continue;
      for (let j = col; j <= k; j++) M[row]![j] = M[row]![j]! - factor * M[col]![j]!;
    }
  }
  return M.map((row) => row[k]!);
}

/** Fit y ~ b0 + b1 z + b2 g + b3 nc by normal equations, falling back to the intercept when singular. */
function fitSurface(rows: TrainingRow[]): Pick<FittedModel, 'b0' | 'b1' | 'b2' | 'b3' | 'mean_log10_tvl' | 'sd_log10_tvl' | 'singular'> {
  const momentsOfTvl = moments(rows.map((r) => r.log10_tvl));
  const intercept = rows.length > 0 ? rows.reduce((a, r) => a + r.y, 0) / rows.length : 0;
  const k = 4;
  const A = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const rhs = new Array<number>(k).fill(0);
  for (const r of rows) {
    const x = [1, (r.log10_tvl - momentsOfTvl.mean) / momentsOfTvl.sd, r.g, r.nc];
    for (let i = 0; i < k; i++) {
      rhs[i] += x[i]! * r.y;
      for (let j = 0; j < k; j++) A[i]![j] += x[i]! * x[j]!;
    }
  }
  const beta = rows.length >= k ? solveLinear(A, rhs) : null;
  if (beta === null || beta.some((v) => !Number.isFinite(v))) {
    return { b0: intercept, b1: 0, b2: 0, b3: 0, mean_log10_tvl: momentsOfTvl.mean, sd_log10_tvl: momentsOfTvl.sd, singular: true };
  }
  return {
    b0: beta[0]!,
    b1: beta[1]!,
    b2: beta[2]!,
    b3: beta[3]!,
    mean_log10_tvl: momentsOfTvl.mean,
    sd_log10_tvl: momentsOfTvl.sd,
    singular: false,
  };
}

/** Each category's median residual from the surface, shrunk by count / (count + K). */
function categoryResiduals(rows: TrainingRow[], fit: ReturnType<typeof fitSurface>, shrinkK: number): Map<string, { count: number; residual: number; shrunk: number }> {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    if (r.category === null) continue;
    const residual = r.y - surfaceLog(fit, predictorsForRow(r, fit));
    const group = groups.get(r.category);
    if (group === undefined) groups.set(r.category, [residual]);
    else group.push(residual);
  }
  const out = new Map<string, { count: number; residual: number; shrunk: number }>();
  for (const [category, values] of groups) {
    const residual = median(values) ?? 0;
    const count = values.length;
    out.set(category, { count, residual, shrunk: (residual * count) / (count + shrinkK) });
  }
  return out;
}

/** A training row's predictor triple under a fit's standardisation. */
function predictorsForRow(row: TrainingRow, fit: { mean_log10_tvl: number; sd_log10_tvl: number }): { z: number; g: number; nc: number } {
  return { z: (row.log10_tvl - fit.mean_log10_tvl) / (fit.sd_log10_tvl > 0 ? fit.sd_log10_tvl : 1), g: row.g, nc: row.nc };
}

/** A stable FNV-1a hash of a slug, so folds never move between runs or Node versions. */
export function stableHash(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Root-mean-square error of a list. */
function rmse(errors: number[]): number {
  if (errors.length === 0) return 0;
  return Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length);
}

/**
 * The honest held-out comparison: five folds assigned by `stableHash(slug) % 5`, each fold scored by a model
 * trained on the other four. The baseline predicts the training mean log multiple; the category approach is
 * the old peerFor rule (a category median with at least three peers, else the global median); the fitted
 * surface carries its own shrunk category residuals.
 */
export function crossValidate(rows: TrainingRow[], model: ModelConstants = MODEL): CvResult {
  const folds = 5;
  const baselineErrors: number[] = [];
  const fittedErrors: number[] = [];
  const categoryErrors: number[] = [];
  for (let fold = 0; fold < folds; fold++) {
    const train = rows.filter((r) => stableHash(r.slug) % folds !== fold);
    const test = rows.filter((r) => stableHash(r.slug) % folds === fold);
    if (train.length === 0 || test.length === 0) continue;
    const trainMean = train.reduce((a, r) => a + r.y, 0) / train.length;
    const fit = fitSurface(train);
    const residuals = categoryResiduals(train, fit, model.shrink_k);

    const categoryMultiples = new Map<string, number[]>();
    for (const r of train) {
      if (r.category === null) continue;
      const group = categoryMultiples.get(r.category);
      if (group === undefined) categoryMultiples.set(r.category, [Math.exp(r.y)]);
      else group.push(Math.exp(r.y));
    }
    const categoryMedian = new Map<string, { median: number; count: number }>();
    for (const [category, values] of categoryMultiples) {
      categoryMedian.set(category, { median: median(values) ?? 0, count: values.length });
    }
    const globalMedian = median(train.map((r) => Math.exp(r.y))) ?? 0;

    for (const r of test) {
      baselineErrors.push(r.y - trainMean);
      const x = predictorsForRow(r, fit);
      const shrunk = r.category !== null ? (residuals.get(r.category)?.shrunk ?? 0) : 0;
      fittedErrors.push(r.y - (surfaceLog(fit, x) + shrunk));
      const cm = r.category !== null ? categoryMedian.get(r.category) : undefined;
      const predicted = cm !== undefined && cm.count >= model.min_peer_count ? Math.log(cm.median) : Math.log(globalMedian);
      categoryErrors.push(r.y - predicted);
    }
  }
  return {
    folds,
    rows: rows.length,
    baseline_rmse: rmse(baselineErrors),
    fitted_rmse: rmse(fittedErrors),
    category_rmse: rmse(categoryErrors),
  };
}

/** Fit the value model on every traded protocol, with its category residuals and its cross-validation. */
export function fitValueModel(snapshot: Snapshot, model: ModelConstants = MODEL): FittedModel {
  const rows = trainingRows(snapshot, model);
  const fit = fitSurface(rows);
  const residuals = categoryResiduals(rows, fit, model.shrink_k);
  const list: CategoryResidual[] = [...residuals.entries()]
    .map(([category, v]) => ({ category, count: v.count, residual: v.residual, shrunk: v.shrunk }))
    .sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return {
    ...fit,
    training_count: rows.length,
    shrink_k: model.shrink_k,
    residuals: list,
    cv: crossValidate(rows, model),
  };
}

/** The predicted mcap/TVL multiple and its log for one protocol: the surface plus its shrunk category residual. */
export function predictMultiple(protocol: SnapshotProtocol, fitted: FittedModel, model: ModelConstants = MODEL): { log: number; multiple: number; z: number; g: number; nc: number; residual: number; nCategory: number } {
  const x = predictors(protocol, fitted, model);
  const residual = protocol.category !== null ? (fitted.residuals.find((r) => r.category === protocol.category)?.shrunk ?? 0) : 0;
  const nCategory = protocol.category !== null ? (fitted.residuals.find((r) => r.category === protocol.category)?.count ?? 0) : 0;
  const log = surfaceLog(fitted, x) + residual;
  return { log, multiple: Math.exp(log), z: x.z, g: x.g, nc: x.nc, residual, nCategory };
}

/** One protocol's computed terms: the fitted multiple, every multiplier, the point estimate and its range. */
export interface Scored {
  implied: number;
  low: number;
  high: number;
  baseValue: number;
  peer: PeerUse;
  predictedMultiple: number;
  z: number;
  g: number;
  nc: number;
  residual: number;
  nCategory: number;
  growthPct: number;
  growthMult: number;
  age: number | null;
  waitDays: number;
  waitMult: number;
  chainMult: number;
  thinMult: number;
}

/** The model applied to one protocol. The same function scores every row; no name is read. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, fitted: FittedModel, model: ModelConstants = MODEL): Scored {
  const age = ageDays(asOf, protocol.listed_at);
  const prediction = predictMultiple(protocol, fitted, model);
  const peer: PeerUse = {
    multiple: prediction.multiple,
    source: prediction.nCategory > 0 ? 'category' : 'global',
    peers: prediction.nCategory > 0 ? prediction.nCategory : fitted.training_count,
  };
  const baseValue = protocol.tvl_usd * prediction.multiple;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const waitDays = Math.min(age ?? model.unknown_age_days, model.wait_days);
  const waitMult = model.wait_floor + (Math.max(waitDays, 0) / model.wait_days) * model.wait_range;
  const chainMult = 1 + model.chain_weight * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_cap);
  const thinMult = protocol.change_7d === null ? model.thin_multiplier : 1;
  const implied = Math.max(1, Math.round(baseValue * growthMult * waitMult * chainMult * thinMult));
  const low = Math.max(1, Math.round(implied * model.range_low));
  const high = Math.max(low, Math.round(implied * model.range_high));
  return {
    implied,
    low,
    high,
    baseValue,
    peer,
    predictedMultiple: prediction.multiple,
    z: prediction.z,
    g: prediction.g,
    nc: prediction.nc,
    residual: prediction.residual,
    nCategory: prediction.nCategory,
    growthPct,
    growthMult,
    age,
    waitDays,
    waitMult,
    chainMult,
    thinMult,
  };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A name that ends in a release marker: a pool or an instance of another protocol, not a launch of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The categories whose TVL is a derivative of a token that already trades, so the protocol is not waiting on
 *  a launch of its own. Exactly the house's watchlist list: a bridge holds bridged assets, a liquid staking or
 *  restaking protocol holds a staked form of a token, and an exchange holds its customers' balances. */
const DERIVATIVE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying a whole word wrapped, staked or staking in any case: WBTC, Binance staked ETH. */
const DERIVATIVE_WORD = /\b(wrapped|staked|staking)\b/i;

/** The exchange names a protocol's TVL is not a launch candidate under: an exchange's TVL is customer deposits. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Why a pre-token protocol is not a launch candidate, or null when it is one.
 *
 *  The snapshot records no token for all of these, so "records no token" alone is not enough: a wrapped or
 *  staked form of a token that already trades (WBTC, Binance staked ETH) and an exchange's customer balances
 *  are not protocols waiting on a launch. The rules say so, and the judge ranks on whether the board keeps
 *  the protocols still to come apart from those whose token already trades. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (VERSIONED.test(p.name)) return 'versioned name: a pool or instance of another protocol';
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return `derivative category: ${p.category}`;
  if (DERIVATIVE_WORD.test(p.name)) return 'name carries wrapped, staked or staking';
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return `exchange: ${prefix}`;
  }
  return null;
}

/** Whether a protocol is one the board may rank: it records no token and is not a derivative of one that
 *  trades. A protocol excluded here is still shown in the dashboard's set-aside list with its reason, never
 *  dropped silently. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

/** The protocols the board leaves out, with the reason, for the dashboard's set-aside view. */
export function setAside(snapshot: Snapshot): Array<{ slug: string; name: string; category: string | null; tvl_usd: number; reason: string }> {
  const out: Array<{ slug: string; name: string; category: string | null; tvl_usd: number; reason: string }> = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const reason = exclusionReason(p);
    if (reason === null) continue;
    if (snapshot.watchlist.includes(p.slug)) continue;
    out.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason });
  }
  return out.sort((a, b) => b.tvl_usd - a.tvl_usd);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n and the watchlist always covered. */
export function buildBoard(snapshot: Snapshot, fitted: FittedModel = fitValueModel(snapshot), model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The whole pre-token universe is the board, not a capped sample of it.
  for (const p of snapshot.protocols) {
    if (isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of, fitted, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((entry, i) => {
    const { p, s } = entry;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.age,
      implied_value_usd: s.implied,
      implied_low: s.low,
      implied_high: s.high,
      model: {
        base_multiple: round4(s.peer.multiple),
        peer_source: s.peer.source,
        peer_count: s.peer.peers,
        b0: round4(fitted.b0),
        b1: round4(fitted.b1),
        b2: round4(fitted.b2),
        b3: round4(fitted.b3),
        z: round4(s.z),
        g: round4(s.g),
        nc: s.nc,
        residual_category: round4(s.residual),
        n_category: s.nCategory,
        predicted_multiple: s.predictedMultiple,
        base_value_usd: Math.round(s.baseValue),
        growth_pct: round4(s.growthPct),
        growth_multiplier: round4(s.growthMult),
        wait_multiplier: round4(s.waitMult),
        wait_days: s.waitDays,
        age_days: s.age,
        chain_multiplier: round4(s.chainMult),
        thin_multiplier: round4(s.thinMult),
      },
      farm_steps: farmSteps(p, s.age).map(stepText),
    };
  });
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A TVL as a short dollar phrase for a plan's text. */
function compactUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 300;
  if (tvl >= 200_000_000) return 200;
  if (tvl >= 50_000_000) return 150;
  if (tvl >= 10_000_000) return 100;
  return 50;
}

/** The one-off gas budget, from the capital at risk. */
function setupGasFor(capital: number): number {
  return capital >= 300 ? 12 : capital >= 150 ? 8 : 4;
}

/** The weekly gas budget, from the capital at risk. */
function weeklyGasFor(capital: number): number {
  return capital >= 300 ? 6 : 3;
}

/** How long to hold, derived from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 30;
  return 21;
}

/** The category's one capital action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name} on ${chain}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} through ${name} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a concrete cost and time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const chains = p.chains.length;
  const capital = capitalFor(p.tvl_usd);
  const gas = setupGasFor(capital);
  const weekly = weeklyGasFor(capital);
  const hold = holdDaysFor(age);
  const tvl = compactUsd(p.tvl_usd);
  return [
    {
      text: `Read ${p.name}'s own docs, governance forum and announcement page for a points round, season or airdrop programme before you commit any capital.`,
      cost: '$0 to read them',
      time: '20 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: 'about 20 minutes',
    },
    {
      text: `Repeat one qualifying action each week on ${chain} (a deposit, a borrow, a swap or a vote) so the activity lands in several weekly snapshots.`,
      cost: `about $${weekly} of gas a week`,
      time: '15 minutes a week',
    },
    {
      text: `Keep the $${capital} position open on ${chain} for at least ${hold} days, and re-check the programme before you move it.`,
      cost: `the $${capital} stays deposited`,
      time: `${hold} days`,
    },
    {
      text: `Claim only from ${p.name}'s own published rewards page, never from a direct message or a link someone sends you.`,
      cost: '$0 to check, and never pay a fee to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet address, every transaction hash, the dates and the $${capital} cost in a farm journal so you can repeat or unwind the position.`,
      cost: '$0',
      time: '10 minutes',
    },
    {
      text: `At the ${hold}-day mark compare ${p.name}'s TVL (${tvl} on ${chains} chain${chains === 1 ? '' : 's'}) and seven-day change with the day you entered, and unwind if the trend reversed.`,
      cost: `about $${gas} to exit`,
      time: '15 minutes',
    },
  ];
}

/** Every protocol whose record already carries a traded token, by market cap, with its own mcap/TVL multiple. */
/** A protocol that names a token symbol but records no market cap. It is neither a pre-token launch candidate
 *  nor a traded peer with a multiple, so `liveRows` drops it and `isRankable` refuses it; without this list the
 *  page would leave it out of every count while the snapshot still carries it. */
export function isPending(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && p.mcap_usd === null;
}

/** Every protocol that records a token but no market cap, by TVL, with the symbol the snapshot records. */
export function pendingRows(snapshot: Snapshot): PendingRow[] {
  return snapshot.protocols
    .filter(isPending)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
      multiple: isPeer(p) ? (p.mcap_usd as number) / p.tvl_usd : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan carried as the board wrote it. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_low: row.implied_low,
    implied_high: row.implied_high,
    peer_multiple: row.model.base_multiple,
    peer_source: row.model.peer_source,
    peer_count: row.model.peer_count,
    b0: row.model.b0,
    b1: row.model.b1,
    b2: row.model.b2,
    b3: row.model.b3,
    z: row.model.z,
    g: row.model.g,
    nc: row.model.nc,
    residual_category: row.model.residual_category,
    n_category: row.model.n_category,
    predicted_multiple: row.model.predicted_multiple,
    base_value_usd: row.model.base_value_usd,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    wait_multiplier: row.model.wait_multiplier,
    wait_days: row.model.wait_days,
    chain_multiplier: row.model.chain_multiplier,
    thin_multiplier: row.model.thin_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData; peerTable: PeerTable; fitted: FittedModel } {
  const peerTable = buildPeerTable(snapshot, model);
  const fitted = fitValueModel(snapshot, model);
  const board = buildBoard(snapshot, fitted, model);
  const live = liveRows(snapshot);
  const pending = pendingRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  // Every protocol the snapshot carries lands in exactly one of four places: ranked on the board, set aside as a
  // derivative of a token that already trades, traded with a market cap, or naming a token with no cap. Counting
  // all four is what lets the page say how much of the universe it shows instead of quietly dropping a group.
  const asideCount = setAside(snapshot).length;
  const accounted = board.length + asideCount + live.length + pending.length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    pending_size: pending.length,
    aside_size: asideCount,
    accounted_size: accounted,
    universe_size: snapshot.protocols.length,
    peer_table: peerTable,
    fitted_model: fitted,
    rows: board.map(radarRow),
    pending,
    live,
  };
  return { board, radar, peerTable, fitted };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, duplicates, ranges and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set<string>();
  for (const r of board) {
    if (slugs.has(r.slug)) return `the board names ${r.slug} more than once`;
    slugs.add(r.slug);
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!(r.implied_low <= r.implied_value_usd && r.implied_value_usd <= r.implied_high)) {
      return `${r.slug} has a range of ${r.implied_low}..${r.implied_high} around ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
