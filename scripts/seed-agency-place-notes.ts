/**
 * seed-agency-place-notes.ts
 *
 * Explicit, file-driven CLI for seeding `AgencyPlaceNote` rows. This is an
 * operator command, not part of the running server — it is never invoked
 * from application code.
 *
 * Usage:
 *   npm run seed:place-notes -- --file ./notes.json --dry-run
 *   npm run seed:place-notes -- --file ./notes.json
 *
 * There is no default file: --file is always required so a bare invocation
 * can never seed the wrong data by accident. The file is fully schema- and
 * database-validated (agency exists, author is a member, no ambiguous
 * unresolved matches) before any write; --dry-run stops after validation and
 * reports counts without writing anything. See seedAgencyPlaceNotes in
 * ../src/modules/agencies/agencyPlaceNoteSeed.ts for the validation/matching
 * rules, and docs/operations/agency-place-notes.md for the file format and
 * operational guidance (including that running this against production
 * requires its own separate authorization).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  agencyPlaceNoteSeedSchema,
  seedAgencyPlaceNotes,
  type AgencyPlaceNoteSeedInput,
  type SeedPrismaClient
} from "../src/modules/agencies/agencyPlaceNoteSeed";

type CliArgs = {
  file?: string;
  dryRun: boolean;
};

function printUsage() {
  console.log(
    [
      "Usage: npm run seed:place-notes -- --file <path> [--dry-run]",
      "",
      "  --file <path>   Required. Path to a JSON file matching the shape documented",
      "                  in docs/operations/agency-place-notes.md. There is no default file.",
      "  --dry-run       Validate the file (schema + agency/membership/ambiguity checks)",
      "                  and report counts, but write nothing.",
      "",
      "Running this against a production database is a separate operator action that",
      "requires its own authorization; this command does not distinguish environments",
      "beyond the DATABASE_URL it is given."
    ].join("\n")
  );
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") {
      i += 1;
      args.file = argv[i];
    } else if (arg.startsWith("--file=")) {
      args.file = arg.slice("--file=".length);
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }
  return args;
}

/** Host and database name only — never the username, password, or full DSN. */
function describeTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    const database = url.pathname.replace(/^\//, "") || "(unknown database)";
    return `${url.hostname || "(unknown host)"} / ${database}`;
  } catch {
    return "(unable to parse DATABASE_URL host/database)";
  }
}

function summarizeInput(input: AgencyPlaceNoteSeedInput) {
  const resolvedCount = input.notes.filter((note) => note.provider !== null).length;
  const unresolvedCount = input.notes.length - resolvedCount;
  return { resolvedCount, unresolvedCount };
}

async function main() {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!args.file) {
    console.error("Error: --file <path> is required. There is no default seed file.\n");
    printUsage();
    process.exitCode = 1;
    return;
  }

  const resolvedPath = resolve(process.cwd(), args.file);

  let raw: string;
  try {
    raw = readFileSync(resolvedPath, "utf8");
  } catch (error) {
    console.error(`Could not read file ${resolvedPath}: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    console.error(`Invalid JSON in ${resolvedPath}: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const parseResult = agencyPlaceNoteSeedSchema.safeParse(json);
  if (!parseResult.success) {
    console.error(`Validation failed for ${resolvedPath}:`);
    for (const issue of parseResult.error.issues) {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      console.error(`  - ${path}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const input = parseResult.data;
  const { resolvedCount, unresolvedCount } = summarizeInput(input);

  // Import env/prisma lazily so a malformed file or missing --file never
  // pulls in the database layer at all.
  const { env } = await import("../src/config/env");

  console.log(`File:    ${resolvedPath}`);
  console.log(`Agency:  ${input.agencyId}`);
  console.log(`Author:  ${input.createdByUserId}`);
  console.log(`Notes:   ${input.notes.length} total (${resolvedCount} resolved, ${unresolvedCount} unresolved)`);
  console.log(`Target:  ${describeTarget(env.DATABASE_URL)}`);
  console.log(
    args.dryRun
      ? "Mode:    dry run — validates against the database above but writes nothing"
      : "Mode:    live — will write to the database above"
  );

  const { prisma } = await import("../src/db/prisma");

  try {
    const result = await seedAgencyPlaceNotes(prisma as unknown as SeedPrismaClient, input, {
      dryRun: args.dryRun
    });

    console.log(args.dryRun ? "\nDry run only — no rows were written." : "\nSeed complete.");
    console.log(`  Resolved (known place ID):  ${result.resolved.created} created, ${result.resolved.updated} updated`);
    console.log(`  Unresolved (name/city):     ${result.unresolved.created} created, ${result.unresolved.updated} updated`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const code = error && typeof error === "object" && "code" in error ? ` [${(error as { code: unknown }).code}]` : "";
  const message = error instanceof Error ? error.message : String(error);
  console.error(`seed-agency-place-notes failed${code}: ${message}`);
  process.exit(1);
});
