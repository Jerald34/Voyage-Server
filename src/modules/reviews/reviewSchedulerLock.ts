import { prisma } from "../../db/prisma";

/**
 * Postgres advisory-lock wrapper.
 *
 * Tries to acquire the lock; if another process already holds it, returns null
 * without running `fn`. If acquired, runs `fn`, then releases the lock in
 * `finally` so a thrown error never strands the lock.
 *
 * Use a stable bigint key for each background job that must not run twice
 * concurrently across deployed instances.
 */
export async function withAdvisoryLock<T>(lockKey: bigint, fn: () => Promise<T>): Promise<T | null> {
  const acquired = await prisma.$queryRaw<{ pg_try_advisory_lock: boolean }[]>`
    SELECT pg_try_advisory_lock(${lockKey})
  `;
  if (!acquired[0]?.pg_try_advisory_lock) {
    return null;
  }
  try {
    return await fn();
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${lockKey})`;
  }
}
