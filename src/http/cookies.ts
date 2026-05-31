import type { CookieOptions, Response } from "express";
import { env } from "../config/env";

// The SPA is served from a DIFFERENT origin/port than this API (dev:
// localhost:3000 -> localhost:4000; prod: separate hosts). Every authenticated
// request — including the fetch("/auth/me") the app makes right after the OAuth
// redirect — is therefore CROSS-SITE. Browsers withhold a `SameSite=Lax` cookie
// from cross-site, non-navigational fetch/XHR requests, so a Lax session cookie
// would never reach /auth/me and an OAuth sign-in would bounce the user back out
// (the "stranded on the landing page" bug). The cookie must be `SameSite=None`
// so it rides cross-site fetches, and `SameSite=None` is only honored by browsers
// when `Secure` is also set. `Secure` cookies are accepted over http://localhost
// (a secure context), so this works in dev too — do NOT downgrade to Lax for dev.
const SESSION_COOKIE_ATTRS: Pick<CookieOptions, "httpOnly" | "secure" | "sameSite" | "path"> = {
  httpOnly: true,
  secure: true,
  sameSite: "none",
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
