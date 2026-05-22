import type { PrismaClient } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../http/errors";
import {
  sendPasswordResetEmail,
  type VerificationEmailPayload
} from "../../services/email";
import { hashPassword, verifyPassword } from "../../services/password";
import { createRandomToken, hashToken } from "../../services/tokens";
import type { AuthUserRecord, AuthServiceOptions, AuthRepository, ProviderAccountRecord } from "./authTypes";

export * from "./authTypes";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function assertActiveUser(user: AuthUserRecord) {
  if (user.status !== "ACTIVE") {
    throw new ApiError(403, "USER_DISABLED", "This account is disabled.");
  }
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function createAuthService(options: AuthServiceOptions) {
  const now = options.now ?? (() => new Date());
  const appOrigin = options.appOrigin ?? env.APP_ORIGIN;
  const sessionTtlDays = options.sessionTtlDays ?? env.SESSION_TTL_DAYS;
  const passwordPepper = options.passwordPepper ?? env.PASSWORD_PEPPER;

  async function createSession(userId: string) {
    const sessionToken = createRandomToken();
    const session = await options.repository.createSession({
      userId,
      tokenHash: hashToken(sessionToken),
      expiresAt: addDays(now(), sessionTtlDays)
    });

    return { session, sessionToken };
  }

  async function requestEmailVerification(userId: string) {
    void userId;
    throw new ApiError(
      501,
      "EMAIL_VERIFICATION_UNAVAILABLE",
      "Email verification is not available in this deployment."
    );
  }

  async function requestPasswordReset(userId: string) {
    const user = await options.repository.findUserById(userId);
    if (!user) {
      throw new ApiError(404, "USER_NOT_FOUND", "User not found.");
    }

    assertActiveUser(user);

    const requestedAt = now();
    await options.repository.markUnusedPasswordResetTokensUsed(user.id, requestedAt);

    const rawToken = createRandomToken();
    await options.repository.createPasswordResetToken({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: addHours(requestedAt, 24)
    });

    const resetUrl = new URL("/reset-password", appOrigin);
    resetUrl.searchParams.set("token", rawToken);

    await options.emailSender.sendPasswordResetEmail({
      to: user.email,
      displayName: user.displayName,
      resetUrl: resetUrl.toString()
    });
  }

  return {
    async registerWithEmail(input: { email: string; password: string; displayName: string }) {
      const emailNormalized = normalizeEmail(input.email);
      const existingUser = await options.repository.findUserByEmailNormalized(emailNormalized);
      if (existingUser) {
        throw new ApiError(409, "EMAIL_ALREADY_USED", "That email is already registered.");
      }

      if (input.password.length < 8) {
        throw new ApiError(400, "PASSWORD_TOO_SHORT", "Password must be at least 8 characters.");
      }

      const user = await options.repository.createUser({
        email: input.email.trim(),
        emailNormalized,
        passwordHash: await hashPassword(input.password, passwordPepper),
        displayName: input.displayName.trim(),
        emailVerifiedAt: now()
      });
      const { sessionToken, session } = await createSession(user.id);
      return { user, session, sessionToken };
    },

    async loginWithEmail(input: { email: string; password: string }) {
      const user = await options.repository.findUserByEmailNormalized(normalizeEmail(input.email));
      if (!user || !user.passwordHash) {
        throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
      }

      assertActiveUser(user);

      const passwordMatches = await verifyPassword(input.password, user.passwordHash, passwordPepper);
      if (!passwordMatches) {
        throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
      }

      const { sessionToken, session } = await createSession(user.id);
      return { user, session, sessionToken };
    },

    async logout(sessionToken: string) {
      await options.repository.deleteSessionByTokenHash(hashToken(sessionToken));
    },

    async requestPasswordReset(input: { email: string }) {
      const user = await options.repository.findUserByEmailNormalized(normalizeEmail(input.email));
      if (!user || user.status !== "ACTIVE") {
        return;
      }

      await requestPasswordReset(user.id);
    },

    async confirmPasswordReset(input: { token: string; password: string }) {
      if (input.password.length < 8) {
        throw new ApiError(400, "PASSWORD_TOO_SHORT", "Password must be at least 8 characters.");
      }

      const token = await options.repository.findPasswordResetTokenByHash(hashToken(input.token));
      if (!token || token.usedAt || token.expiresAt <= now()) {
        throw new ApiError(400, "INVALID_OR_EXPIRED_TOKEN", "Password reset link is invalid or expired.");
      }

      const user = await options.repository.findUserById(token.userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "User not found.");
      }

      assertActiveUser(user);

      const usedAt = now();
      await options.repository.markUnusedPasswordResetTokensUsed(user.id, usedAt);
      await options.repository.updateUser(user.id, {
        passwordHash: await hashPassword(input.password, passwordPepper)
      });
      await options.repository.deleteSessionsByUserId(user.id);
      await options.repository.markPasswordResetTokenUsed(token.id, usedAt);
    },

    async updateProfile(user: AuthUserRecord, input: { displayName: string }) {
      assertActiveUser(user);

      const displayName = input.displayName.trim();
      if (!displayName) {
        throw new ApiError(400, "DISPLAY_NAME_REQUIRED", "Display name is required.");
      }

      return options.repository.updateUser(user.id, { displayName });
    },

    requestEmailVerification,

    async confirmEmailVerification(rawToken: string) {
      void rawToken;
      throw new ApiError(
        501,
        "EMAIL_VERIFICATION_UNAVAILABLE",
        "Email verification is not available in this deployment."
      );
    },

    async checkEmail(email: string) {
      const emailNormalized = normalizeEmail(email);
      const existingUser = await options.repository.findUserByEmailNormalized(emailNormalized);
      return { email: emailNormalized, available: !existingUser };
    },

    async signInWithVerifiedOAuth(input: {
      provider: "GOOGLE" | "APPLE";
      providerAccountId: string;
      email: string;
      emailVerified: boolean;
      displayName: string;
    }) {
      const existingProviderAccount = await options.repository.findProviderAccount(
        input.provider,
        input.providerAccountId
      );

      if (existingProviderAccount) {
        assertActiveUser(existingProviderAccount.user);
        const { sessionToken, session } = await createSession(existingProviderAccount.user.id);
        return { user: existingProviderAccount.user, session, sessionToken };
      }

      const emailNormalized = normalizeEmail(input.email);
      let user = await options.repository.findUserByEmailNormalized(emailNormalized);
      const verifiedAt = input.emailVerified ? now() : null;

      if (!user) {
        user = await options.repository.createUser({
          email: input.email.trim(),
          emailNormalized,
          passwordHash: null,
          displayName: input.displayName.trim() || emailNormalized,
          emailVerifiedAt: verifiedAt
        });
      } else {
        assertActiveUser(user);
        if (verifiedAt && !user.emailVerifiedAt) {
          user = await options.repository.updateUser(user.id, { emailVerifiedAt: verifiedAt });
        }
      }

      await options.repository.createProviderAccount({
        userId: user.id,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
        providerEmail: input.email,
        providerEmailVerified: input.emailVerified
      });

      const { sessionToken, session } = await createSession(user.id);
      return { user, session, sessionToken };
    }
  };
}

