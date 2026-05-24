import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";

export type PersonalItineraryRecord = {
  id: string;
  createdByUserId: string;
  agencyId: null;
  title: string;
  summary: string | null;
  status: "DRAFT" | "NEEDS_REVIEW" | "APPROVED_INTERNAL";
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PersonalRepository = {
  listItinerariesForUser(userId: string): Promise<PersonalItineraryRecord[]>;
  findItineraryForUser(userId: string, itineraryId: string): Promise<PersonalItineraryRecord | null>;
  createItineraryForUser(input: { userId: string; title: string; summary?: string }): Promise<PersonalItineraryRecord>;
  updateItineraryForUser(input: {
    userId: string;
    itineraryId: string;
    data: Partial<{ title: string; summary: string | null; status: PersonalItineraryRecord["status"] }>;
  }): Promise<PersonalItineraryRecord | null>;
  deleteItineraryForUser(userId: string, itineraryId: string): Promise<boolean>;
  listThreadsForUser(
    userId: string
  ): Promise<Array<{ id: string; title: string; status: "ACTIVE" | "ARCHIVED"; createdAt: Date; updatedAt: Date }>>;
  findThreadForUser(
    userId: string,
    threadId: string
  ): Promise<{ id: string; title: string; status: "ACTIVE" | "ARCHIVED" } | null>;
  createThreadForUser(input: {
    userId: string;
    title: string;
  }): Promise<{ id: string; title: string; status: "ACTIVE" | "ARCHIVED"; createdAt: Date; updatedAt: Date }>;
  createShareForUserItinerary(input: {
    userId: string;
    itineraryId: string;
    recipientName?: string;
    recipientEmail?: string;
  }): Promise<{ id: string; token: string; itineraryId: string; createdAt: Date }>;
};

export function createPrismaPersonalRepository(client: PrismaClient = prisma): PersonalRepository {
  return {
    async listItinerariesForUser(userId) {
      return client.itinerary.findMany({
        where: { agencyId: null, createdByUserId: userId },
        orderBy: { updatedAt: "desc" }
      }) as Promise<PersonalItineraryRecord[]>;
    },

    async findItineraryForUser(userId, itineraryId) {
      return client.itinerary.findFirst({
        where: { id: itineraryId, agencyId: null, createdByUserId: userId }
      }) as Promise<PersonalItineraryRecord | null>;
    },

    async createItineraryForUser(input) {
      return client.itinerary.create({
        data: {
          createdByUserId: input.userId,
          agencyId: null,
          tripId: null,
          title: input.title,
          summary: input.summary ?? null,
          status: "DRAFT",
          version: 1
        }
      }) as Promise<PersonalItineraryRecord>;
    },

    async updateItineraryForUser({ userId, itineraryId, data }) {
      const existing = await client.itinerary.findFirst({
        where: { id: itineraryId, agencyId: null, createdByUserId: userId },
        select: { id: true }
      });
      if (!existing) return null;
      return client.itinerary.update({ where: { id: existing.id }, data }) as Promise<PersonalItineraryRecord>;
    },

    async deleteItineraryForUser(userId, itineraryId) {
      const existing = await client.itinerary.findFirst({
        where: { id: itineraryId, agencyId: null, createdByUserId: userId },
        select: { id: true }
      });
      if (!existing) return false;
      await client.itinerary.delete({ where: { id: existing.id } });
      return true;
    },

    async listThreadsForUser(userId) {
      return client.agentThread.findMany({
        where: { agencyId: null, createdByUserId: userId },
        orderBy: { updatedAt: "desc" }
      }) as any;
    },

    async findThreadForUser(userId, threadId) {
      return client.agentThread.findFirst({
        where: { id: threadId, agencyId: null, createdByUserId: userId }
      }) as any;
    },

    async createThreadForUser(input) {
      return client.agentThread.create({
        data: {
          agencyId: null,
          tripId: null,
          createdByUserId: input.userId,
          title: input.title,
          status: "ACTIVE"
        }
      }) as any;
    },

    async createShareForUserItinerary({ userId, itineraryId, recipientName, recipientEmail }) {
      const { ApiError } = await import("../../http/errors");
      const itinerary = await client.itinerary.findFirst({
        where: { id: itineraryId, agencyId: null, createdByUserId: userId },
        select: { id: true }
      });
      if (!itinerary) throw new ApiError(404, "PERSONAL_ITINERARY_NOT_FOUND", "Itinerary not found.");
      const { nanoid } = await import("nanoid");
      const token = nanoid(24);
      return client.itineraryShare.create({
        data: {
          token,
          itineraryId: itinerary.id,
          tripId: null,
          agencyId: null,
          clientName: recipientName ?? null,
          clientEmail: recipientEmail ?? null
        },
        select: { id: true, token: true, itineraryId: true, createdAt: true }
      });
    }
  };
}
