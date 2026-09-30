-- CreateTable
CREATE TABLE "AgencyInvitation" (
    "id" UUID NOT NULL,
    "agencyId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "invitedByUserId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" UUID,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgencyInvitation_tokenHash_key" ON "AgencyInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "AgencyInvitation_agencyId_idx" ON "AgencyInvitation"("agencyId");

-- CreateIndex
CREATE INDEX "AgencyInvitation_emailNormalized_idx" ON "AgencyInvitation"("emailNormalized");

-- CreateIndex
CREATE INDEX "AgencyInvitation_expiresAt_idx" ON "AgencyInvitation"("expiresAt");

-- CreateIndex
CREATE INDEX "AgencyInvitation_agencyId_emailNormalized_idx" ON "AgencyInvitation"("agencyId", "emailNormalized");

-- AddForeignKey
ALTER TABLE "AgencyInvitation" ADD CONSTRAINT "AgencyInvitation_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyInvitation" ADD CONSTRAINT "AgencyInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyInvitation" ADD CONSTRAINT "AgencyInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyInvitation" ADD CONSTRAINT "AgencyInvitation_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
