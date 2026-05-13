import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../http/errors";
import { agentService } from "./agentService";
import { itineraryService } from "../itineraries/itineraryService";
import { createAgentOrchestrator } from "./agentOrchestrator";
import {
  createAddItineraryDayTool,
  createAddItineraryItemTool,
  createAgentToolRegistry,
  createCreateItineraryTool,
  createDeleteItineraryTool,
  createEstimateRouteTool,
  createGetGooglePlaceDetailsTool,
  createMapPinpointTool,
  createMoveItineraryItemTool,
  createPlaceInsightsTool,
  createPlanItineraryTool,
  createRecordAgentTaskTool,
  createRemoveItineraryDayTool,
  createRemoveItineraryItemTool,
  createRouteLogisticsTool,
  createSearchGooglePlacesTool,
  createSearchNearbyGooglePlacesTool,
  createGetGooglePlacePhotosTool,
  createUpdateItineraryDayTool,
  createUpdateItineraryItemTool,
  createUpdateItineraryTool,
  createWebSearchTool
} from "./agentTools";
import { createGoogleMapsProvider, createNominatimMapsProvider } from "../../services/maps";
import { createWebSearchProvider } from "../../services/webSearch";
import { getModelProvider, getModelProviderInfo } from "../../services/modelProvider";

const GOOGLE_MAPS_TOOL_NAMES = [
  "search_google_places",
  "search_nearby_google_places",
  "get_google_place_details",
  "get_google_place_photos",
  "estimate_route",
  "map_pinpoint",
  "route_logistics",
  "place_insights"
] as const;

const WEB_SEARCH_TOOL_NAMES = ["web_search"] as const;

function createAgencyAgentOrchestrator() {
  // Tools that don't need a maps provider can be registered up front.
  const tools = [
    createRecordAgentTaskTool({ agentService }),
    createCreateItineraryTool({ itineraryService, agentService }),
    createUpdateItineraryTool({ itineraryService, agentService }),
    createPlanItineraryTool({ itineraryService, agentService }),
    createDeleteItineraryTool({ itineraryService, agentService }),
    createAddItineraryDayTool({ itineraryService, agentService }),
    createUpdateItineraryDayTool({ itineraryService, agentService }),
    createRemoveItineraryDayTool({ itineraryService, agentService }),
    createAddItineraryItemTool({ itineraryService, agentService }),
    createUpdateItineraryItemTool({ itineraryService, agentService }),
    createRemoveItineraryItemTool({ itineraryService, agentService }),
    createMoveItineraryItemTool({ itineraryService, agentService })
  ];

  function rebindWithMaps(maps: ReturnType<typeof createNominatimMapsProvider> | ReturnType<typeof createGoogleMapsProvider>) {
    const replacements: Record<string, () => typeof tools[number]> = {
      create_itinerary: () => createCreateItineraryTool({ itineraryService, agentService, maps }),
      update_itinerary: () => createUpdateItineraryTool({ itineraryService, agentService, maps }),
      add_itinerary_item: () =>
        createAddItineraryItemTool({ itineraryService, agentService, maps, placeSnapshotClient: prisma }),
      update_itinerary_item: () =>
        createUpdateItineraryItemTool({ itineraryService, agentService, maps, placeSnapshotClient: prisma })
    };
    for (const [name, factory] of Object.entries(replacements)) {
      const idx = tools.findIndex((t) => t.name === name);
      if (idx !== -1) tools[idx] = factory();
    }
  }

  try {
    const maps = createNominatimMapsProvider();
    rebindWithMaps(maps);
    tools.push(
      createMapPinpointTool({ maps, agentService, placeSnapshotClient: prisma }),
      createPlaceInsightsTool({ maps, agentService, placeSnapshotClient: prisma })
    );
  } catch {
    // Keep the agent route import-safe when geocoding is not configured.
  }

  try {
    const googleMaps = createGoogleMapsProvider();
    const googleMapsTools = [
      createSearchGooglePlacesTool({ maps: googleMaps, agentService }),
      createSearchNearbyGooglePlacesTool({ maps: googleMaps, agentService }),
      createGetGooglePlaceDetailsTool({ maps: googleMaps, agentService }),
      createGetGooglePlacePhotosTool({ maps: googleMaps, agentService }),
      createEstimateRouteTool({ maps: googleMaps, agentService, placeSnapshotClient: prisma }),
      createRouteLogisticsTool({ maps: googleMaps, agentService, placeSnapshotClient: prisma }),
      createMapPinpointTool({ maps: googleMaps, agentService, placeSnapshotClient: prisma }),
      createPlaceInsightsTool({ maps: googleMaps, agentService, placeSnapshotClient: prisma })
    ];

    tools.push(...googleMapsTools.filter(t => !tools.some(existing => existing.name === t.name)));

    rebindWithMaps(googleMaps);

    const pinpointIdx = tools.findIndex(t => t.name === "map_pinpoint");
    if (pinpointIdx !== -1) tools[pinpointIdx] = googleMapsTools.find(t => t.name === "map_pinpoint")!;

    const insightsIdx = tools.findIndex(t => t.name === "place_insights");
    if (insightsIdx !== -1) tools[insightsIdx] = googleMapsTools.find(t => t.name === "place_insights")!;

  } catch {
    try {
      const maps = createNominatimMapsProvider();
      tools.push(
        createMapPinpointTool({ maps, agentService, placeSnapshotClient: prisma }),
        createPlaceInsightsTool({ maps, agentService, placeSnapshotClient: prisma })
      );
    } catch {
      // Keep agent route import-safe.
    }
  }

  try {
    const modelInfo = getModelProviderInfo();
    console.log(
      `[Model Provider] MODEL_PROVIDER=${env.MODEL_PROVIDER} -> ${modelInfo.provider} (${modelInfo.model})`
    );

    const webSearch = createWebSearchProvider();
    tools.push(createWebSearchTool({ webSearch, agentService }));
  } catch {
    // Keep the agent route import-safe when Search is not configured.
  }

  return createAgentOrchestrator({
    modelProvider: getModelProvider(),
    agentService,
    availableToolNames: tools.map((tool) => tool.name),
    // Packed Approach B with research + clustering + per-stop estimate_route fans out to ~3 tool calls per stop on a multi-day plan.
    maxToolCallsPerRun: 120,
    toolRegistry: createAgentToolRegistry(tools, {
      maxCallsByGroup: {
        google_maps: env.GOOGLE_MAPS_MAX_CALLS_PER_RUN,
        web_search: env.WEB_SEARCH_MAX_CALLS_PER_RUN
      },
      toolGroups: {
        ...Object.fromEntries(GOOGLE_MAPS_TOOL_NAMES.map((toolName) => [toolName, "google_maps"])),
        ...Object.fromEntries(WEB_SEARCH_TOOL_NAMES.map((toolName) => [toolName, "web_search"]))
      }
    })
  });
}

