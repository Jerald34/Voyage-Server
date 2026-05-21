import type { PrismaClient } from "@prisma/client";
import type { VerificationEmailPayload } from "../../services/email";

export type AuthUserRecord = {
  id: string;
  email: string;
  emailNormalized: string;
  passwordHash: string | null;
  displayName: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED";
  emailVerifiedAt: Date | null;
  avatarImageId: string | null;
  memberships: unknown[];
};

export type CreateUserInput = {
  email: string;
  emailNormalized: string;
  passwordHash: string | null;
  displayName: string;
  emailVerifiedAt?: Date | null;
};

export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type VerificationTokenRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type PasswordResetTokenRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type ProviderAccountRecord = {
  id: string;
  userId: string;
  provider: "GOOGLE" | "APPLE";
  providerAccountId: string;
  providerEmail: string | null;
  providerEmailVerified: boolean;
  user: AuthUserRecord;
  createdAt: Date;
  updatedAt: Date;
};

export type AuthRepository = {
  findUserByEmailNormalized(emailNormalized: string): Promise<AuthUserRecord | null>;
  findUserById(id: string): Promise<AuthUserRecord | null>;
  createUser(data: CreateUserInput): Promise<AuthUserRecord>;
  updateUser(id: string, data: Partial<Pick<AuthUserRecord, "emailVerifiedAt" | "displayName" | "passwordHash">>): Promise<AuthUserRecord>;
  createSession(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<SessionRecord>;
  deleteSessionsByUserId(userId: string): Promise<void>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
  markUnusedVerificationTokensUsed(userId: string, usedAt: Date): Promise<void>;
  createVerificationToken(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<VerificationTokenRecord>;
  findVerificationTokenByHash(tokenHash: string): Promise<VerificationTokenRecord | null>;
  markVerificationTokenUsed(id: string, usedAt: Date): Promise<VerificationTokenRecord>;
  markUnusedPasswordResetTokensUsed(userId: string, usedAt: Date): Promise<void>;
  createPasswordResetToken(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<PasswordResetTokenRecord>;
  findPasswordResetTokenByHash(tokenHash: string): Promise<PasswordResetTokenRecord | null>;
  markPasswordResetTokenUsed(id: string, usedAt: Date): Promise<PasswordResetTokenRecord>;
  findProviderAccount(provider: "GOOGLE" | "APPLE", providerAccountId: string): Promise<ProviderAccountRecord | null>;
  createProviderAccount(data: {
    userId: string;
    provider: "GOOGLE" | "APPLE";
    providerAccountId: string;
    providerEmail: string | null;
    providerEmailVerified: boolean;
  }): Promise<ProviderAccountRecord>;
};

export type EmailSender = {
  sendVerificationEmail(payload: VerificationEmailPayload): Promise<void>;
  sendPasswordResetEmail(payload: { to: string; displayName: string; resetUrl: string }): Promise<void>;
};

export type AuthServiceOptions = {
  repository: AuthRepository;
  emailSender: EmailSender;
  now?: () => Date;
  appOrigin?: string;
  sessionTtlDays?: number;
  passwordPepper?: string;
};
