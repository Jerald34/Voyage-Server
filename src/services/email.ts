import { env } from "../config/env";

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

function getResendFromAddress() {
  const configuredFrom = (process.env.EMAIL_FROM ?? "").trim();

  if (!configuredFrom) {
    throw new Error("EMAIL_FROM is required for Resend emails.");
  }

  const placeholderDomain = configuredFrom.includes("example.com");
  if (!placeholderDomain) {
    return configuredFrom;
  }

  if (env.NODE_ENV === "production") {
    throw new Error(
      "EMAIL_FROM uses example.com, which is only a placeholder. Set EMAIL_FROM to an address on a Resend-verified domain."
    );
  }

  const fallbackFrom = "Voyage <onboarding@resend.dev>";
  console.warn(`[Email] EMAIL_FROM is placeholder; using ${fallbackFrom} for local development.`);
  return fallbackFrom;
}

async function sendWithResend(payload: {
  to: string;
  subject: string;
  html: string;
  logMessage: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    console.info(payload.logMessage);
    return;
  }

  const from = getResendFromAddress();

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "Voyage-Server/1.0"
    },
    body: JSON.stringify({
      from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html
    })
  });

  if (!response.ok) {
    const responseBody = await response.json().catch(() => null);
    const resendErrorCode = responseBody?.error?.code ?? responseBody?.code ?? "unknown";
    const resendErrorMessage = responseBody?.error?.message ?? responseBody?.message ?? "Unknown Resend error";
    throw new Error(
      `Resend email failed with status ${response.status} (${resendErrorCode}): ${resendErrorMessage}`
    );
  }
}

export async function sendVerificationEmail(payload: VerificationEmailPayload) {
  await sendWithResend({
    to: payload.to,
    subject: "Verify your Voyage email",
    html: `<p>Hello ${payload.displayName},</p><p>Verify your Voyage email by opening this link:</p><p><a href="${payload.verificationUrl}">Verify email</a></p>`,
    logMessage: `Verification email for ${payload.to}: ${payload.verificationUrl}`
  });
}

export async function sendPasswordResetEmail(payload: PasswordResetEmailPayload) {
  await sendWithResend({
    to: payload.to,
    subject: "Reset your Voyage password",
    html: `<p>Hello ${payload.displayName},</p><p>Reset your Voyage password by opening this link:</p><p><a href="${payload.resetUrl}">Reset password</a></p><p>If you did not ask for this, you can ignore this email.</p>`,
    logMessage: `Password reset email for ${payload.to}: ${payload.resetUrl}`
  });
}
