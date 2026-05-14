import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env";
import { ApiError } from "../http/errors";

export type VerifiedOAuthClaims = {
  provider: "GOOGLE" | "APPLE";
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
};

const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const appleJwks = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

function readEmailVerified(value: unknown) {
  return value === true || value === "true";
}

async function exchangeGoogleAuthorizationCode(code: string) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new ApiError(501, "OAUTH_NOT_CONFIGURED", "Google sign-in is not configured.");
  }

  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: env.GOOGLE_REDIRECT_URI
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      401,
      "INVALID_OAUTH_TOKEN",
      data?.error_description || data?.error || "Google authorization code exchange failed."
    );
  }

  if (typeof data?.id_token !== "string" || !data.id_token) {
    throw new ApiError(401, "INVALID_OAUTH_TOKEN", "Google token response did not include an id_token.");
  }

  return data.id_token as string;
}

export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedOAuthClaims> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new ApiError(501, "OAUTH_NOT_CONFIGURED", "Google sign-in is not configured.");
  }

  const { payload } = await jwtVerify(idToken, googleJwks, {
    issuer: "https://accounts.google.com",
    audience: env.GOOGLE_CLIENT_ID
  });

  if (!payload.sub || typeof payload.email !== "string") {
    throw new ApiError(401, "INVALID_OAUTH_TOKEN", "Google token is missing required identity claims.");
  }

  return {
    provider: "GOOGLE",
    providerAccountId: payload.sub,
    email: payload.email,
    emailVerified: readEmailVerified(payload.email_verified),
    displayName: typeof payload.name === "string" ? payload.name : payload.email
  };
}

export async function verifyGoogleAuthorizationCode(code: string): Promise<VerifiedOAuthClaims> {
  const idToken = await exchangeGoogleAuthorizationCode(code);
  return verifyGoogleIdToken(idToken);
}

export async function verifyAppleIdToken(idToken: string): Promise<VerifiedOAuthClaims> {
  if (!env.APPLE_CLIENT_ID) {
    throw new ApiError(501, "OAUTH_NOT_CONFIGURED", "Apple sign-in is not configured.");
  }

  const { payload } = await jwtVerify(idToken, appleJwks, {
    issuer: "https://appleid.apple.com",
    audience: env.APPLE_CLIENT_ID
  });

  if (!payload.sub || typeof payload.email !== "string") {
    throw new ApiError(401, "INVALID_OAUTH_TOKEN", "Apple token is missing required identity claims.");
  }

  return {
    provider: "APPLE",
    providerAccountId: payload.sub,
    email: payload.email,
    emailVerified: readEmailVerified(payload.email_verified),
    displayName: typeof payload.name === "string" ? payload.name : payload.email
  };
}
