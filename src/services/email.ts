import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";
import { escapeHtmlText } from "../utils/html";

export type VerificationEmailPayload = {
  to: string;
  displayName: string;
  verificationUrl: string;
};

export type PasswordResetEmailPayload = {
  to: string;
  displayName: string;
  resetUrl: string;
};

export type AgencyInvitationEmailPayload = {
  to: string;
  inviterName: string;
  agencyName: string;
  role: "ADMIN" | "STAFF";
  acceptUrl: string;
};

type Mail = { to: string; subject: string; html: string; text?: string; logMessage: string };

let smtpTransporter: Transporter | null = null;

function getSmtpTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (smtpTransporter) return smtpTransporter;
  smtpTransporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined
  });
  return smtpTransporter;
}

function getFromAddress() {
  const configured = (env.EMAIL_FROM ?? "").trim();
  if (!configured) {
    throw new Error("EMAIL_FROM is required to send email.");
  }
  if (configured.includes("example.com")) {
    if (env.NODE_ENV === "production") {
      throw new Error("EMAIL_FROM uses example.com placeholder. Set it to a real sending address.");
    }
    const fallback = "Voyage <onboarding@resend.dev>";
    return fallback;
  }
  return configured;
}

async function sendViaSmtp(mail: Mail): Promise<boolean> {
  const transporter = getSmtpTransporter();
  if (!transporter) return false;
  await transporter.sendMail({
    from: getFromAddress(),
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text
  });
  return true;
}

async function sendViaResend(mail: Mail): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "Voyage-Server/1.0"
    },
    body: JSON.stringify({
      from: getFromAddress(),
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text
    })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const code = body?.error?.code ?? body?.code ?? "unknown";
    const message = body?.error?.message ?? body?.message ?? "Unknown Resend error";
    throw new Error(`Resend email failed with status ${response.status} (${code}): ${message}`);
  }
  return true;
}

async function sendMail(mail: Mail) {
  if (await sendViaSmtp(mail)) return;
  if (await sendViaResend(mail)) return;
  console.info(mail.logMessage);
}

// Brand palette (docs/brand/logo/kit/GUIDELINES.md): Voyage Navy + Terracotta on the light
// app background. Email clients ignore external CSS, so every style below is inline.
const colors = {
  page: "#EFF1F3",
  card: "#FFFFFF",
  border: "#E3E7EA",
  navy: "#223843",
  heading: "#172731",
  text: "#3D4A52",
  muted: "#6B7780",
  terracotta: "#D77A61"
};

const fontFamily = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const tagline = "Intelligent itinerary-first travel planning for travel professionals.";

function appOrigin() {
  return env.APP_ORIGIN.replace(/\/+$/, "");
}

function appHost() {
  try {
    return new URL(env.APP_ORIGIN).host;
  } catch {
    return env.APP_ORIGIN;
  }
}

function logoUrl() {
  return env.EMAIL_LOGO_URL || `${appOrigin()}/email/voyage-logo.png`;
}

function paragraph(html: string) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${colors.text};">${html}</p>`;
}

function note(html: string) {
  return `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:${colors.muted};">${html}</p>`;
}

