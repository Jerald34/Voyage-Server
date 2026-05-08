import { z } from "zod";
import type { WebSearchProvider } from "../../../services/webSearch";
import type { AgentTool, AgentToolService } from "../agentTools";
import { createRunRecord, toCompactMetadata } from "./toolUtils";

const webSearchInputSchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().positive().max(10).default(5),
  region: z.string().min(2).max(20).optional(),
  language: z.string().min(2).max(20).optional()
});

export function createWebSearchTool(options: { webSearch: WebSearchProvider; agentService: AgentToolService }): AgentTool {
  return {
    name: "web_search",
    async execute(_context, input) {
      const parsed = webSearchInputSchema.parse(input);
      console.log(`[Search] web_search query: "${parsed.query}"`);
      const results = await options.webSearch.search({
        query: parsed.query,
        num: parsed.maxResults
      });
      await options.agentService.recordSources(
        createRunRecord(_context),
        results.map((result, index) => ({
          sourceType: "WEB",
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          provider: "web",
          retrievedAt: new Date(),
          metadata: toCompactMetadata({
            query: parsed.query,
            maxResults: parsed.maxResults,
            index,
            sourceUrl: result.url
          })
        }))
      );
      return results;
    }
  };
}
