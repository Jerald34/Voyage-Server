import { describe, expect, it, vi } from "vitest";
import {
  createAuthService,
  normalizeEmail,
  type AuthRepository,
  type EmailSender
} from "../src/modules/auth/authService";
import { serializeUser } from "../src/modules/auth/authRoutes";
import { hashToken } from "../src/services/tokens";

type UserRecord = Awaited<ReturnType<AuthRepository["createUser"]>>;
type VerificationRecord = Awaited<ReturnType<AuthRepository["createVerificationToken"]>>;
type PasswordResetRecord = Awaited<ReturnType<AuthRepository["createPasswordResetToken"]>>;
type SessionRecord = Awaited<ReturnType<AuthRepository["createSession"]>>;
type ProviderAccountRecord = NonNullable<Awaited<ReturnType<AuthRepository["findProviderAccount"]>>>;

function createMemoryAuthRepository(): AuthRepository & {
  users: UserRecord[];
  verificationTokens: VerificationRecord[];
  passwordResetTokens: PasswordResetRecord[];
  sessions: SessionRecord[];
  providerAccounts: ProviderAccountRecord[];
} {
  const users: UserRecord[] = [];
  const verificationTokens: VerificationRecord[] = [];
  const passwordResetTokens: PasswordResetRecord[] = [];
  const sessions: SessionRecord[] = [];
  const providerAccounts: ProviderAccountRecord[] = [];

  return {
    users,
    verificationTokens,
    passwordResetTokens,
    sessions,
    providerAccounts,
    async findUserByEmailNormalized(emailNormalized) {
      return users.find((user) => user.emailNormalized === emailNormalized) ?? null;
    },
    async findUserById(id) {
      return users.find((user) => user.id === id) ?? null;
    },
    async createUser(data) {
      const user = {
        id: `user-${users.length + 1}`,
        role: "USER" as const,
        status: "ACTIVE" as const,
        emailVerifiedAt: null,
        avatarImageId: null,
        memberships: [],
        ...data
      };
      users.push(user);
      return user;
    },
    async updateUser(id, data) {
      const user = users.find((candidate) => candidate.id === id);
      if (!user) {
        throw new Error(`Missing user ${id}`);
      }
      Object.assign(user, data);
      return user;
    },
    async createSession(data) {
      const session = {
        id: `session-${sessions.length + 1}`,
        createdAt: new Date("2026-04-27T00:00:00.000Z"),
        updatedAt: new Date("2026-04-27T00:00:00.000Z"),
        ...data
      };
      sessions.push(session);
      return session;
    },
    async deleteSessionsByUserId(userId) {
      for (let index = sessions.length - 1; index >= 0; index -= 1) {
        if (sessions[index].userId === userId) {
          sessions.splice(index, 1);
        }
      }
    },
    async deleteSessionByTokenHash(tokenHash) {
      const index = sessions.findIndex((session) => session.tokenHash === tokenHash);
      if (index >= 0) {
        sessions.splice(index, 1);
      }
    },
    async markUnusedVerificationTokensUsed(userId, usedAt) {
      for (const token of verificationTokens) {
        if (token.userId === userId && !token.usedAt) {
          token.usedAt = usedAt;
        }
      }
    },
    async createVerificationToken(data) {
      const token = {
        id: `verification-${verificationTokens.length + 1}`,
        createdAt: new Date("2026-04-27T00:00:00.000Z"),
        usedAt: null,
        ...data
      };
      verificationTokens.push(token);
      return token;
    },
    async findVerificationTokenByHash(tokenHash) {
      return verificationTokens.find((token) => token.tokenHash === tokenHash) ?? null;
    },
    async markVerificationTokenUsed(id, usedAt) {
      const token = verificationTokens.find((candidate) => candidate.id === id);
      if (!token) {
        throw new Error(`Missing token ${id}`);
      }
      token.usedAt = usedAt;
      return token;
    },
    async markUnusedPasswordResetTokensUsed(userId, usedAt) {
      for (const token of passwordResetTokens) {
        if (token.userId === userId && !token.usedAt) {
          token.usedAt = usedAt;
        }
      }
    },
    async createPasswordResetToken(data) {
      const token = {
        id: `password-reset-${passwordResetTokens.length + 1}`,
        createdAt: new Date("2026-04-27T00:00:00.000Z"),
        usedAt: null,
        ...data
      };
      passwordResetTokens.push(token);
      return token;
    },
    async findPasswordResetTokenByHash(tokenHash) {
      return passwordResetTokens.find((token) => token.tokenHash === tokenHash) ?? null;
    },
    async markPasswordResetTokenUsed(id, usedAt) {
      const token = passwordResetTokens.find((candidate) => candidate.id === id);
      if (!token) {
        throw new Error(`Missing token ${id}`);
      }
      token.usedAt = usedAt;
      return token;
    },
    async findProviderAccount(provider, providerAccountId) {
      return (
        providerAccounts.find(
          (account) => account.provider === provider && account.providerAccountId === providerAccountId
        ) ?? null
      );
    },
    async createProviderAccount(data) {
      const account = {
        id: `provider-${providerAccounts.length + 1}`,
        createdAt: new Date("2026-04-27T00:00:00.000Z"),
        updatedAt: new Date("2026-04-27T00:00:00.000Z"),
        user: users.find((user) => user.id === data.userId)!,
        ...data
      };
      providerAccounts.push(account);
      return account;
    }
  };
}

