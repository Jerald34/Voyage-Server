import { describe, expect, it, vi } from "vitest";
import { createGoogleMapsProvider } from "../src/services/maps";
import { createEstimateRouteTool } from "../src/modules/agent/agentTools";
import { buildVoyageSystemPrompt } from "../src/modules/agent/agentPrompts";

const origin = { latitude: 16.41, longitude: 120.59 };
const destination = { latitude: 16.42, longitude: 120.6 };

describe("transit routing preference", () => {
  it("asks the Routes API for less walking on transit legs only", async () => {
    const bodies: any[] = [];
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ routes: [{ distanceMeters: 1200, duration: "600s" }] }), { status: 200 });
      }
    });

    await provider.estimateRoute({ origin, destination, travelMode: "TRANSIT", transitRoutingPreference: "LESS_WALKING" });
    await provider.estimateRoute({ origin, destination, travelMode: "DRIVE", transitRoutingPreference: "LESS_WALKING" });

    expect(bodies[0].transitPreferences).toEqual({ routingPreference: "LESS_WALKING" });
    expect(bodies[1]).not.toHaveProperty("transitPreferences");
  });

  it("passes the preference through estimate_route, and omits it when absent", async () => {
    const calls: any[] = [];
    const agentService = {
      recordRunEvent: vi.fn(async () => undefined),
      recordTask: vi.fn(async () => undefined),
      updateTask: vi.fn(async () => undefined),
      listOpenTasksForThread: vi.fn(async () => []),
      recordSources: vi.fn(async () => undefined)
    };
    const tool = createEstimateRouteTool({
      agentService,
      maps: {
        estimateRoute: async (input: unknown) => {
          calls.push(input);
          return {};
        }
      } as any
    });
    const context = { agencyId: "agency-1", threadId: "thread-1", runId: "run-1", userId: "user-1" };

    await tool.execute(context as any, { origin, destination, travelMode: "TRANSIT", transitRoutingPreference: "LESS_WALKING" });
    await tool.execute(context as any, { origin, destination, travelMode: "DRIVE" });

    expect(calls[0]).toEqual({ origin, destination, travelMode: "TRANSIT", transitRoutingPreference: "LESS_WALKING" });
    expect(calls[1]).toEqual({ origin, destination, travelMode: "DRIVE" });
  });

  it("shows the model how to request it", () => {
    expect(buildVoyageSystemPrompt("estimate_route")).toContain('"transitRoutingPreference": "LESS_WALKING"');
  });
});
