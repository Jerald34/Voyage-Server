import { beforeEach, describe, expect, it, vi } from "vitest";

const mailMocks = vi.hoisted(() => {
  const sendMail = vi.fn().mockResolvedValue(undefined);
  const createTransport = vi.fn(() => ({ sendMail }));
  return { sendMail, createTransport };
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: mailMocks.createTransport
  }
}));

const malicious = `<img src=x onerror="alert(1)">&"'`;

async function loadEmailService() {
  vi.resetModules();
  return import("../src/services/email");
}

function lastMail(): { to?: string; subject?: string; html?: string; text?: string } {
  return mailMocks.sendMail.mock.calls.at(-1)?.[0] ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_SECURE = "false";
  process.env.EMAIL_FROM = "Voyage <no-reply@example.com>";
  delete process.env.RESEND_API_KEY;
});

describe("agency registration emails", () => {
  it("confirms a new application to its owner", async () => {
    const { sendAgencyApplicationReceivedEmail } = await loadEmailService();

    await sendAgencyApplicationReceivedEmail({
      to: "owner@hillside.test",
      displayName: "Ana",
      agencyName: "Hillside Travel",
      statusUrl: "https://app.test/?authenticated=1"
    });

    const mail = lastMail();
    expect(mail.to).toBe("owner@hillside.test");
    expect(mail.subject).toBe("We received your application for Hillside Travel");
    expect(mail.html).toContain("1–2 business days");
    expect(mail.html).toContain('href="https://app.test/?authenticated=1"');
    expect(mail.text).toContain("https://app.test/?authenticated=1");
  });

  it("tells the owner their agency is approved, with a link to the workspace", async () => {
    const { sendAgencyApprovedEmail } = await loadEmailService();

    await sendAgencyApprovedEmail({
      to: "owner@hillside.test",
      displayName: "Ana",
      agencyName: "Hillside Travel",
      workspaceUrl: "https://app.test/?authenticated=1"
    });

    const mail = lastMail();
    expect(mail.subject).toBe("Hillside Travel is approved on Voyage");
    expect(mail.html).toContain("Open your workspace");
    expect(mail.html).toContain('href="https://app.test/?authenticated=1"');
    expect(mail.text).toContain("Open your workspace: https://app.test/?authenticated=1");
  });

  it("tells the owner why the application wasn't approved", async () => {
    const { sendAgencyRejectedEmail } = await loadEmailService();

    await sendAgencyRejectedEmail({
      to: "owner@hillside.test",
      displayName: "Ana",
      agencyName: "Hillside Travel",
      reason: "Business permit missing",
      statusUrl: "https://app.test/?authenticated=1"
    });

    const mail = lastMail();
    expect(mail.subject).toBe("Update on your Voyage application for Hillside Travel");
    expect(mail.html).toContain("Business permit missing");
    expect(mail.text).toContain("Reason: Business permit missing");
    expect(mail.html).toContain("Contact support");
  });

  it("alerts a super admin to a new application", async () => {
    const { sendNewAgencyApplicationEmail } = await loadEmailService();

    await sendNewAgencyApplicationEmail({
      to: "admin@voyage.test",
      agencyName: "Hillside Travel",
      ownerName: "Ana",
      ownerEmail: "owner@hillside.test",
      location: "Baguio, Philippines",
      reviewUrl: "https://app.test/?authenticated=1&tab=admin"
    });

    const mail = lastMail();
    expect(mail.to).toBe("admin@voyage.test");
    expect(mail.subject).toBe("New agency waiting for review: Hillside Travel");
    expect(mail.html).toContain("owner@hillside.test");
    expect(mail.html).toContain("Baguio, Philippines");
    expect(mail.html).toContain('href="https://app.test/?authenticated=1&amp;tab=admin"');
    expect(mail.text).toContain("Ana (owner@hillside.test) registered Hillside Travel in Baguio, Philippines.");
  });

  it("leaves out the location when the application gave none", async () => {
    const { sendNewAgencyApplicationEmail } = await loadEmailService();

    await sendNewAgencyApplicationEmail({
      to: "admin@voyage.test",
      agencyName: "Hillside Travel",
      ownerName: "Ana",
      ownerEmail: "owner@hillside.test",
      location: null,
      reviewUrl: "https://app.test/?authenticated=1&tab=admin"
    });

    expect(lastMail().text).toContain("Ana (owner@hillside.test) registered Hillside Travel.");
  });

  it("escapes names and reasons in HTML while leaving text unescaped", async () => {
    const email = await loadEmailService();
    const sends = [
      () => email.sendAgencyApplicationReceivedEmail({ to: "o@x.test", displayName: malicious, agencyName: malicious, statusUrl: "https://app.test/" }),
      () => email.sendAgencyApprovedEmail({ to: "o@x.test", displayName: malicious, agencyName: malicious, workspaceUrl: "https://app.test/" }),
      () => email.sendAgencyRejectedEmail({ to: "o@x.test", displayName: "Ana", agencyName: malicious, reason: malicious, statusUrl: "https://app.test/" }),
      () => email.sendNewAgencyApplicationEmail({ to: "a@x.test", agencyName: malicious, ownerName: malicious, ownerEmail: "o@x.test", location: malicious, reviewUrl: "https://app.test/" })
    ];

    for (const send of sends) {
      await send();
      const mail = lastMail();
      expect(mail.html).not.toContain("<img src=x");
      expect(mail.html).toContain("&lt;img");
      expect(mail.text).toContain(malicious);
    }
  });
});
