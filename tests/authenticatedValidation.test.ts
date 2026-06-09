import express, { type Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const VALID_AGENCY_ID = "11111111-1111-4111-8111-111111111111";
const VALID_ITINERARY_ID = "22222222-2222-4222-8222-222222222222";
const VALID_THREAD_ID = "33333333-3333-4333-8333-333333333333";
const VALID_RUN_ID = "44444444-4444-4444-8444-444444444444";
const VALID_SHARE_ID = "55555555-5555-4555-8555-555555555555";
const VALID_COMMENT_ID = "66666666-6666-4666-8666-666666666666";
const VALID_REPORT_ID = "77777777-7777-4777-8777-777777777777";
const VALID_IMAGE_ID = "88888888-8888-4888-8888-888888888888";
const VALID_MEMBERSHIP_ID = "99999999-9999-4999-8999-999999999999";
const VALID_INVITATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VALID_TRIP_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const {
  mockRequireVerifiedAgencyMember,
  mockRequireAgencyAdmin,
  mockRequireAgencyOwner,
  mockRequireTripAccess,
  mockDeleteAgency,
  mockListAllAgencies,
  mockGetAgencyDetail,
  mockApproveAgency,
  mockRejectAgency,
  mockSuspendAgency,
  mockUnsuspendAgency,
  mockUpdateAgencySettings,
  mockCreateAgencyApplication,
  mockCreateReport,
  mockListReports,
  mockGetReport,
  mockUpdateReport,
  mockInviteMember,
  mockListMembers,
  mockListOutstandingInvitations,
  mockRevokeInvitation,
  mockChangeMemberRole,
  mockRemoveMember,
  mockTransferOwnership,
  mockRequestUpload,
  mockCompleteUpload,
  mockCreateReadUrl,
  mockCreatePersonalItinerary,
  mockGetPersonalItinerary,
  mockUpdatePersonalItinerary,
  mockDeletePersonalItinerary,
  mockListPersonalItineraries,
  mockListPersonalThreads,
  mockCreatePersonalThread,
  mockCreatePersonalShare,
  mockListAgentThreads,
  mockCreateAgentThread,
  mockGetAgentThread,
  mockDeleteAgentThread,
  mockSaveItineraryThread,
  mockUpdateAgentThreadTitle,
  mockAppendUserMessageAndCreateRun,
  mockStartAgentRun,
  mockListRunEvents,
  mockCancelRun,
  mockListThreadMessages,
  mockListTripsForUser,
  mockGetItinerary,
  mockReplaceDraft,
  mockDeleteTrip,
  mockApproveTrip,
  mockCreateShare,
  mockListSharesForTrip,
  mockGetUnreadCommentCount,
  mockGetUnreadCommentCountsByTrip,
  mockRevokeShare,
  mockListComments,
  mockReplyToComment,
  mockGetBootstrap,
  mockListRatedHistory,
  mockGetRatedItinerary,
  mockInsertFromRated,
  mockClientTripFindUnique,
  mockUserFindUnique,
  mockUserUpdate,
  mockPlaceSnapshotFindFirst,
  mockSessionFindUnique,
  mockExecuteRawUnsafe
} = vi.hoisted(() => ({
  mockRequireVerifiedAgencyMember: vi.fn(),
  mockRequireAgencyAdmin: vi.fn(),
  mockRequireAgencyOwner: vi.fn(),
  mockRequireTripAccess: vi.fn(),
  mockDeleteAgency: vi.fn(),
  mockListAllAgencies: vi.fn(),
  mockGetAgencyDetail: vi.fn(),
  mockApproveAgency: vi.fn(),
  mockRejectAgency: vi.fn(),
  mockSuspendAgency: vi.fn(),
  mockUnsuspendAgency: vi.fn(),
  mockUpdateAgencySettings: vi.fn(),
  mockCreateAgencyApplication: vi.fn(),
  mockCreateReport: vi.fn(),
  mockListReports: vi.fn(),
  mockGetReport: vi.fn(),
  mockUpdateReport: vi.fn(),
  mockInviteMember: vi.fn(),
  mockListMembers: vi.fn(),
  mockListOutstandingInvitations: vi.fn(),
  mockRevokeInvitation: vi.fn(),
  mockChangeMemberRole: vi.fn(),
  mockRemoveMember: vi.fn(),
  mockTransferOwnership: vi.fn(),
  mockRequestUpload: vi.fn(),
  mockCompleteUpload: vi.fn(),
  mockCreateReadUrl: vi.fn(),
  mockCreatePersonalItinerary: vi.fn(),
  mockGetPersonalItinerary: vi.fn(),
  mockUpdatePersonalItinerary: vi.fn(),
  mockDeletePersonalItinerary: vi.fn(),
  mockListPersonalItineraries: vi.fn(),
  mockListPersonalThreads: vi.fn(),
  mockCreatePersonalThread: vi.fn(),
  mockCreatePersonalShare: vi.fn(),
  mockListAgentThreads: vi.fn(),
  mockCreateAgentThread: vi.fn(),
  mockGetAgentThread: vi.fn(),
  mockDeleteAgentThread: vi.fn(),
  mockSaveItineraryThread: vi.fn(),
  mockUpdateAgentThreadTitle: vi.fn(),
  mockAppendUserMessageAndCreateRun: vi.fn(),
  mockStartAgentRun: vi.fn(),
  mockListRunEvents: vi.fn(),
  mockCancelRun: vi.fn(),
  mockListThreadMessages: vi.fn(),
  mockListTripsForUser: vi.fn(),
  mockGetItinerary: vi.fn(),
  mockReplaceDraft: vi.fn(),
  mockDeleteTrip: vi.fn(),
  mockApproveTrip: vi.fn(),
  mockCreateShare: vi.fn(),
  mockListSharesForTrip: vi.fn(),
  mockGetUnreadCommentCount: vi.fn(),
  mockGetUnreadCommentCountsByTrip: vi.fn(),
  mockRevokeShare: vi.fn(),
  mockListComments: vi.fn(),
  mockReplyToComment: vi.fn(),
  mockGetBootstrap: vi.fn(),
  mockListRatedHistory: vi.fn(),
  mockGetRatedItinerary: vi.fn(),
  mockInsertFromRated: vi.fn(),
  mockClientTripFindUnique: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockPlaceSnapshotFindFirst: vi.fn(),
  mockSessionFindUnique: vi.fn(),
  mockExecuteRawUnsafe: vi.fn()
}));

vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: {
    requireVerifiedAgencyMember: mockRequireVerifiedAgencyMember,
    requireAgencyAdmin: mockRequireAgencyAdmin,
    requireAgencyOwner: mockRequireAgencyOwner,
    requireTripAccess: mockRequireTripAccess
  }
}));

