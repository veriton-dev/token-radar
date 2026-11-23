# token-radar — pre-token protocols ranked by peer-derived implied value

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/veriton-dev/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/veriton-dev/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry in make.fun's [Build the best token launch radar](https://make.fun/bounty/token-radar-01)
bounty: a static dashboard that ranks the protocols in a sealed DefiLlama snapshot by what a token
would be worth if the protocol's record stayed as it is, and says how to farm each one.

## What the model does

No protocol name is special-cased and no multiplier is hand-picked. Every run derives the valuation
from the snapshot's own figures:

| term | how it is derived |
| --- | --- |
| `peer` | median `mcap_usd / tvl_usd` over the **traded** protocols in the same category (129 traded peers in the snapshot); categories with fewer than 3 peers fall back to the global median (0.2049x) |
| `base` | `tvl_usd x peer` |
| `growth` | `1 + clamp(change_7d, -60, +120) / 100 x 0.35` — TVL growth is damped because it is noisy |
| `wait` | `0.55 + min(age_days, 1460) / 1460 x 0.45` — a longer record with no token counts for more |
| `chains` | `1 + 0.03 x min(len(chains) - 1, 4)` |
| `thin` | `0.85` when `change_7d` is unreported, else `1` |
| `implied` | `max(1, round(base x growth x wait x chains x thin))`, with a `0.6x .. 1.6x` range shown beside it |

The ranking uses the point estimate, never the range.

## Which protocols the board ranks

`isRankable` excludes a pre-token protocol when its recorded TVL is a derivative of a token that
already trades, because such a protocol is not waiting on a launch of its own:

- a name ending in a version marker (` V2`, ` v2`, ` 2.0`, …)
- a category that holds another token's value: Bridge, Canonical Bridge, Liquid Staking,
  Liquid Restaking, Restaked BTC, CEX
- a name carrying a whole word `wrapped`, `staked` or `staking`
- a name beginning with an exchange's name

That leaves 198 rankable protocols of the snapshot's 342 pre-token ones. Every one of the 40
watchlist slugs is always on the board; the watchlist is the floor, never the ceiling.

## Run it

Node.js 22.18 or later, standard library only, no dependencies, no network.

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
MAKEFUN_OUTPUT_DIR=out node main.ts --check --input input/snapshot.json
```

`--check` validates the written board against the gate's rules — 100..4000 rows, ranks exactly
1..N, implied values non-increasing and not all equal, every watchlist slug present, and every
farm plan 3..12 steps of 20..600 trimmed characters — and exits non-zero with a specific message
when one is violated.

Two runs write byte-identical `board.json` and `data.js`.

## Layout

| path | what it holds |
| --- | --- |
| `main.ts` | reads the snapshot, builds and validates the board, writes `board.json`, `data.js`, the dashboard, screenshots and `dossier.json` |
| `lib/model.ts` | the peer table, the model, the launch-candidate filter and the farm plans |
| `dashboard/` | the static page: sortable and filterable table, per-protocol detail drawer, and the peer-multiple table |
| `vendor/makefun-board.ts` | the competition's own `buildDossier`, unmodified |
| `screenshots/` | the three images the judge reads |

## Dashboard

The page renders with no network. The table sorts on every column, filters by free text and by
category, and switches between the ranked pre-token board and the traded peers whose multiples the
model was derived from. Selecting a row recomputes the model term by term in the page and shows the
protocol's farm plan with each step's cost and duration.

Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.
