export type VerificationEmailPayload = {
  to: string;
  displayName: string;
  verificationUrl: string;
};

export async function sendVerificationEmail(payload: VerificationEmailPayload) {
  if (!process.env.RESEND_API_KEY) {
    console.info(`Verification email for ${payload.to}: ${payload.verificationUrl}`);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "Voyage <no-reply@example.com>",
      to: payload.to,
      subject: "Verify your Voyage email",
      html: `<p>Hello ${payload.displayName},</p><p>Verify your Voyage email by opening this link:</p><p><a href="${payload.verificationUrl}">Verify email</a></p>`
    })
  });

  if (!response.ok) {
    throw new Error(`Resend verification email failed with status ${response.status}`);
  }
}