function createService() {
  const repository = createMemoryAuthRepository();
  const emailSender: EmailSender = {
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined)
  };
  const now = () => new Date("2026-04-27T12:00:00.000Z");
  const service = createAuthService({
    repository,
    emailSender,
    now,
    appOrigin: "http://localhost:3000",
    sessionTtlDays: 30,
    passwordPepper: "pepper"
  });

  return { service, repository, emailSender };
}

describe("auth service", () => {
  it("normalizes email addresses before lookup", () => {
    expect(normalizeEmail(" Test@Example.COM ")).toBe("test@example.com");
  });

  it("rejects duplicate email registration", async () => {
    const { service, repository } = createService();
    await repository.createUser({
      email: "used@example.com",
      emailNormalized: "used@example.com",
      passwordHash: "hash",
      displayName: "Used Email"
    });

    await expect(
      service.registerWithEmail({
        email: " Used@Example.com ",
        password: "password123",
        displayName: "Duplicate"
      })
    ).rejects.toMatchObject({
      code: "EMAIL_ALREADY_USED",
      statusCode: 409
    });
  });

  it("registers users as verified without sending a verification email", async () => {
    const { service, emailSender } = createService();

    const registration = await service.registerWithEmail({
      email: "new@example.com",
      password: "password123",
      displayName: "New User"
    });

    expect(registration.user.emailVerifiedAt).toEqual(new Date("2026-04-27T12:00:00.000Z"));
    expect(emailSender.sendVerificationEmail).not.toHaveBeenCalled();

    const result = await service.loginWithEmail({
      email: "NEW@example.com",
      password: "password123"
    });

    expect(result.user.emailVerifiedAt).toEqual(new Date("2026-04-27T12:00:00.000Z"));
    expect(result.sessionToken).toEqual(expect.any(String));
  });

  it("updates a user's display name", async () => {
    const { service } = createService();
    const registration = await service.registerWithEmail({
      email: "profile@example.com",
      password: "password123",
      displayName: "Old Name"
    });

    const updated = await service.updateProfile(registration.user, {
      displayName: "New Name"
    });

    expect(updated.displayName).toBe("New Name");
    expect(updated.email).toBe("profile@example.com");
  });

  it("rejects a blank display name update", async () => {
    const { service } = createService();
    const registration = await service.registerWithEmail({
      email: "blank-name@example.com",
      password: "password123",
      displayName: "Valid Name"
    });

    await expect(
      service.updateProfile(registration.user, {
        displayName: "   "
      })
    ).rejects.toMatchObject({
      code: "DISPLAY_NAME_REQUIRED",
      statusCode: 400
    });
  });

  it("rejects direct email verification requests in this deployment", async () => {
    const { service } = createService();

    await expect(service.requestEmailVerification("user-1")).rejects.toMatchObject({
      code: "EMAIL_VERIFICATION_UNAVAILABLE",
      statusCode: 501
    });
  });

  it("sends a password reset email with a hashed token", async () => {
    const { service, repository, emailSender } = createService();
    const registration = await service.registerWithEmail({
      email: "reset@example.com",
      password: "password123",
      displayName: "Reset Me"
    });

    await service.requestPasswordReset({
      email: registration.user.email
    });

    const token = repository.passwordResetTokens.at(-1);
    expect(token?.tokenHash).toEqual(expect.any(String));

    const emailCall = vi.mocked(emailSender.sendPasswordResetEmail).mock.calls.at(-1);
    const resetUrl = new URL(emailCall?.[0].resetUrl ?? "");
    const rawToken = resetUrl.searchParams.get("token");

    expect(rawToken).toEqual(expect.any(String));
    expect(token?.tokenHash).toBe(hashToken(rawToken ?? ""));
    expect(token?.tokenHash).not.toBe(rawToken);
  });

  it("resets a password, invalidates sessions, and rejects the old password", async () => {
    const { service, repository, emailSender } = createService();
    const registration = await service.registerWithEmail({
      email: "change@example.com",
      password: "password123",
      displayName: "Change Me"
    });

    repository.sessions.push({
      id: "session-extra",
      userId: registration.user.id,
      tokenHash: "hash-extra",
      expiresAt: new Date("2026-05-27T00:00:00.000Z"),
      createdAt: new Date("2026-04-27T00:00:00.000Z"),
      updatedAt: new Date("2026-04-27T00:00:00.000Z")
    });

    await service.requestPasswordReset({
      email: registration.user.email
    });

    const emailCall = vi.mocked(emailSender.sendPasswordResetEmail).mock.calls.at(-1);
    const resetUrl = new URL(emailCall?.[0].resetUrl ?? "");
    const token = resetUrl.searchParams.get("token") ?? "";

    await service.confirmPasswordReset({
      token,
      password: "newpassword123"
    });

    expect(repository.sessions).toHaveLength(0);

    await expect(
      service.loginWithEmail({
        email: registration.user.email,
        password: "password123"
      })
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      statusCode: 401
    });

    const login = await service.loginWithEmail({
      email: registration.user.email,
      password: "newpassword123"
    });
    expect(login.user.id).toBe(registration.user.id);
  });

  it("creates a verified user from Google sign-in", async () => {
    const { service, repository } = createService();

    const result = await service.signInWithVerifiedOAuth({
      provider: "GOOGLE",
      providerAccountId: "google-1",
      email: "Google@Example.com",
      emailVerified: true,
      displayName: "Google User"
    });

    expect(result.user.emailNormalized).toBe("google@example.com");
    expect(result.user.emailVerifiedAt).toEqual(new Date("2026-04-27T12:00:00.000Z"));
    expect(repository.providerAccounts).toHaveLength(1);
    expect(repository.providerAccounts[0]).toMatchObject({
      provider: "GOOGLE",
      providerAccountId: "google-1",
      providerEmail: "Google@Example.com",
      providerEmailVerified: true,
      userId: result.user.id
    });
  });

  it("creates a verified user from Apple ID sign-in", async () => {
    const { service } = createService();

    const result = await service.signInWithVerifiedOAuth({
      provider: "APPLE",
      providerAccountId: "apple-1",
      email: "relay@privaterelay.appleid.com",
      emailVerified: true,
      displayName: "Apple User"
    });

    expect(result.user.emailNormalized).toBe("relay@privaterelay.appleid.com");
    expect(result.user.emailVerifiedAt).toEqual(new Date("2026-04-27T12:00:00.000Z"));
  });

  it("links a provider account to an existing normalized email", async () => {
    const { service, repository } = createService();
    const existingUser = await repository.createUser({
      email: "owner@example.com",
      emailNormalized: "owner@example.com",
      passwordHash: null,
      displayName: "Existing Owner"
    });

    const result = await service.signInWithVerifiedOAuth({
      provider: "GOOGLE",
      providerAccountId: "google-owner",
      email: " Owner@Example.com ",
      emailVerified: true,
      displayName: "Owner From Google"
    });

    expect(result.user.id).toBe(existingUser.id);
    expect(result.user.emailVerifiedAt).toEqual(new Date("2026-04-27T12:00:00.000Z"));
    expect(repository.providerAccounts[0].userId).toBe(existingUser.id);
  });

  it("uses an existing provider account on repeat sign-in", async () => {
    const { service, repository } = createService();

    const first = await service.signInWithVerifiedOAuth({
      provider: "APPLE",
      providerAccountId: "apple-repeat",
      email: "repeat@example.com",
      emailVerified: true,
      displayName: "Repeat User"
    });
    const second = await service.signInWithVerifiedOAuth({
      provider: "APPLE",
      providerAccountId: "apple-repeat",
      email: "changed@example.com",
      emailVerified: true,
      displayName: "Changed User"
    });

    expect(second.user.id).toBe(first.user.id);
    expect(repository.users).toHaveLength(1);
    expect(repository.providerAccounts).toHaveLength(1);
  });
});

describe("auth route serialization", () => {
  it("includes agency registration city and country in memberships", () => {
    const user = {
      id: "user-1",
      email: "owner@example.com",
      displayName: "Agency Owner",
      role: "USER",
      status: "ACTIVE",
      emailVerifiedAt: null,
      memberships: [
        {
          agencyId: "agency-1",
          role: "OWNER",
          status: "ACTIVE",
          agency: {
            id: "agency-1",
            status: "VERIFIED",
            name: "Voyage Baguio",
            city: "Baguio",
            country: "Philippines",
            rejectionReason: null,
            suspensionReason: null,
          },
        },
      ],
    };

    expect(serializeUser(user).memberships[0].agency).toMatchObject({
      city: "Baguio",
      country: "Philippines",
    });
  });
});
