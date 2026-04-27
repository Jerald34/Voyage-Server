import { describe, expect, it, vi } from "vitest";
import {
  createAuthService,
  normalizeEmail,
  type AuthRepository,
  type EmailSender
} from "../src/modules/auth/authService";
import { hashToken } from "../src/services/tokens";

type UserRecord = Awaited<ReturnType<AuthRepository["createUser"]>>;
type VerificationRecord = Awaited<ReturnType<AuthRepository["createVerificationToken"]>>;
type SessionRecord = Awaited<ReturnType<AuthRepository["createSession"]>>;

function createMemoryAuthRepository(): AuthRepository & {
  users: UserRecord[];
  verificationTokens: VerificationRecord[];
  sessions: SessionRecord[];
} {
  const users: UserRecord[] = [];
  const verificationTokens: VerificationRecord[] = [];
  const sessions: SessionRecord[] = [];

  return {
    users,
    verificationTokens,
    sessions,
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
    }
  };
}

function createService() {
  const repository = createMemoryAuthRepository();
  const emailSender: EmailSender = {
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined)
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

  it("allows login before email verification", async () => {
    const { service } = createService();
    await service.registerWithEmail({
      email: "new@example.com",
      password: "password123",
      displayName: "New User"
    });

    const result = await service.loginWithEmail({
      email: "NEW@example.com",
      password: "password123"
    });

    expect(result.user.emailVerifiedAt).toBeNull();
    expect(result.sessionToken).toEqual(expect.any(String));
  });

  it("stores hashed email verification tokens", async () => {
    const { service, repository, emailSender } = createService();
    const registration = await service.registerWithEmail({
      email: "verify@example.com",
      password: "password123",
      displayName: "Verify Me"
    });

    await service.requestEmailVerification(registration.user.id);

    const secondToken = repository.verificationTokens.at(-1);
    expect(secondToken?.tokenHash).toEqual(expect.any(String));

    const emailCall = vi.mocked(emailSender.sendVerificationEmail).mock.calls.at(-1);
    const verificationUrl = new URL(emailCall?.[0].verificationUrl ?? "");
    const rawToken = verificationUrl.searchParams.get("token");

    expect(rawToken).toEqual(expect.any(String));
    expect(secondToken?.tokenHash).toBe(hashToken(rawToken ?? ""));
    expect(secondToken?.tokenHash).not.toBe(rawToken);
  });

  it("confirms a verification token and rejects reuse", async () => {
    const { service, emailSender } = createService();
    const registration = await service.registerWithEmail({
      email: "confirm@example.com",
      password: "password123",
      displayName: "Confirm Me"
    });
    const emailCall = vi.mocked(emailSender.sendVerificationEmail).mock.calls[0];
    const verificationUrl = new URL(emailCall[0].verificationUrl);
    const token = verificationUrl.searchParams.get("token") ?? "";

    const verifiedUser = await service.confirmEmailVerification(token);

    expect(verifiedUser.id).toBe(registration.user.id);
    expect(verifiedUser.emailVerifiedAt).toEqual(new Date("2026-04-27T12:00:00.000Z"));

    await expect(service.confirmEmailVerification(token)).rejects.toMatchObject({
      code: "INVALID_OR_EXPIRED_TOKEN",
      statusCode: 400
    });
  });
});
