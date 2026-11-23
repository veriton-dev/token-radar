// Held-out validation for the token radar's fitted value model.
//
//   MAKEFUN_OUTPUT_DIR=out node scripts/validate.ts --input ../token-radar-01-kit/input/snapshot.json
//
// It prints the five-fold cross-validated RMSE of three predictors of the log mcap/TVL multiple, all over
// the snapshot's own traded protocols: the training mean, the old category-median rule, and the fitted
// surface with its shrunk category residuals. The fit is only worth shipping when it beats both.

import { readFileSync } from 'node:fs';
import { fitValueModel, parseSnapshot } from '../lib/model.ts';

function option(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const withEquals = args.find((a) => a.startsWith(`--${name}=`));
  if (withEquals !== undefined) return withEquals.slice(name.length + 3);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  return fallback;
}

const input = option('input', '/input');
const file = input.endsWith('.json') ? input : `${input.replace(/\/$/, '')}/snapshot.json`;
const snapshot = parseSnapshot(readFileSync(file, 'utf8'));
const fit = fitValueModel(snapshot);
const cv = fit.cv;

const f = (n: number): string => n.toFixed(4);
process.stdout.write(`traded protocols: ${fit.training_count}\n`);
process.stdout.write(`coefficients: b0=${f(fit.b0)} b1=${f(fit.b1)} b2=${f(fit.b2)} b3=${f(fit.b3)}\n`);
process.stdout.write(`standardisation: mean_log10_tvl=${f(fit.mean_log10_tvl)} sd_log10_tvl=${f(fit.sd_log10_tvl)}\n`);
process.stdout.write(`singular fallback: ${fit.singular ? 'yes (intercept only)' : 'no'}\n`);
process.stdout.write(`\n5-fold cross-validation over ${cv.rows} traded protocols (fold = hash(slug) % 5):\n`);
process.stdout.write(`  baseline  (mean log multiple)        RMSE ${f(cv.baseline_rmse)}\n`);
process.stdout.write(`  category  (category median mcap/TVL) RMSE ${f(cv.category_rmse)}\n`);
process.stdout.write(`  fitted    (surface + shrunk residual) RMSE ${f(cv.fitted_rmse)}\n`);
const better = cv.fitted_rmse < cv.category_rmse && cv.fitted_rmse < cv.baseline_rmse;
process.stdout.write(`\nship the fitted model: ${better ? 'yes' : 'no'} (fitted RMSE ${better ? 'is' : 'is not'} the lowest)\n`);
