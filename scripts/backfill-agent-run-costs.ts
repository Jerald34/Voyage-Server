/**
 * backfill-agent-run-costs.ts
 *
 * One-off operator command: reprices historic `AgentRun` rows from their per-call `usageDetail`
 * using the current price table, and fixes `modelName` (it was always "gpt-5-mini"). It
 * corrects `costUsd`, `costComplete`, `usageDetail` and `modelName` only; token columns are
 * never touched. Safe to re-run: a second pass changes nothing.
 *
 * Usage:
 *   npm run backfill:run-costs                 dry run (default): print what would change
 *   npm run backfill:run-costs -- --apply      write the changes
 *
 * `--apply` is refused unless DATABASE_URL points at localhost/127.0.0.1; add --allow-remote
 * to write to any other database (e.g. production). Only the database HOST is ever printed.
 * See backfillRunCosts in ../src/modules/agent/backfillRunCosts.ts for the logic.
 */
import { env } from "../src/config/env";
import { prisma } from "../src/db/prisma";
import { assertApplyAllowed, backfillRunCosts, databaseHost, isLocalHost } from "../src/modules/agent/backfillRunCosts";

type CliArgs = { apply: boolean; allowRemote: boolean; batchSize: number; help: boolean };

function printUsage() {
  console.log(
    [
      "Usage: npm run backfill:run-costs -- [--apply] [--allow-remote] [--batch-size <n>]",
      "",
      "  (no flags)       Dry run: print each run whose cost/model/costComplete would change,",
      "                   plus a summary. Writes nothing.",
      "  --apply          Write costUsd, costComplete, usageDetail and modelName. Refused unless",
      "                   DATABASE_URL host is localhost/127.0.0.1.",
      "  --allow-remote   Permit --apply against a non-local database (production).",
      "  --batch-size <n> Rows fetched per page (default 200)."
    ].join("\n")
  );
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { apply: false, allowRemote: false, batchSize: 200, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--allow-remote") args.allowRemote = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--batch-size" || arg.startsWith("--batch-size=")) {
      const raw = arg === "--batch-size" ? argv[++i] : arg.slice("--batch-size=".length);
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 5000) throw new Error(`--batch-size must be an integer from 1 to 5000 (got "${raw}")`);
      args.batchSize = n;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

const usd = (n: number) => `$${n.toFixed(6)}`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const host = databaseHost(env.DATABASE_URL);
  console.log(`Database host: ${host}${isLocalHost(host) ? " (local)" : " (REMOTE)"}`);
  console.log(args.apply ? "Mode: APPLY (writing changes)" : "Mode: dry run (no writes; pass --apply to write)");
  assertApplyAllowed({ databaseUrl: env.DATABASE_URL, apply: args.apply, allowRemote: args.allowRemote });

  console.log("");
  const summary = await backfillRunCosts(prisma, {
    apply: args.apply,
    batchSize: args.batchSize,
    log: (line) => console.log(line)
  });

  const unpriced = Object.entries(summary.unpricedModels);
  console.log("");
  console.log("Summary");
  const line = (label: string, value: string | number) => console.log(`  ${`${label}:`.padEnd(20)} ${value}`);
  line("runs scanned", summary.scanned);
  line("runs skipped", `${summary.skippedNoDetail} (usageDetail is not a non-empty array of calls)`);
  line(args.apply ? "runs changed" : "runs to change", summary.changed);
  if (args.apply) line("runs written", summary.applied);
  line("old total cost", usd(summary.oldTotalUsd));
  line("new total cost", usd(summary.newTotalUsd));
  line(
    "unpriced models",
    unpriced.length ? unpriced.map(([name, s]) => `${name} (${s.calls} calls in ${s.runs} runs)`).join(", ") : "none"
  );
  if (unpriced.length) {
    console.log("  (runs using an unpriced model keep cost for their priced calls only and are marked costComplete=false;");
    console.log("   add the model to GOOGLE_VERTEX_MODEL_PRICING and re-run to price them.)");
  }
  if (!args.apply && summary.changed > 0) console.log("\nDry run only. Re-run with --apply to write these changes.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
