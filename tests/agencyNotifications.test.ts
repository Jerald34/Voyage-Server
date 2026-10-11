import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgencyNotifier } from "../src/modules/agencies/agencyNotifications";

const agency = {
  id: "agency-1",
  name: "Hillside Travel",
  status: "PENDING_REVIEW" as const,
  ownerUserId: "owner-1",
  submittedAt: new Date("2026-10-11T00:00:00.000Z"),
  verifiedAt: null,
  verifiedByAdminUserId: null,
  rejectedAt: null,
  rejectedByAdminUserId: null,
  rejectionReason: null as string | null,
  suspendedAt: null,
  suspendedByAdminUserId: null,
  suspensionReason: null,
  businessPhone: "639001112222",
  businessEmail: "hello@hillside.test",
  country: "Philippines",
  city: "Baguio",
  ownerUser: { id: "owner-1", email: "owner@hillside.test", displayName: "Ana" }
};

function setup(overrides: { agency?: typeof agency | null; admins?: Array<{ id: string; email: string; displayName: string }> } = {}) {
  const repository = {
    findAgencyByIdWithOwner: vi.fn().mockResolvedValue(overrides.agency === undefined ? agency : overrides.agency),
    listActiveSuperAdmins: vi.fn().mockResolvedValue(
      overrides.admins ?? [
        { id: "admin-1", email: "ada@voyage.test", displayName: "Ada" },
        { id: "admin-2", email: "ben@voyage.test", displayName: "Ben" }
      ]
    )
  };
  const emailSender = {
    sendAgencyApplicationReceivedEmail: vi.fn().mockResolvedValue(undefined),
    sendAgencyApprovedEmail: vi.fn().mockResolvedValue(undefined),
    sendAgencyRejectedEmail: vi.fn().mockResolvedValue(undefined),
    sendNewAgencyApplicationEmail: vi.fn().mockResolvedValue(undefined)
  };
  const logError = vi.fn();
  const notifier = createAgencyNotifier({ repository, emailSender, appOrigin: "https://app.test/", logError });
  return { notifier, repository, emailSender, logError };
}

beforeEach(() => {
  agency.rejectionReason = null;
});

describe("agency notifier", () => {
  it("confirms a new application to the owner and alerts every super admin", async () => {
    const { notifier, emailSender } = setup();

    await notifier.applicationSubmitted("agency-1");

    expect(emailSender.sendAgencyApplicationReceivedEmail).toHaveBeenCalledWith({
      to: "owner@hillside.test",
      displayName: "Ana",
      agencyName: "Hillside Travel",
      statusUrl: "https://app.test/?authenticated=1"
    });
    expect(emailSender.sendNewAgencyApplicationEmail).toHaveBeenCalledTimes(2);
    expect(emailSender.sendNewAgencyApplicationEmail).toHaveBeenCalledWith({
      to: "ada@voyage.test",
      agencyName: "Hillside Travel",
      ownerName: "Ana",
      ownerEmail: "owner@hillside.test",
      location: "Baguio, Philippines",
      reviewUrl: "https://app.test/?authenticated=1&tab=admin"
    });
  });

  it("tells the owner about an approval", async () => {
    const { notifier, emailSender } = setup();

    await notifier.agencyApproved("agency-1");

    expect(emailSender.sendAgencyApprovedEmail).toHaveBeenCalledWith({
      to: "owner@hillside.test",
      displayName: "Ana",
      agencyName: "Hillside Travel",
      workspaceUrl: "https://app.test/?authenticated=1"
    });
  });

  it("tells the owner about a rejection, with the saved reason", async () => {
    agency.rejectionReason = "Business permit missing";
    const { notifier, emailSender } = setup();

    await notifier.agencyRejected("agency-1");

    expect(emailSender.sendAgencyRejectedEmail).toHaveBeenCalledWith({
      to: "owner@hillside.test",
      displayName: "Ana",
      agencyName: "Hillside Travel",
      reason: "Business permit missing",
      statusUrl: "https://app.test/?authenticated=1"
    });
  });

  it("still alerts the admins when the owner's email fails, and logs the failure", async () => {
    const { notifier, emailSender, logError } = setup();
    emailSender.sendAgencyApplicationReceivedEmail.mockRejectedValueOnce(new Error("Resend down"));

    await expect(notifier.applicationSubmitted("agency-1")).resolves.toBeUndefined();

    expect(emailSender.sendNewAgencyApplicationEmail).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(
      "[agencyNotifications] application received email failed",
      expect.objectContaining({ agencyId: "agency-1" })
    );
  });

  it("never throws when the lookup fails", async () => {
    const { notifier, repository, emailSender, logError } = setup();
    repository.findAgencyByIdWithOwner.mockRejectedValueOnce(new Error("db down"));

    await expect(notifier.agencyApproved("agency-1")).resolves.toBeUndefined();

    expect(emailSender.sendAgencyApprovedEmail).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith("[agencyNotifications] agency lookup failed", expect.objectContaining({ agencyId: "agency-1" }));
  });

  it("sends nothing for an agency that no longer exists", async () => {
    const { notifier, emailSender } = setup({ agency: null });

    await notifier.applicationSubmitted("agency-1");

    expect(emailSender.sendAgencyApplicationReceivedEmail).not.toHaveBeenCalled();
    expect(emailSender.sendNewAgencyApplicationEmail).not.toHaveBeenCalled();
  });

  it("leaves the location out when the application has no city or country", async () => {
    const { notifier, emailSender } = setup({ agency: { ...agency, city: null as never, country: "  " } });

    await notifier.applicationSubmitted("agency-1");

    expect(emailSender.sendNewAgencyApplicationEmail).toHaveBeenCalledWith(expect.objectContaining({ location: null }));
  });
});
