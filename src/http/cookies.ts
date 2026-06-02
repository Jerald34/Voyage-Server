import type { CookieOptions, Response } from "express";
import { env } from "../config/env";

// The SPA now reaches this API through a SAME-ORIGIN reverse proxy: the browser
// calls `/api/*` on the app's own origin and Next forwards it here (see the
// client's next.config.mjs `rewrites`). Because every authenticated request is
// therefore same-site, the session cookie can — and should — be `SameSite=Lax`.
//
// This matters most for iOS standalone PWAs: WebKit's Intelligent Tracking
// Prevention blocks cross-site `SameSite=None` cookies, which made sign-in appear
// to succeed (the login response body had the user) while every subsequent data
// fetch came back unauthenticated — empty threads and itineraries. A first-party
// Lax cookie is not subject to that blocking.
//
// `Secure` is kept on; it's accepted over http://localhost (a secure context),
// so this works in dev too.
const SESSION_COOKIE_ATTRS: Pick<CookieOptions, "httpOnly" | "secure" | "sameSite" | "path"> = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/"
};

export function setSessionCookie(response: Response, token: string) {
  response.cookie(env.SESSION_COOKIE_NAME, token, {
    ...SESSION_COOKIE_ATTRS,
    maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
  });
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(env.SESSION_COOKIE_NAME, SESSION_COOKIE_ATTRS);
}
