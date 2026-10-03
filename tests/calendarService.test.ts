import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { ApiError } from "../src/http/errors";
import { TtlCache } from "../src/modules/dashboard/cache";
import type { RawCalendarData } from "../src/modules/dashboard/calendar";
import type { CalendarRepository } from "../src/modules/dashboard/calendarRepository";
import { createCalendarService } from "../src/modules/dashboard/calendarService";
import type { CalendarPayload } from "../src/modules/dashboard/dashboardTypes";

const BASE = {
  agencyId: "agency-1",
  from: "2026-09-27",
  to: "2026-11-07",
  now: new Date("2026-10-03T04:00:00.000Z")
};

function setup() {
  const raw: RawCalendarData = { trips: [], undatedTrips: [], shares: [], comments: [], reviews: [] };
  const fetchCalendarWindow = vi.fn().mockResolvedValue(raw);
  const repository: CalendarRepository = { fetchCalendarWindow };
  const service = createCalendarService({ repository, cache: new TtlCache<CalendarPayload>(60_000) });
  return { service, fetchCalendarWindow };
}

describe("calendar service", () => {
  it("passes the agency and window to the repository", async () => {
    const { service, fetchCalendarWindow } = setup();
    const payload = await service.getCalendar({ ...BASE, userId: "owner", role: "OWNER" });

    expect(payload).toMatchObject({ from: "2026-09-27", to: "2026-11-07", generatedAt: "2026-10-03T04:00:00.000Z" });
    const [agencyId, window] = fetchCalendarWindow.mock.calls[0];
    expect(agencyId).toBe("agency-1");
    expect(window).toMatchObject({ from: "2026-09-27", to: "2026-11-07" });
  });

  it("serves a repeat request for the same range from the cache", async () => {
    const { service, fetchCalendarWindow } = setup();
    await service.getCalendar({ ...BASE, userId: "owner", role: "OWNER" });
    await service.getCalendar({ ...BASE, userId: "owner", role: "OWNER" });
    expect(fetchCalendarWindow).toHaveBeenCalledTimes(1);
  });

  it("shares one cached calendar between owners and admins", async () => {
    const { service, fetchCalendarWindow } = setup();
    await service.getCalendar({ ...BASE, userId: "owner", role: "OWNER" });
    await service.getCalendar({ ...BASE, userId: "admin", role: "ADMIN" });
    expect(fetchCalendarWindow).toHaveBeenCalledTimes(1);
  });

  it("caches staff calendars per person", async () => {
    const { service, fetchCalendarWindow } = setup();
    await service.getCalendar({ ...BASE, userId: "staff-a", role: "STAFF" });
    await service.getCalendar({ ...BASE, userId: "staff-b", role: "STAFF" });
    await service.getCalendar({ ...BASE, userId: "staff-a", role: "STAFF" });
    expect(fetchCalendarWindow).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid range before touching the database", async () => {
    const { service, fetchCalendarWindow } = setup();
    await expect(
      service.getCalendar({ ...BASE, from: "2026-11-07", to: "2026-09-27", userId: "owner", role: "OWNER" })
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchCalendarWindow).not.toHaveBeenCalled();
  });
});