function includeMemberships() {
  return {
    memberships: {
      include: {
        agency: {
          select: {
            id: true,
            status: true,
            name: true,
            businessPhone: true,
            businessEmail: true,
            city: true,
            country: true,
            rejectionReason: true,
            suspensionReason: true
          }
        }
      }
    }
  } as const;
}

export function createPrismaAuthRepository(client: PrismaClient = prisma): AuthRepository {
  return {
    async findUserByEmailNormalized(emailNormalized) {
      return client.user.findUnique({
        where: { emailNormalized },
        include: includeMemberships()
      }) as Promise<AuthUserRecord | null>;
    },
    async findUserById(id) {
      return client.user.findUnique({
        where: { id },
        include: includeMemberships()
      }) as Promise<AuthUserRecord | null>;
    },
    async createUser(data) {
      return client.user.create({
        data,
        include: includeMemberships()
      }) as Promise<AuthUserRecord>;
    },
    async updateUser(id, data) {
      return client.user.update({
        where: { id },
        data,
        include: includeMemberships()
      }) as Promise<AuthUserRecord>;
    },
    async createSession(data) {
      return client.session.create({ data });
    },
    async deleteSessionsByUserId(userId) {
      await client.session.deleteMany({ where: { userId } });
    },
    async deleteSessionByTokenHash(tokenHash) {
      await client.session.deleteMany({ where: { tokenHash } });
    },
    async markUnusedVerificationTokensUsed(userId, usedAt) {
      await client.emailVerificationToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt }
      });
    },
    async createVerificationToken(data) {
      return client.emailVerificationToken.create({ data });
    },
    async findVerificationTokenByHash(tokenHash) {
      return client.emailVerificationToken.findUnique({ where: { tokenHash } });
    },
    async markVerificationTokenUsed(id, usedAt) {
      return client.emailVerificationToken.update({
        where: { id },
        data: { usedAt }
      });
    },
    async markUnusedPasswordResetTokensUsed(userId, usedAt) {
      await client.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt }
      });
    },
    async createPasswordResetToken(data) {
      return client.passwordResetToken.create({ data });
    },
    async findPasswordResetTokenByHash(tokenHash) {
      return client.passwordResetToken.findUnique({ where: { tokenHash } });
    },
    async markPasswordResetTokenUsed(id, usedAt) {
      return client.passwordResetToken.update({
        where: { id },
        data: { usedAt }
      });
    },
    async findProviderAccount(provider, providerAccountId) {
      return client.authProviderAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider,
            providerAccountId
          }
        },
        include: {
          user: {
            include: includeMemberships()
          }
        }
      }) as unknown as Promise<ProviderAccountRecord | null>;
    },
    async createProviderAccount(data) {
      return client.authProviderAccount.create({
        data,
        include: {
          user: {
            include: includeMemberships()
          }
        }
      }) as unknown as Promise<ProviderAccountRecord>;
    }
  };
}

export const authService = createAuthService({
  repository: createPrismaAuthRepository(),
  emailSender: {
    sendVerificationEmail: async () => undefined,
    sendPasswordResetEmail
  }
});
