-- Rename the enum value ADMIN to SUPER_ADMIN to disambiguate from
-- agency-level MembershipRole.ADMIN. Existing rows update transparently.
ALTER TYPE "UserRole" RENAME VALUE 'ADMIN' TO 'SUPER_ADMIN';
