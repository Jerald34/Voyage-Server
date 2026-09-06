import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../../db/prisma";
import { ApiError } from "../../../http/errors";
import type { MapsProvider, ResolvedPlace } from "../../../services/maps";
import {
  createPlaceSnapshotRepository,
  toPlaceSnapshotProvider
} from "../../../services/places/placeSnapshotRepository";
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

export function inputError(zodError?: z.ZodError) {
  if (!zodError) {
    return new ApiError(400, "AGENT_TOOL_INPUT_INVALID", "Agent tool input was invalid.");
  }
  const summary = zodError.issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
  return new ApiError(
    400,
    "AGENT_TOOL_INPUT_INVALID",
    `Agent tool input invalid: ${summary || "validation failed"}`
  );
}

export function toCompactMetadata(value: Record<string, unknown>) {
  return value;
}

export function toProviderName(provider: ResolvedPlace["provider"]) {
  return provider.toLowerCase();
}

export { toPlaceSnapshotProvider };

/**
 * Snapshot persistence now lives in the places service so that layer never has to
 * import agent tool modules. Kept here as a re-export for the existing callers.
 */
export async function upsertPlaceSnapshot(client: PrismaClient, place: ResolvedPlace) {
  return createPlaceSnapshotRepository(client).upsertPlaceSnapshot(place);
}

export function mapPinpointPayload(placeSnapshotId: string, place: ResolvedPlace) {
  return {
    placeSnapshotId,
    name: place.name,
    formattedAddress: place.formattedAddress ?? null,
    lat: place.location.latitude,
    lng: place.location.longitude,
    provider: place.provider,
    // Carried through for SSE/client normalization. A missing status stays absent
    // rather than becoming a value the client could read as "open"; the checked
    // time is serialized only alongside a recognized observation.
    businessStatus: place.businessStatus ?? null,
    businessStatusCheckedAt: place.businessStatus
      ? place.businessStatusCheckedAt?.toISOString() ?? null
      : null
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
