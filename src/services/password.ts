import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

function applyPepper(password: string, pepper: string) {
  return `${password}${pepper}`;
}

export async function hashPassword(password: string, pepper = "") {
  return bcrypt.hash(applyPepper(password, pepper), SALT_ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string, pepper = "") {
  return bcrypt.compare(applyPepper(password, pepper), passwordHash);
}
