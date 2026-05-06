import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../../db/prisma";
import { ApiError } from "../../../http/errors";
import type { MapsProvider, ResolvedPlace } from "../../../services/maps";
import type { AgentToolContext } from "../agentTools";
import type { AgentRunRecord } from "../agentTypes";

export function createRunRecord(context: AgentToolContext): AgentRunRecord {
  const now = new Date();
  return {
    id: context.runId,
    threadId: context.threadId,
    agencyId: context.agencyId,
    triggerMessageId: null,
    status: "RUNNING",
    modelProvider: "agent-orchestrator",
    modelName: "agent-orchestrator",
    startedAt: now,
    completedAt: null,
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now
  };
}

export function inputError() {
  return new ApiError(400, "AGENT_TOOL_INPUT_INVALID", "Agent tool input was invalid.");
}

export function toCompactMetadata(value: Record<string, unknown>) {
  return value;
}

export function toProviderName(provider: ResolvedPlace["provider"]) {
  return provider.toLowerCase();
}

export function toPlaceSnapshotProvider(provider: ResolvedPlace["provider"]): any {
  return provider === "NOMINATIM" ? "GOOGLE_MAPS" : provider;
}

export async function upsertPlaceSnapshot(client: PrismaClient, place: ResolvedPlace) {
  return client.placeSnapshot.upsert({
    where: {
      provider_providerPlaceId: {
        provider: toPlaceSnapshotProvider(place.provider),
        providerPlaceId: place.providerPlaceId
      }
    },
    create: {
      provider: toPlaceSnapshotProvider(place.provider),
      providerPlaceId: place.providerPlaceId,
      name: place.name,
      formattedAddress: place.formattedAddress,
      latitude: place.location.latitude,
      longitude: place.location.longitude,
      rating: place.rating,
      websiteUrl: place.websiteUrl,
      phoneNumber: place.phoneNumber,
      metadata: place.metadata as any,
      fetchedAt: new Date()
    },
    update: {
      name: place.name,
      formattedAddress: place.formattedAddress,
      latitude: place.location.latitude,
      longitude: place.location.longitude,
      rating: place.rating,
      websiteUrl: place.websiteUrl,
      phoneNumber: place.phoneNumber,
      metadata: place.metadata as any,
      fetchedAt: new Date()
    }
  });
}

export function mapPinpointPayload(placeSnapshotId: string, place: ResolvedPlace) {
  return {
    placeSnapshotId,
    name: place.name,
    formattedAddress: place.formattedAddress ?? null,
    lat: place.location.latitude,
    lng: place.location.longitude,
    provider: place.provider
  };
}

export function toTitleCase(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
