import { env } from "../../config/env";
import { ApiError } from "../../http/errors";
import { agentService } from "./agentService";
import { itineraryService } from "../itineraries/itineraryService";
import { createAgentOrchestrator } from "./agentOrchestrator";
import {
  createAgentToolRegistry,
  createCreateItineraryTool,
  createEstimateRouteTool,
  createGetGooglePlaceDetailsTool,
  createMapPinpointTool,
  createPlaceInsightsTool,
  createRecordAgentTaskTool,
  createRouteLogisticsTool,
  createSearchGooglePlacesTool,
  createSearchNearbyGooglePlacesTool,
  createGetGooglePlacePhotosTool,
  createUpdateItineraryTool,
  createWebSearchTool
} from "./agentTools";
import { createGoogleMapsProvider, createNominatimMapsProvider } from "../../services/maps";
import { createWebSearchProvider } from "../../services/webSearch";
import { lmStudioModelProvider } from "../../services/modelProvider";

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
  const tools = [
    createRecordAgentTaskTool({ agentService }),
    createCreateItineraryTool({ itineraryService, agentService }),
    createUpdateItineraryTool({ itineraryService, agentService })
  ];

  try {
    const maps = createNominatimMapsProvider();
    tools[1] = createCreateItineraryTool({ itineraryService, agentService, maps });
    tools[2] = createUpdateItineraryTool({ itineraryService, agentService, maps });
    tools.push(
      createMapPinpointTool({ maps, agentService }),
      createPlaceInsightsTool({ maps, agentService })
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
      createEstimateRouteTool({ maps: googleMaps, agentService }),
      createRouteLogisticsTool({ maps: googleMaps, agentService }),
      createMapPinpointTool({ maps: googleMaps, agentService }),
      createPlaceInsightsTool({ maps: googleMaps, agentService })
    ];

    tools.push(...googleMapsTools.filter(t => !tools.some(existing => existing.name === t.name)));
    
    tools[1] = createCreateItineraryTool({ itineraryService, agentService, maps: googleMaps });
    tools[2] = createUpdateItineraryTool({ itineraryService, agentService, maps: googleMaps });
    
    const pinpointIdx = tools.findIndex(t => t.name === "map_pinpoint");
    if (pinpointIdx !== -1) tools[pinpointIdx] = googleMapsTools.find(t => t.name === "map_pinpoint")!;
    
    const insightsIdx = tools.findIndex(t => t.name === "place_insights");
    if (insightsIdx !== -1) tools[insightsIdx] = googleMapsTools.find(t => t.name === "place_insights")!;

  } catch {
    try {
      const maps = createNominatimMapsProvider();
      tools.push(
        createMapPinpointTool({ maps, agentService }),
        createPlaceInsightsTool({ maps, agentService })
      );
    } catch {
      // Keep agent route import-safe.
    }
  }

  try {
    const webSearch = createWebSearchProvider();
    tools.push(createWebSearchTool({ webSearch, agentService }));
  } catch {
    // Keep the agent route import-safe when Search is not configured.
  }

  return createAgentOrchestrator({
    modelProvider: lmStudioModelProvider,
    agentService,
    availableToolNames: tools.map((tool) => tool.name),
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

  try {
    await orchestrator.run(input);
  } catch (error) {
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
  }
}