vi.mock("../src/modules/agencies/agencyService", () => ({
  agencyService: {
    deleteAgency: mockDeleteAgency,
    listAllAgencies: mockListAllAgencies,
    getAgencyDetail: mockGetAgencyDetail,
    approveAgency: mockApproveAgency,
    rejectAgency: mockRejectAgency,
    suspendAgency: mockSuspendAgency,
    unsuspendAgency: mockUnsuspendAgency,
    updateAgencySettings: mockUpdateAgencySettings,
    createAgencyApplication: mockCreateAgencyApplication,
    listPendingAgencies: vi.fn(),
    getPendingCount: vi.fn()
  }
}));

vi.mock("../src/modules/support/supportService", () => ({
  supportService: {
    createReport: mockCreateReport,
    listReports: mockListReports,
    getReport: mockGetReport,
    updateReport: mockUpdateReport
  }
}));

vi.mock("../src/modules/agencies/teamService", () => ({
  createTeamService: () => ({
    invite: mockInviteMember,
    listMembers: mockListMembers,
    listOutstanding: mockListOutstandingInvitations,
    revoke: mockRevokeInvitation,
    changeMemberRole: mockChangeMemberRole,
    removeMember: mockRemoveMember,
    transferOwnership: mockTransferOwnership,
    addExistingUserToAgency: vi.fn()
  })
}));

vi.mock("../src/modules/agencies/teamRepository", () => ({
  createPrismaTeamRepository: () => ({})
}));

vi.mock("../src/modules/agencies/invitationService", () => ({
  createInvitationService: () => ({
    invite: mockInviteMember,
    listOutstanding: mockListOutstandingInvitations,
    revoke: mockRevokeInvitation
  })
}));

vi.mock("../src/modules/agencies/invitationRepository", () => ({
  createPrismaInvitationRepository: () => ({})
}));

vi.mock("../src/modules/images/imageService", () => ({
  imageService: {
    requestUpload: mockRequestUpload,
    completeUpload: mockCompleteUpload,
    createReadUrl: mockCreateReadUrl
  }
}));