function renderButton(label: string, url: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;"><tr><td bgcolor="${colors.navy}" style="border-radius:8px;"><a href="${escapeHtmlText(url)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${fontFamily};font-size:15px;font-weight:600;line-height:1.2;color:#FFFFFF;text-decoration:none;border-radius:8px;">${escapeHtmlText(label)}</a></td></tr></table>`;
}

function renderFallbackLink(url: string) {
  const safeUrl = escapeHtmlText(url);
  return `<p style="margin:24px 0 4px;font-size:13px;line-height:1.5;color:${colors.muted};">Button not working? Copy and paste this link into your browser:</p><p style="margin:0;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${safeUrl}" target="_blank" style="color:${colors.navy};text-decoration:underline;">${safeUrl}</a></p>`;
}

type EmailLayout = {
  subject: string;
  /** Inbox preview line shown after the subject. */
  preheader: string;
  recipient: string;
  /** Fields ending in `Html` must already be escaped. */
  headingHtml: string;
  bodyHtml: string;
  action?: { label: string; url: string };
  afterActionHtml?: string;
  /** Why the recipient got this email and what to do if it wasn't expected. */
  noticeHtml: string;
};

function renderEmail(layout: EmailLayout) {
  const home = escapeHtmlText(appOrigin());
  // Invisible filler stops inbox previews from pulling body text in after the preheader.
  const previewFiller = "&#847;&zwnj;&nbsp;".repeat(40);
  const action = layout.action
    ? renderButton(layout.action.label, layout.action.url) + (layout.afterActionHtml ?? "") + renderFallbackLink(layout.action.url)
    : layout.afterActionHtml ?? "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtmlText(layout.subject)}</title>
<style>
@media only screen and (max-width:480px){.email-outer{padding:16px 8px!important}.email-px{padding-left:24px!important;padding-right:24px!important}}
</style>
</head>
<body style="margin:0;padding:0;background:${colors.page};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${colors.page};opacity:0;">${escapeHtmlText(layout.preheader)}${previewFiller}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${colors.page}" style="background:${colors.page};">
<tr><td class="email-outer" align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${fontFamily};">
<tr><td bgcolor="${colors.card}" style="background:${colors.card};border:1px solid ${colors.border};border-radius:12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="email-px" style="padding:32px 40px 0;"><a href="${home}" target="_blank" style="text-decoration:none;"><img src="${escapeHtmlText(logoUrl())}" width="156" height="51" alt="Voyage" style="display:block;width:156px;height:51px;border:0;outline:none;text-decoration:none;font-size:22px;font-weight:700;color:${colors.navy};"></a></td></tr>
<tr><td class="email-px" style="padding:28px 40px 32px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:${colors.heading};">${layout.headingHtml}</h1>
${layout.bodyHtml}
${action}
</td></tr>
<tr><td class="email-px" style="padding:20px 40px 28px;border-top:1px solid ${colors.border};font-size:13px;line-height:1.55;color:${colors.muted};">${layout.noticeHtml}</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:24px 24px 0;font-size:12px;line-height:1.6;color:${colors.muted};">
<a href="${home}" target="_blank" style="color:${colors.muted};font-weight:600;text-decoration:none;">Voyage</a> &middot; ${escapeHtmlText(tagline)}<br>
This email was sent to ${escapeHtmlText(layout.recipient)}. Replies to this address aren&rsquo;t monitored.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function renderText(lines: string[]) {
  return [...lines, "", "--", `Voyage | ${appHost()}`, tagline].join("\n");
}

export async function sendVerificationEmail(payload: VerificationEmailPayload) {
  const subject = "Verify your email address for Voyage";
  await sendMail({
    to: payload.to,
    subject,
    html: renderEmail({
      subject,
      preheader: "Confirm your email to finish setting up your Voyage account. The link expires in 24 hours.",
      recipient: payload.to,
      headingHtml: "Verify your email address",
      bodyHtml:
        paragraph(`Hi ${escapeHtmlText(payload.displayName)},`) +
        paragraph(
          `Thanks for signing up for Voyage. Please confirm that <strong>${escapeHtmlText(payload.to)}</strong> is your email address to finish setting up your account.`
        ),
      action: { label: "Verify email address", url: payload.verificationUrl },
      afterActionHtml: note("This link expires in 24 hours."),
      noticeHtml:
        "If you didn&rsquo;t sign up for Voyage, you can safely ignore this email. The account can&rsquo;t be used until this address is verified."
    }),
    text: renderText([
      `Hi ${payload.displayName},`,
      "",
      `Thanks for signing up for Voyage. Please confirm that ${payload.to} is your email address to finish setting up your account:`,
      "",
      payload.verificationUrl,
      "",
      "This link expires in 24 hours.",
      "",
      "If you didn't sign up for Voyage, you can safely ignore this email."
    ]),
    logMessage: "Verification email delivery skipped because no provider is configured."
  });
}

export async function sendPasswordResetEmail(payload: PasswordResetEmailPayload) {
  const subject = "Reset your Voyage password";
  await sendMail({
    to: payload.to,
    subject,
    html: renderEmail({
      subject,
      preheader: "Use this link to choose a new password. It expires in 24 hours.",
      recipient: payload.to,
      headingHtml: "Reset your password",
      bodyHtml:
        paragraph(`Hi ${escapeHtmlText(payload.displayName)},`) +
        paragraph(
          `We received a request to reset the password for the Voyage account linked to <strong>${escapeHtmlText(payload.to)}</strong>. Use the button below to choose a new one.`
        ),
      action: { label: "Reset password", url: payload.resetUrl },
      afterActionHtml: note("This link expires in 24 hours."),
      noticeHtml:
        "If you didn&rsquo;t ask to reset your password, you can ignore this email. Your password won&rsquo;t change unless you use the link above."
    }),
    text: renderText([
      `Hi ${payload.displayName},`,
      "",
      `We received a request to reset the password for the Voyage account linked to ${payload.to}. Choose a new password here:`,
      "",
      payload.resetUrl,
      "",
      "This link expires in 24 hours.",
      "",
      "If you didn't ask to reset your password, you can ignore this email. Your password won't change."
    ]),
    logMessage: "Password reset email delivery skipped because no provider is configured."
  });
}

export type TripReviewEmailPayload = {
  to: string;
  tripTitle: string;
  tripToken: string;
  clientName?: string;
};

function renderRatingButtons(baseUrl: string) {
  const cells = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<td style="padding:0 4px;"><a href="${escapeHtmlText(`${baseUrl}?rating=${n}`)}" target="_blank" style="display:inline-block;width:48px;padding:11px 0;border:1px solid ${colors.border};border-radius:8px;text-align:center;font-size:15px;font-weight:600;line-height:1.2;color:${colors.navy};text-decoration:none;">${n}&nbsp;<span style="color:${colors.terracotta};">&#9733;</span></a></td>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0 -4px;"><tr>${cells}</tr></table>`;
}

export async function sendTripReviewEmail(payload: TripReviewEmailPayload) {
  const subject = `How was your trip to ${payload.tripTitle}?`;
  const greetingText = payload.clientName ? `Hi ${payload.clientName},` : "Hi,";
  const greetingHtml = payload.clientName ? `Hi ${escapeHtmlText(payload.clientName)},` : "Hi,";
  const tripTitleHtml = escapeHtmlText(payload.tripTitle);
  const baseUrl = `${appOrigin()}/reviews/${payload.tripToken}`;
  await sendMail({
    to: payload.to,
    subject,
    html: renderEmail({
      subject,
      preheader: `Rate your trip to ${payload.tripTitle}. It takes about 30 seconds.`,
      recipient: payload.to,
      headingHtml: `How was your trip to ${tripTitleHtml}?`,
      bodyHtml:
        paragraph(greetingHtml) +
        paragraph(`We hope you enjoyed your trip to <strong>${tripTitleHtml}</strong>. How would you rate it overall?`),
      afterActionHtml:
        renderRatingButtons(baseUrl) +
        note("1 means not great, 5 means you loved it. Tap a rating and we&rsquo;ll ask a couple of quick questions."),
      noticeHtml: "You&rsquo;re receiving this because your travel agency planned this trip with Voyage."
    }),
    text: renderText([
      greetingText,
      "",
      `We hope you enjoyed your trip to ${payload.tripTitle}. Rate it from 1 to 5 stars:`,
      "",
      ...[1, 2, 3, 4, 5].map((n) => `${n} star${n === 1 ? "" : "s"}: ${baseUrl}?rating=${n}`)
    ]),
    logMessage: "Trip review email delivery skipped because no provider is configured."
  });
}

export async function sendAgencyInvitationEmail(payload: AgencyInvitationEmailPayload) {
  const subject = `${payload.inviterName} invited you to join ${payload.agencyName} on Voyage`;
  const inviterName = escapeHtmlText(payload.inviterName);
  const agencyName = escapeHtmlText(payload.agencyName);
  const roleLabel = payload.role === "ADMIN" ? "an admin" : "a staff member";
  await sendMail({
    to: payload.to,
    subject,
    html: renderEmail({
      subject,
      preheader: `Accept the invitation to join ${payload.agencyName} on Voyage. It expires in 7 days.`,
      recipient: payload.to,
      headingHtml: `Join ${agencyName} on Voyage`,
      bodyHtml:
        paragraph("Hi,") +
        paragraph(`<strong>${inviterName}</strong> invited you to join <strong>${agencyName}</strong> on Voyage as ${roleLabel}.`) +
        paragraph("Voyage is where travel teams plan, verify and share client itineraries."),
      action: { label: "Accept invitation", url: payload.acceptUrl },
      afterActionHtml: note("This invitation expires in 7 days."),
      noticeHtml:
        "If you weren&rsquo;t expecting this invitation, you can ignore this email. You won&rsquo;t be added to the agency unless you accept."
    }),
    text: renderText([
      "Hi,",
      "",
      `${payload.inviterName} invited you to join ${payload.agencyName} on Voyage as ${roleLabel}.`,
      "",
      `Accept the invitation: ${payload.acceptUrl}`,
      "",
      "This invitation expires in 7 days.",
      "",
      "If you weren't expecting this invitation, you can ignore this email."
    ]),
    logMessage: "Agency invitation email delivery skipped because no provider is configured."
  });
}