let agentOrchestrator: ReturnType<typeof createAgencyAgentOrchestrator> | null = null;

export function getAgentOrchestrator() {
  agentOrchestrator ??= createAgencyAgentOrchestrator();
  return agentOrchestrator;
}

const runAbortControllers = new Map<string, AbortController>();

export function cancelAgentRun(runId: string) {
  const controller = runAbortControllers.get(runId);
  if (controller) {
    controller.abort();
    runAbortControllers.delete(runId);
  }
}

export async function startAgentRunInBackground(
  input: {
    agencyId: string;
    threadId: string;
    runId: string;
    userId: string;
    userContent: string;
  },
  dependencies: {
    agentService?: Pick<typeof agentService, "failRun">;
    orchestrator?: Pick<ReturnType<typeof createAgencyAgentOrchestrator>, "run">;
  } = {}
) {
  const agentServiceDependency = dependencies.agentService ?? agentService;
  const orchestrator = dependencies.orchestrator ?? getAgentOrchestrator();

  const controller = new AbortController();
  runAbortControllers.set(input.runId, controller);

  try {
    await orchestrator.run({ ...input, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) return;

    console.error("Agent orchestration failed", {
      agencyId: input.agencyId,
      threadId: input.threadId,
      runId: input.runId,
      error
    });

    const failure =
      error instanceof ApiError
        ? error
        : new ApiError(500, "AGENT_RUN_FAILED", "Agent run failed.");

    try {
      await agentServiceDependency.failRun(input.runId, failure.code, failure.message);
    } catch (failRunError) {
      console.error("Failed to mark agent run failed after orchestration failure", {
        agencyId: input.agencyId,
        threadId: input.threadId,
        runId: input.runId,
        failureCode: failure.code,
        failureMessage: failure.message,
        error,
        failRunError
      });
    }
  } finally {
    runAbortControllers.delete(input.runId);
  }
}
