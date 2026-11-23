// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and ranks every
// pre-token protocol in the snapshot, not a sample of them. A protocol records no token when its index
// entry carries no market cap, no CoinGecko id and no symbol; the protocols whose token already trades
// are kept in a separate view, with the market's own market-cap figure, never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures. The peer multiple is *derived* each run
// from the protocols that already trade: each traded protocol's market cap over its TVL is one peer
// multiple, the median of a category's multiples (at least three peers) is that category's multiple,
// and a category with fewer peers falls back to the median of every traded peer. No name is hardcoded.
//
//   peer       = median(mcap_usd / tvl_usd) over the category's traded peers, else the global median
//   base       = tvl_usd x peer
//   growthPct  = clamp(change_7d or 0, -60, +120)
//   growthMult = 1 + (growthPct / 100) x 0.35
//   age        = whole days since listed_at; unknown -> null
//   waitMult   = 0.55 + min(age ?? 180, 1460) / 1460 x 0.45
//   chainMult  = 1 + 0.03 x min(len(chains) - 1, 4)
//   thinMult   = change_7d is null ? 0.85 : 1
//   implied    = max(1, round(base x growthMult x waitMult x chainMult x thinMult))
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
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

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
  peer_table: PeerTable;
  rows: RadarRow[];
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

/** One protocol's computed terms: the peer it uses, every multiplier, the point estimate and its range. */
export interface Scored {
  implied: number;
  low: number;
  high: number;
  baseValue: number;
  peer: PeerUse;
  growthPct: number;
  growthMult: number;
  age: number | null;
  waitDays: number;
  waitMult: number;
  chainMult: number;
  thinMult: number;
}

/** The model applied to one protocol. The same function scores every row; no name is read. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, table: PeerTable, model: ModelConstants = MODEL): Scored {
  const age = ageDays(asOf, protocol.listed_at);
  const peer = peerFor(protocol.category, table, model);
  const baseValue = protocol.tvl_usd * peer.multiple;
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
  return { implied, low, high, baseValue, peer, growthPct, growthMult, age, waitDays, waitMult, chainMult, thinMult };
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
export function buildBoard(snapshot: Snapshot, table: PeerTable = buildPeerTable(snapshot), model: ModelConstants = MODEL): BoardRow[] {
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

  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of, table, model) }));
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
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData; peerTable: PeerTable } {
  const peerTable = buildPeerTable(snapshot, model);
  const board = buildBoard(snapshot, peerTable, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
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
    peer_table: peerTable,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar, peerTable };
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
