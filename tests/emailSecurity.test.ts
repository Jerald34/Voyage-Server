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

function setSmtpEnv() {
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_SECURE = "false";
  process.env.EMAIL_FROM = "Voyage <no-reply@example.com>";
  delete process.env.RESEND_API_KEY;
}

describe("email HTML security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSmtpEnv();
  });

  it("escapes verification email display names in HTML while leaving text unescaped", async () => {
    const { sendVerificationEmail } = await loadEmailService();

    await sendVerificationEmail({
      to: "recipient@example.com",
      displayName: malicious,
      verificationUrl: "https://example.com/verify?token=abc&next=/dashboard"
    });

    const html = mailMocks.sendMail.mock.calls.at(-1)?.[0]?.html ?? "";
    const text = mailMocks.sendMail.mock.calls.at(-1)?.[0]?.text ?? "";

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
    expect(html).toContain(
      'href="https://example.com/verify?token=abc&amp;next=/dashboard"'
    );
    expect(text).toContain(malicious);
    expect(text).not.toContain("&lt;img");
  });

  it("escapes password reset email display names in HTML while leaving text unescaped", async () => {
    const { sendPasswordResetEmail } = await loadEmailService();

    await sendPasswordResetEmail({
      to: "recipient@example.com",
      displayName: malicious,
      resetUrl: "https://example.com/reset?token=abc&next=/settings"
    });

    const html = mailMocks.sendMail.mock.calls.at(-1)?.[0]?.html ?? "";
    const text = mailMocks.sendMail.mock.calls.at(-1)?.[0]?.text ?? "";

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
    expect(html).toContain(
      'href="https://example.com/reset?token=abc&amp;next=/settings"'
    );
    expect(text).toContain(malicious);
    expect(text).not.toContain("&lt;img");
  });

  it("escapes trip review client and trip names in HTML while leaving text unescaped", async () => {
    const { sendTripReviewEmail } = await loadEmailService();

    await sendTripReviewEmail({
      to: "recipient@example.com",
      tripTitle: malicious,
      clientName: malicious,
      tripToken: "review-token-123"
    });

    const html = mailMocks.sendMail.mock.calls.at(-1)?.[0]?.html ?? "";
    const text = mailMocks.sendMail.mock.calls.at(-1)?.[0]?.text ?? "";

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
    expect(text).toContain(malicious);
    expect(text).not.toContain("&lt;img");
  });

  it("escapes invitation email inviter and agency names in HTML while leaving text unescaped", async () => {
    const { sendAgencyInvitationEmail } = await loadEmailService();

    await sendAgencyInvitationEmail({
      to: "recipient@example.com",
      inviterName: malicious,
      agencyName: malicious,
      role: "ADMIN",
      acceptUrl: "https://example.com/invite?token=abc&next=/agency"
    });

    const html = mailMocks.sendMail.mock.calls.at(-1)?.[0]?.html ?? "";
    const text = mailMocks.sendMail.mock.calls.at(-1)?.[0]?.text ?? "";

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
    expect(html).toContain(
      'href="https://example.com/invite?token=abc&amp;next=/agency"'
    );
    expect(text).toContain(malicious);
    expect(text).not.toContain("&lt;img");
  });
});

describe("email branding and delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSmtpEnv();
    vi.unstubAllGlobals();
    process.env.APP_ORIGIN = "https://app.example.com";
    process.env.EMAIL_LOGO_URL = "";
  });

  it("loads the logo from the app origin by default", async () => {
    const { sendVerificationEmail } = await loadEmailService();

    await sendVerificationEmail({
      to: "recipient@example.com",
      displayName: "Ana",
      verificationUrl: "https://app.example.com/verify-email?token=abc"
    });

    const html = mailMocks.sendMail.mock.calls.at(-1)?.[0]?.html ?? "";
    expect(html).toContain('src="https://app.example.com/email/voyage-logo.png"');
  });

  it("loads the logo from EMAIL_LOGO_URL when set", async () => {
    process.env.EMAIL_LOGO_URL = "https://cdn.example.com/logo.png";
    const { sendVerificationEmail } = await loadEmailService();

    await sendVerificationEmail({
      to: "recipient@example.com",
      displayName: "Ana",
      verificationUrl: "https://app.example.com/verify-email?token=abc"
    });

    const html = mailMocks.sendMail.mock.calls.at(-1)?.[0]?.html ?? "";
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
  });

  it("sends the plain-text part through Resend", async () => {
    process.env.SMTP_HOST = "";
    process.env.RESEND_API_KEY = "re_test_key";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendPasswordResetEmail } = await loadEmailService();

    await sendPasswordResetEmail({
      to: "recipient@example.com",
      displayName: "Ana",
      resetUrl: "https://app.example.com/reset-password?token=abc"
    });

    const body = JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body ?? "{}");
    expect(body.text).toContain("https://app.example.com/reset-password?token=abc");
    expect(mailMocks.sendMail).not.toHaveBeenCalled();
  });
});
