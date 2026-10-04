import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dashboardInvalidate: vi.fn(), calendarInvalidate: vi.fn() }));

vi.mock("../src/modules/dashboard/dashboardService", () => ({
  dashboardService: { invalidate: mocks.dashboardInvalidate }
}));
vi.mock("../src/modules/dashboard/calendarService", () => ({
  calendarService: { invalidate: mocks.calendarInvalidate }
}));

import { invalidateAgencyDashboards } from "../src/modules/dashboard/dashboardFreshness";

describe("invalidateAgencyDashboards", () => {
  it("clears the agency's cached dashboard and calendar payloads", () => {
    invalidateAgencyDashboards("agency-1");

    expect(mocks.dashboardInvalidate).toHaveBeenCalledWith("agency-1");
    expect(mocks.calendarInvalidate).toHaveBeenCalledWith("agency-1");
  });
});
