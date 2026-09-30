import * as cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { prisma } from "../../db/prisma";
import { sendTripReviewEmail } from "../../services/email";
import { signTripReviewToken } from "./reviewTokens";
import { withAdvisoryLock } from "./reviewSchedulerLock";

/**
 * Post-trip review email scheduler.
 *
 * Per spec §7.8: hourly cron picks up `ClientTrip` rows whose `endDate` is
 * more than two days in the past, status `APPROVED_INTERNAL`, no prior log
 * entry. Sends the email and inserts `TripReviewEmailLog` so we never
 * double-send.
 *
 * Multi-instance safety: a Postgres advisory lock guards the scan so two
 * processes can't double-dispatch.
 */

// Stable, app-local advisory-lock key. Hex of ASCII "REVIEW01" (8 chars, 64 bits).
const REVIEW_LOCK_KEY = 0x5245564945573031n;
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;

let scheduledTask: ScheduledTask | null = null;

/**
 * Resolve the email recipient for a given trip. The `ClientTrip` row does not
 * carry an email directly, so we fall back to the most recent share's
 * `clientEmail` (set when the agency created the share for that client).
 */
async function resolveRecipientEmail(tripId: string): Promise<string | null> {
  const recentShare = await prisma.itineraryShare.findFirst({
    where: { tripId, clientEmail: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { clientEmail: true }
  });
  return recentShare?.clientEmail ?? null;
}

export async function runReviewScanOnce(deps?: { now?: Date }): Promise<{
  attempted: number;
  sent: number;
  skipped: number;
}> {
  const now = deps?.now ?? new Date();
  const cutoff = new Date(now.getTime() - TWO_DAYS_MS);

  let attempted = 0;
  let sent = 0;
  let skipped = 0;

  await withAdvisoryLock(REVIEW_LOCK_KEY, async () => {
    const tripsToEmail = await prisma.clientTrip.findMany({
      where: {
        endDate: { lt: cutoff },
        status: "APPROVED_INTERNAL",
        tripReviewEmailLog: null
      },
      take: BATCH_SIZE,
      select: { id: true, title: true, clientName: true }
    });

    for (const trip of tripsToEmail) {
      attempted += 1;
      const recipient = await resolveRecipientEmail(trip.id);
      if (!recipient) {
        skipped += 1;
        console.warn(`[reviewScheduler] no recipient for trip ${trip.id}; skipping`);
        continue;
      }

      const tripToken = signTripReviewToken({ tripId: trip.id, issuedAt: new Date().toISOString() });

      try {
        await sendTripReviewEmail({
          to: recipient,
          tripTitle: trip.title,
          tripToken,
          clientName: trip.clientName ?? undefined
        });
        await prisma.tripReviewEmailLog.create({ data: { tripId: trip.id } });
        sent += 1;
      } catch (err) {
        console.error("[reviewScheduler] send failed", { tripId: trip.id, err });
        // Don't insert the log entry — we'll retry next hour.
      }
    }
  });

  return { attempted, sent, skipped };
}

export function initReviewScheduler(): void {
  if (scheduledTask) {
    return; // idempotent — guard against double-init in tests/hot-reload
  }
  scheduledTask = cron.schedule("0 * * * *", () => {
    runReviewScanOnce().catch((err) => {
      console.error("[reviewScheduler] scan failed", err);
    });
  });
  console.log("[reviewScheduler] initialized (hourly)");
}

export function stopReviewScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}