vi.mock("../src/modules/personal/personalService", () => ({
  createPersonalService: () => ({
    createItinerary: mockCreatePersonalItinerary,
    getItinerary: mockGetPersonalItinerary,
    updateItinerary: mockUpdatePersonalItinerary,
    deleteItinerary: mockDeletePersonalItinerary,
    listItineraries: mockListPersonalItineraries,
    listThreads: mockListPersonalThreads,
    createThread: mockCreatePersonalThread,
    createShare: mockCreatePersonalShare
  })
}));

vi.mock("../src/modules/personal/personalRepository", () => ({
  createPrismaPersonalRepository: () => ({})
}));

vi.mock("../src/modules/agent/agentService", () => ({
  agentService: {
    listThreads: mockListAgentThreads,
    createThread: mockCreateAgentThread,
    getThread: mockGetAgentThread,
    deleteThread: mockDeleteAgentThread,
    saveItineraryThread: mockSaveItineraryThread,
    updateThreadTitle: mockUpdateAgentThreadTitle,
    appendUserMessageAndCreateRun: mockAppendUserMessageAndCreateRun,
    startRun: mockStartAgentRun,
    listRunEvents: mockListRunEvents,
    cancelRun: mockCancelRun
  }
}));

vi.mock("../src/modules/agent/agentRepository", () => ({
  createPrismaAgentRepository: () => ({
    listThreadMessages: mockListThreadMessages
  })
}));

vi.mock("../src/modules/itineraries/itineraryService", () => ({
  itineraryService: {
    listTripsForUser: mockListTripsForUser,
    getItinerary: mockGetItinerary,
    replaceDraft: mockReplaceDraft,
    deleteTrip: mockDeleteTrip,
    approveTrip: mockApproveTrip
  }
}));

vi.mock("../src/modules/shares/shareService", () => ({
  shareService: {
    createShare: mockCreateShare,
    listSharesForTrip: mockListSharesForTrip,
    getUnreadCommentCount: mockGetUnreadCommentCount,
    getUnreadCommentCountsByTrip: mockGetUnreadCommentCountsByTrip,
    revokeShare: mockRevokeShare,
    listComments: mockListComments,
    replyToComment: mockReplyToComment
  }
}));

vi.mock("../src/modules/workspace/workspaceService", () => ({
  getBootstrap: mockGetBootstrap
}));

vi.mock("../src/modules/ratedHistory/ratedHistoryService", () => ({
  ratedHistoryService: {
    listRatedHistory: mockListRatedHistory,
    getRatedItinerary: mockGetRatedItinerary,
    insertFromRated: mockInsertFromRated
  }
}));

vi.mock("../src/db/prisma", () => ({
  prisma: {
    clientTrip: {
      findUnique: mockClientTripFindUnique
    },
    user: {
      findUnique: mockUserFindUnique,
      update: mockUserUpdate
    },
    placeSnapshot: {
      findFirst: mockPlaceSnapshotFindFirst
    },
    session: {
      findUnique: mockSessionFindUnique
    },
    $executeRawUnsafe: mockExecuteRawUnsafe
  }
}));

import { errorHandler, notFoundHandler } from "../src/http/errors";
import { adminRoutes } from "../src/modules/admin/adminRoutes";
import { agencyRoutes } from "../src/modules/agencies/agencyRoutes";
import { teamRoutes } from "../src/modules/agencies/teamRoutes";
import { imageRoutes } from "../src/modules/images/imageRoutes";
import { personalRoutes } from "../src/modules/personal/personalRoutes";
import { agentRoutes } from "../src/modules/agent/agentRoutes";
import { itineraryRoutes } from "../src/modules/itineraries/itineraryRoutes";
import { shareRoutes } from "../src/modules/shares/shareRoutes";
import { supportRoutes } from "../src/modules/support/supportRoutes";
import { workspaceRoutes } from "../src/modules/workspace/workspaceRoutes";
import { ratedHistoryInsertRoutes, ratedHistoryListRoutes } from "../src/modules/ratedHistory/ratedHistoryRoutes";

const agencyUser = {
  id: "user-agency",
  role: "USER",
  status: "ACTIVE",
  accountType: "AGENCY_USER",
  displayName: "Agency User",
  memberships: []
};

