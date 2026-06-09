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
  if (!process.env.RESEND_API_KEY) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "Voyage-Server/1.0"
    },
    body: JSON.stringify({
      from: getFromAddress(),
      to: mail.to,
      subject: mail.subject,
      html: mail.html
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

const baseStyles = `font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6;color:#1d2024;`;

export async function sendVerificationEmail(payload: VerificationEmailPayload) {
  const displayName = escapeHtmlText(payload.displayName);
  const verificationUrl = escapeHtmlText(payload.verificationUrl);
  await sendMail({
    to: payload.to,
    subject: "Verify your Voyage email",
    html: `<div style="${baseStyles}"><p>Hello ${displayName},</p><p>Confirm your email to finish setting up your Voyage account.</p><p><a href="${verificationUrl}" style="display:inline-block;padding:10px 18px;background:#223843;color:#fff;border-radius:6px;text-decoration:none">Verify email</a></p><p style="font-size:13px;color:#666">Or paste this link in your browser:<br/>${verificationUrl}</p><p style="font-size:13px;color:#666">This link expires in 24 hours.</p></div>`,
    text: `Hello ${payload.displayName},\n\nConfirm your email at: ${payload.verificationUrl}\n\nThis link expires in 24 hours.`,
    logMessage: `Verification email for ${payload.to}: ${payload.verificationUrl}`
  });
}

export async function sendPasswordResetEmail(payload: PasswordResetEmailPayload) {
  const displayName = escapeHtmlText(payload.displayName);
  const resetUrl = escapeHtmlText(payload.resetUrl);
  await sendMail({
    to: payload.to,
    subject: "Reset your Voyage password",
    html: `<div style="${baseStyles}"><p>Hello ${displayName},</p><p>Reset your Voyage password by opening this link:</p><p><a href="${resetUrl}" style="display:inline-block;padding:10px 18px;background:#223843;color:#fff;border-radius:6px;text-decoration:none">Reset password</a></p><p style="font-size:13px;color:#666">If you didn't ask for this, you can ignore this email.</p></div>`,
    text: `Hello ${payload.displayName},\n\nReset your Voyage password at: ${payload.resetUrl}\n\nIf you didn't ask for this, you can ignore this email.`,
    logMessage: `Password reset email for ${payload.to}: ${payload.resetUrl}`
  });
}

export type TripReviewEmailPayload = {
  to: string;
  tripTitle: string;
  tripToken: string;
  clientName?: string;
};

export async function sendTripReviewEmail(payload: TripReviewEmailPayload) {
  const greetingText = payload.clientName ? `Hello ${payload.clientName},` : "Hello,";
  const greetingHtml = payload.clientName ? `Hello ${escapeHtmlText(payload.clientName)},` : "Hello,";
  const baseUrl = `${env.APP_ORIGIN.replace(/\/+$/, "")}/reviews/${payload.tripToken}`;
  const star = (n: number) =>
    `<a href="${escapeHtmlText(`${baseUrl}?rating=${n}`)}" style="display:inline-block;padding:8px 12px;margin:0 4px;background:#FAFAFA;border:1px solid #ddd;border-radius:6px;text-decoration:none;color:#1d2024;font-size:20px;">${"⭐".repeat(n)}</a>`;
  await sendMail({
    to: payload.to,
    subject: `How was your trip to ${payload.tripTitle}?`,
    html: `<div style="${baseStyles}"><p>${greetingHtml}</p><p>We hope you enjoyed your trip to <strong>${escapeHtmlText(payload.tripTitle)}</strong>. How would you rate it overall?</p><p style="text-align:center;margin:24px 0;">${star(1)}${star(2)}${star(3)}${star(4)}${star(5)}</p><p style="font-size:13px;color:#666">Tap a rating above and we'll ask you for the rest. Should take 30 seconds.</p></div>`,
    text: `${greetingText}\n\nWe hope you enjoyed your trip to ${payload.tripTitle}. Rate it 1-5 stars:\n\n${[1, 2, 3, 4, 5]
      .map((n) => `${n} stars: ${baseUrl}?rating=${n}`)
      .join("\n")}\n`,
    logMessage: `Trip review email for ${payload.to}: ${baseUrl}`
  });
}

export async function sendAgencyInvitationEmail(payload: AgencyInvitationEmailPayload) {
  const inviterName = escapeHtmlText(payload.inviterName);
  const agencyName = escapeHtmlText(payload.agencyName);
  const acceptUrl = escapeHtmlText(payload.acceptUrl);
  const role = escapeHtmlText(payload.role);
  await sendMail({
    to: payload.to,
    subject: `${payload.inviterName} invited you to join ${payload.agencyName} on Voyage`,
    html: `<div style="${baseStyles}"><p>Hello,</p><p><strong>${inviterName}</strong> has invited you to join <strong>${agencyName}</strong> on Voyage as <strong>${role}</strong>.</p><p><a href="${acceptUrl}" style="display:inline-block;padding:10px 18px;background:#223843;color:#fff;border-radius:6px;text-decoration:none">Accept invitation</a></p><p style="font-size:13px;color:#666">Or paste this link:<br/>${acceptUrl}</p><p style="font-size:13px;color:#666">This invitation expires in 7 days.</p></div>`,
    text: `${payload.inviterName} invited you to join ${payload.agencyName} on Voyage as ${payload.role}.\n\nAccept at: ${payload.acceptUrl}\n\nThis invitation expires in 7 days.`,
    logMessage: `Agency invite email for ${payload.to}: ${payload.acceptUrl}`
  });
}
