export type AgencyUser = {
  id: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED";
  emailVerifiedAt: Date | null;
};

export type AgencyRecord = {
  id: string;
  name: string;
  slug: string;
  status: "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED";
  ownerUserId: string;
  submittedAt: Date;
  verifiedAt: Date | null;
  verifiedByAdminUserId: string | null;
  rejectedAt: Date | null;
  rejectedByAdminUserId: string | null;
  rejectionReason: string | null;
  suspendedAt: Date | null;
  suspendedByAdminUserId: string | null;
  suspensionReason: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  country: string | null;
  city: string | null;
};

export type AgencyWithOwner = AgencyRecord & {
  ownerUser: { id: string; email: string; displayName: string };
};

export type AgencyDetailRecord = AgencyWithOwner & {
  auditEvents: AdminAuditRecord[];
};

export type AgencyMembershipRecord = {
  id: string;
  agencyId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "STAFF";
  status: "ACTIVE" | "DISABLED";
};

export type AdminAuditRecord = {
  id: string;
  adminUserId: string;
  action:
    | "AGENCY_APPROVED"
    | "AGENCY_REJECTED"
    | "AGENCY_SUSPENDED"
    | "AGENCY_UNSUSPENDED"
    | "USER_PROMOTED_TO_ADMIN"
    | "USER_DISABLED";
  targetType: string;
  targetId: string;
  reason: string | null;
  metadata?: unknown;
  createdAt: Date;
};

export type AgencyRepository = {
  createAgency(data: {
    name: string;
    slug: string;
    ownerUserId: string;
    businessPhone?: string;
    businessEmail?: string;
    country?: string;
    city?: string;
    logoImageId?: string;
  }): Promise<AgencyRecord>;
  createOwnerMembership(data: { agencyId: string; userId: string }): Promise<AgencyMembershipRecord>;
  findMembership(agencyId: string, userId: string): Promise<AgencyMembershipRecord | null>;
  listPendingAgencies(): Promise<AgencyRecord[]>;
  listAgencies(status?: string): Promise<AgencyWithOwner[]>;
  findAgencyById(id: string): Promise<AgencyRecord | null>;
  findAgencyByIdWithOwner(id: string): Promise<AgencyWithOwner | null>;
  countAgenciesByStatus(status: string): Promise<number>;
  listAuditEventsForTarget(targetType: string, targetId: string): Promise<AdminAuditRecord[]>;
  updateAgency(id: string, data: Partial<AgencyRecord>): Promise<AgencyRecord>;
  createAdminAuditEvent(data: Omit<AdminAuditRecord, "id" | "createdAt">): Promise<AdminAuditRecord>;
};