const personalUser = {
  id: "user-personal",
  role: "USER",
  status: "ACTIVE",
  accountType: "PERSONAL",
  displayName: "Personal User",
  memberships: []
};

const adminUser = {
  id: "user-admin",
  role: "SUPER_ADMIN",
  status: "ACTIVE",
  accountType: "AGENCY_USER",
  displayName: "Admin User",
  memberships: []
};

function makeAccess(role: "OWNER" | "ADMIN" | "STAFF" = "OWNER") {
  return {
    agency: { id: VALID_AGENCY_ID, status: "VERIFIED" },
    membership: {
      id: VALID_MEMBERSHIP_ID,
      userId: agencyUser.id,
      agencyId: VALID_AGENCY_ID,
      role,
      status: "ACTIVE"
    }
  };
}

function createRouteApp(options: {
  mountPath: string;
  router: Router;
  authUser?: Record<string, unknown>;
}) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use((request, _response, next) => {
    if (options.authUser) {
      request.authUser = options.authUser as any;
    }
    next();
  });
  app.use(options.mountPath, options.router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function expectValidationError(response: request.Response) {
  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe("VALIDATION_ERROR");
}

beforeEach(() => {
  vi.clearAllMocks();

  mockRequireVerifiedAgencyMember.mockResolvedValue(makeAccess());
  mockRequireAgencyAdmin.mockResolvedValue(makeAccess("ADMIN"));
  mockRequireAgencyOwner.mockResolvedValue(makeAccess("OWNER"));
  mockRequireTripAccess.mockResolvedValue(undefined);

  mockDeleteAgency.mockResolvedValue(undefined);
  mockListAllAgencies.mockResolvedValue([]);
  mockGetAgencyDetail.mockResolvedValue({ id: VALID_AGENCY_ID });
  mockApproveAgency.mockResolvedValue({ id: VALID_AGENCY_ID });
  mockRejectAgency.mockResolvedValue({ id: VALID_AGENCY_ID });
  mockSuspendAgency.mockResolvedValue({ id: VALID_AGENCY_ID });
  mockUnsuspendAgency.mockResolvedValue({ id: VALID_AGENCY_ID });
  mockUpdateAgencySettings.mockResolvedValue({ id: VALID_AGENCY_ID });
  mockCreateAgencyApplication.mockResolvedValue({ id: VALID_AGENCY_ID });

  mockCreateReport.mockResolvedValue({ id: VALID_REPORT_ID });
  mockListReports.mockResolvedValue([]);
  mockGetReport.mockResolvedValue({ id: VALID_REPORT_ID });
  mockUpdateReport.mockResolvedValue({ id: VALID_REPORT_ID });

  mockInviteMember.mockResolvedValue({ id: VALID_INVITATION_ID });
  mockListMembers.mockResolvedValue([]);
  mockListOutstandingInvitations.mockResolvedValue([]);
  mockRevokeInvitation.mockResolvedValue(undefined);
  mockChangeMemberRole.mockResolvedValue({ id: VALID_MEMBERSHIP_ID });
  mockRemoveMember.mockResolvedValue(undefined);
  mockTransferOwnership.mockResolvedValue(undefined);

  mockRequestUpload.mockResolvedValue({ uploadUrl: "https://example.com/upload" });
  mockCompleteUpload.mockResolvedValue({ id: VALID_IMAGE_ID });
  mockCreateReadUrl.mockResolvedValue({ url: "https://example.com/image.png" });

  mockCreatePersonalItinerary.mockResolvedValue({ id: VALID_ITINERARY_ID });
  mockGetPersonalItinerary.mockResolvedValue({ id: VALID_ITINERARY_ID });
  mockUpdatePersonalItinerary.mockResolvedValue({ id: VALID_ITINERARY_ID });
  mockDeletePersonalItinerary.mockResolvedValue({ deleted: true });
  mockListPersonalItineraries.mockResolvedValue([]);
  mockListPersonalThreads.mockResolvedValue([]);
  mockCreatePersonalThread.mockResolvedValue({ id: VALID_THREAD_ID });
  mockCreatePersonalShare.mockResolvedValue({ id: VALID_SHARE_ID });

  mockListAgentThreads.mockResolvedValue([]);
  mockCreateAgentThread.mockResolvedValue({ id: VALID_THREAD_ID });
  mockGetAgentThread.mockResolvedValue({ id: VALID_THREAD_ID });
  mockDeleteAgentThread.mockResolvedValue(undefined);
  mockSaveItineraryThread.mockResolvedValue({ id: VALID_ITINERARY_ID });
  mockUpdateAgentThreadTitle.mockResolvedValue({ id: VALID_THREAD_ID });
  mockAppendUserMessageAndCreateRun.mockResolvedValue({
    message: { id: "message-1", content: "hello" },
    run: { id: VALID_RUN_ID }
  });
  mockStartAgentRun.mockResolvedValue({ id: VALID_RUN_ID });
  mockListRunEvents.mockResolvedValue([]);
  mockCancelRun.mockResolvedValue(undefined);
  mockListThreadMessages.mockResolvedValue({ messages: [], nextCursor: null });

  mockListTripsForUser.mockResolvedValue([]);
  mockGetItinerary.mockResolvedValue({ id: VALID_ITINERARY_ID });
  mockReplaceDraft.mockResolvedValue({ id: VALID_ITINERARY_ID });
  mockDeleteTrip.mockResolvedValue({ deleted: true });
  mockApproveTrip.mockResolvedValue({ approved: true });

  mockCreateShare.mockResolvedValue({ id: VALID_SHARE_ID });
  mockListSharesForTrip.mockResolvedValue([]);
  mockGetUnreadCommentCount.mockResolvedValue(0);
  mockGetUnreadCommentCountsByTrip.mockResolvedValue([]);
  mockRevokeShare.mockResolvedValue({ id: VALID_SHARE_ID });
  mockListComments.mockResolvedValue([]);
  mockReplyToComment.mockResolvedValue({ id: VALID_COMMENT_ID });

  mockGetBootstrap.mockResolvedValue({ workspace: {} });

  mockListRatedHistory.mockResolvedValue({ trips: [], hasMore: false, nextPage: null });
  mockGetRatedItinerary.mockResolvedValue({ trip: { tripId: VALID_TRIP_ID }, itinerary: { days: [] } });
  mockInsertFromRated.mockResolvedValue({ itinerary: { itineraryId: VALID_ITINERARY_ID, days: [] } });

  mockClientTripFindUnique.mockResolvedValue({ agencyId: VALID_AGENCY_ID });
  mockUserFindUnique.mockResolvedValue(null);
  mockUserUpdate.mockResolvedValue(undefined);
  mockPlaceSnapshotFindFirst.mockResolvedValue(null);
  mockSessionFindUnique.mockResolvedValue(null);
  mockExecuteRawUnsafe.mockResolvedValue(undefined);
});

describe("authenticated route validation", () => {
  it("rejects invalid agency IDs before agency membership checks", async () => {
    const cases = [
      {
        app: createRouteApp({
          mountPath: "/agencies/:agencyId/workspace",
          router: workspaceRoutes,
          authUser: agencyUser
        }),
        path: "/agencies/not-a-uuid/workspace/bootstrap"
      },
      {
        app: createRouteApp({
          mountPath: "/agencies/:agencyId/agent",
          router: agentRoutes,
          authUser: agencyUser
        }),
        path: "/agencies/not-a-uuid/agent/threads"
      },
      {
        app: createRouteApp({
          mountPath: "/agencies/:agencyId/shares",
          router: shareRoutes,
          authUser: agencyUser
        }),
        path: "/agencies/not-a-uuid/shares/unread-count"
      },
      {
        app: createRouteApp({
          mountPath: "/agencies/:agencyId/rated-history",
          router: ratedHistoryListRoutes,
          authUser: agencyUser
        }),
        path: "/agencies/not-a-uuid/rated-history"
      }
    ];

    for (const testCase of cases) {
      const response = await request(testCase.app).get(testCase.path);
      expectValidationError(response);
    }

    expect(mockRequireVerifiedAgencyMember).not.toHaveBeenCalled();
  });

  it("rejects transfer ownership without a UUID targetMembershipId", async () => {
    const app = createRouteApp({
      mountPath: "/agencies/:agencyId/team",
      router: teamRoutes,
      authUser: agencyUser
    });

    const response = await request(app)
      .post(`/agencies/${VALID_AGENCY_ID}/team/transfer-ownership`)
      .send({ targetMembershipId: "not-a-uuid" });

    expectValidationError(response);
    expect(mockTransferOwnership).not.toHaveBeenCalled();
  });

  it("rejects agency deletion payloads with unknown keys", async () => {
    const app = createRouteApp({
      mountPath: "/agencies",
      router: agencyRoutes,
      authUser: agencyUser
    });

    const response = await request(app)
      .delete(`/agencies/${VALID_AGENCY_ID}`)
      .send({ confirmName: "Voyage Agency", extra: true });

    expectValidationError(response);
    expect(mockDeleteAgency).not.toHaveBeenCalled();
  });

  it("rejects invalid admin agency and report IDs before service calls", async () => {
    const app = createRouteApp({
      mountPath: "/admin",
      router: adminRoutes,
      authUser: adminUser
    });

    const reportResponse = await request(app).get("/admin/reports/not-a-uuid");
    const agencyResponse = await request(app).get("/admin/agencies/not-a-uuid");

    expectValidationError(reportResponse);
    expectValidationError(agencyResponse);
    expect(mockGetReport).not.toHaveBeenCalled();
    expect(mockGetAgencyDetail).not.toHaveBeenCalled();
  });

  it("rejects enum query filters on authenticated admin endpoints", async () => {
    const app = createRouteApp({
      mountPath: "/admin",
      router: adminRoutes,
      authUser: adminUser
    });

    const agencyResponse = await request(app).get("/admin/agencies?status=UNKNOWN");
    const reportResponse = await request(app).get("/admin/reports?status=UNKNOWN");
    const usageResponse = await request(app).get("/admin/usage?period=century");

    expectValidationError(agencyResponse);
    expectValidationError(reportResponse);
    expectValidationError(usageResponse);
    expect(mockListAllAgencies).not.toHaveBeenCalled();
    expect(mockListReports).not.toHaveBeenCalled();
  });

  it("rejects invalid image IDs before storage calls", async () => {
    const app = createRouteApp({
      mountPath: "/images",
      router: imageRoutes,
      authUser: agencyUser
    });

    const completeResponse = await request(app).post("/images/not-a-uuid/complete");
    const urlResponse = await request(app).get("/images/not-a-uuid/url");

    expectValidationError(completeResponse);
    expectValidationError(urlResponse);
    expect(mockCompleteUpload).not.toHaveBeenCalled();
    expect(mockCreateReadUrl).not.toHaveBeenCalled();
  });

  it("rejects upload-url payloads with unknown keys", async () => {
    const app = createRouteApp({
      mountPath: "/images",
      router: imageRoutes,
      authUser: agencyUser
    });

    const response = await request(app).post("/images/upload-url").send({
      purpose: "PROFILE_AVATAR",
      mimeType: "image/png",
      sizeBytes: 1024,
      extra: true
    });

    expectValidationError(response);
    expect(mockRequestUpload).not.toHaveBeenCalled();
  });

  it("rejects unbounded personal itinerary fields and normalizes blank summary updates", async () => {
    const app = createRouteApp({
      mountPath: "/me",
      router: personalRoutes,
      authUser: personalUser
    });

    const createResponse = await request(app).post("/me/itineraries").send({
      title: "x".repeat(201),
      summary: "Valid summary"
    });

    expectValidationError(createResponse);
    expect(mockCreatePersonalItinerary).not.toHaveBeenCalled();

    const patchResponse = await request(app)
      .patch(`/me/itineraries/${VALID_ITINERARY_ID}`)
      .send({ summary: "   " });

    expect(patchResponse.status).toBe(200);
    expect(mockUpdatePersonalItinerary).toHaveBeenCalledWith(
      personalUser.id,
      VALID_ITINERARY_ID,
      { summary: null }
    );
  });

  it("rejects invalid agent thread and run IDs", async () => {
    const app = createRouteApp({
      mountPath: "/agencies/:agencyId/agent",
      router: agentRoutes,
      authUser: agencyUser
    });

    const threadResponse = await request(app).get(
      `/agencies/${VALID_AGENCY_ID}/agent/threads/not-a-uuid`
    );
    const runResponse = await request(app).get(
      `/agencies/${VALID_AGENCY_ID}/agent/runs/not-a-uuid/events`
    );

    expectValidationError(threadResponse);
    expectValidationError(runResponse);
    expect(mockGetAgentThread).not.toHaveBeenCalled();
    expect(mockListRunEvents).not.toHaveBeenCalled();
  });

  it("rejects invalid date ordering and unknown query keys on paginated agent endpoints", async () => {
    const app = createRouteApp({
      mountPath: "/agencies/:agencyId/agent",
      router: agentRoutes,
      authUser: agencyUser
    });

    const saveResponse = await request(app)
      .post(`/agencies/${VALID_AGENCY_ID}/agent/threads/${VALID_THREAD_ID}/save`)
      .send({
        itineraryId: VALID_ITINERARY_ID,
        clientName: "Traveler",
        destination: "Tokyo",
        startDate: "2026-08-10T00:00:00.000Z",
        endDate: "2026-08-01T00:00:00.000Z"
      });

    const messagesResponse = await request(app).get(
      `/agencies/${VALID_AGENCY_ID}/agent/threads/${VALID_THREAD_ID}/messages?limit=10&extra=1`
    );

    expectValidationError(saveResponse);
    expectValidationError(messagesResponse);
    expect(mockSaveItineraryThread).not.toHaveBeenCalled();
    expect(mockListThreadMessages).not.toHaveBeenCalled();
  });

  it("rejects invalid itinerary trip IDs before authorization-dependent trip checks", async () => {
    const app = createRouteApp({
      mountPath: "/agencies/:agencyId/itineraries",
      router: itineraryRoutes,
      authUser: agencyUser
    });

    const deleteResponse = await request(app).delete(
      `/agencies/${VALID_AGENCY_ID}/itineraries/trips/not-a-uuid`
    );
    const approveResponse = await request(app).post(
      `/agencies/${VALID_AGENCY_ID}/itineraries/trips/not-a-uuid/approve`
    );

    expectValidationError(deleteResponse);
    expectValidationError(approveResponse);
    expect(mockRequireTripAccess).not.toHaveBeenCalled();
    expect(mockDeleteTrip).not.toHaveBeenCalled();
    expect(mockApproveTrip).not.toHaveBeenCalled();
  });

  it("rejects invalid share filters, share IDs, comment IDs, and expiresAt before service calls", async () => {
    const app = createRouteApp({
      mountPath: "/agencies/:agencyId/shares",
      router: shareRoutes,
      authUser: agencyUser
    });

    const listResponse = await request(app).get(
      `/agencies/${VALID_AGENCY_ID}/shares?tripId=not-a-uuid`
    );
    const createResponse = await request(app)
      .post(`/agencies/${VALID_AGENCY_ID}/shares/${VALID_ITINERARY_ID}`)
      .send({
        clientName: "Client",
        expiresAt: "not-a-date"
      });
    const revokeResponse = await request(app).delete(
      `/agencies/${VALID_AGENCY_ID}/shares/not-a-uuid`
    );
    const replyResponse = await request(app)
      .post(`/agencies/${VALID_AGENCY_ID}/shares/comments/not-a-uuid/reply`)
      .send({ content: "Thanks" });

    expectValidationError(listResponse);
    expectValidationError(createResponse);
    expectValidationError(revokeResponse);
    expectValidationError(replyResponse);
    expect(mockListSharesForTrip).not.toHaveBeenCalled();
    expect(mockCreateShare).not.toHaveBeenCalled();
    expect(mockRevokeShare).not.toHaveBeenCalled();
    expect(mockReplyToComment).not.toHaveBeenCalled();
  });

  it("rejects invalid support report bodies with unknown keys", async () => {
    const app = createRouteApp({
      mountPath: "/support",
      router: supportRoutes,
      authUser: agencyUser
    });

    const response = await request(app).post("/support/reports").send({
      category: "BUG",
      subject: "  ",
      message: "Valid message",
      extra: true
    });

    expectValidationError(response);
    expect(mockCreateReport).not.toHaveBeenCalled();
  });

  it("rejects invalid rated-history insert route IDs before Prisma lookups", async () => {
    const app = createRouteApp({
      mountPath: "/trips/:tripId/itinerary",
      router: ratedHistoryInsertRoutes,
      authUser: agencyUser
    });

    const response = await request(app)
      .post("/trips/not-a-uuid/itinerary/insert-from-rated")
      .send({
        sourceTripId: VALID_TRIP_ID,
        selection: { kind: "day", dayIds: [VALID_ITINERARY_ID] },
        target: { itineraryId: VALID_ITINERARY_ID, dayIndex: 0 },
        ifMatchVersion: 1
      });

    expectValidationError(response);
    expect(mockClientTripFindUnique).not.toHaveBeenCalled();
    expect(mockInsertFromRated).not.toHaveBeenCalled();
  });
});
