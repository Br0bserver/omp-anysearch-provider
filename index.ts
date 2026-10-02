import type * as z from "zod";
import { searchAnySearch, extractAnySearch, AnySearchError } from "./src/api.js";
import { formatAnySearchResults, formatExtractResult } from "./src/formatter.js";
import { loadAnySearchConfig, saveAnySearchConfig, maskApiKey } from "./src/config.js";
import { checkNativeAnySearch, retirePlugin } from "./src/auto-retire.js";
// Type definitions compatible with @oh-my-pi/pi-coding-agent Extension API
interface ToolResultContent {
  type: string;
  text?: string;
}

interface AgentToolResult {
  content: ToolResultContent[];
  details?: Record<string, unknown>;
  isError?: boolean;
}

interface ExtensionToolContext {
  cwd: string;
  ui?: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
  };
  invokeTool?(
    params: Record<string, unknown>,
    options?: { signal?: AbortSignal; onUpdate?: (update: AgentToolResult) => void }
  ): Promise<AgentToolResult>;
}

interface ExtensionCommandContext {
  cwd: string;
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
  };
}
interface ExtensionSessionContext {
  cwd: string;
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
  };
  models?: {
    resolve?(spec: string): { id: string; provider: string } | undefined;
    list?(): Array<{ id: string; provider: string }>;
  };
}

interface PiInternalExports {
  getSearchProvider?(name: string): Promise<{ id: string; label?: string }>;
  isRegisteredSearchEngine?(name: string): boolean;
}

interface ExtensionAPI {
  zod: typeof z;
  pi?: PiInternalExports;
  setLabel(label: string): void;
  logger?: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
  on(
    event: string,
    handler: (event: unknown, ctx: ExtensionSessionContext) => Promise<void> | void
  ): void;
  registerTool(def: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute(
      toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: (update: AgentToolResult) => void,
      ctx?: ExtensionToolContext
    ): Promise<AgentToolResult>;
  }): void;
  registerCommand(
    name: string,
    def: {
      description: string;
      handler(args: string, ctx: ExtensionCommandContext): Promise<void> | void;
    }
  ): void;
}

export default async function anysearchExtension(pi: ExtensionAPI): Promise<void> {
  const z = pi.zod;
  pi.setLabel("AnySearch Provider");

  // Check if omp already provides native AnySearch support at load time
  const nativeAtStartup = await checkNativeAnySearch({ pi: pi.pi });
  if (nativeAtStartup) {
    pi.logger?.info?.("[AnySearch] Native AnySearch engine detected at startup; skipping shadow tools.");
    pi.on("session_start", async (_event, ctx) => {
      await retirePlugin({ ui: ctx.ui, logger: pi.logger });
    });
    return;
  }

  // Register session_start check in case native models become active during session lifecycle
  pi.on("session_start", async (_event, ctx) => {
    const nativeActive = await checkNativeAnySearch({ pi: pi.pi, models: ctx.models });
    if (nativeActive) {
      await retirePlugin({ ui: ctx.ui, logger: pi.logger });
    }
  });

  // 1. Shadow the built-in web_search tool so all agent web searches route through AnySearch
  pi.registerTool({
    name: "web_search",
    label: "Web Search (AnySearch)",
    description:
      "Search the public web for real-time, current, or source-backed information using AnySearch. " +
      "Falls back to the native search engine if AnySearch is unavailable or quota is reached.",
    parameters: z.object({
      query: z.string().describe("Search query text"),
      recency: z.enum(["day", "week", "month", "year"]).optional().describe("Recency filter"),
      limit: z.number().min(1).max(10).optional().describe("Max results to return (1-10)"),
      num_search_results: z.number().min(1).max(10).optional().describe("Provider-native search breadth"),
      tag: z.string().optional().describe("Capability tag for vertical search, e.g. 'code.doc', 'finance.quote'"),
      zone: z.enum(["cn", "intl"]).optional().describe("Search zone: 'cn' or 'intl'"),
      language: z.string().optional().describe("Preferred language, e.g. 'zh-CN' or 'en'"),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const query = typeof params.query === "string" ? params.query : "";
      const limit = typeof params.limit === "number" ? params.limit : undefined;
      const numResults = typeof params.num_search_results === "number" ? params.num_search_results : undefined;
      const tag = typeof params.tag === "string" ? params.tag : undefined;
      const zone = params.zone === "cn" || params.zone === "intl" ? params.zone : undefined;
      const language = typeof params.language === "string" ? params.language : undefined;

      const config = loadAnySearchConfig();

      if (config.enabled !== false && config.apiKey) {
        try {
          onUpdate?.({
            content: [{ type: "text", text: `Searching AnySearch for "${query}"...` }],
          });

          const maxResults = limit ?? numResults ?? config.maxResults ?? 10;
          const searchRes = await searchAnySearch(
            {
              query,
              max_results: maxResults,
              tag,
              zone: zone ?? config.defaultZone ?? "intl",
              language,
            },
            config.apiKey,
            signal
          );

          const formattedText = formatAnySearchResults(query, searchRes);
          return {
            content: [{ type: "text", text: formattedText }],
            details: {
              response: {
                provider: "anysearch",
                query,
                sources: searchRes.data.results.map((r) => ({
                  title: r.title,
                  url: r.url,
                  snippet: r.snippet ?? r.content?.slice(0, 300),
                })),
                total_results: searchRes.data.metadata?.total_results,
                search_time_ms: searchRes.data.metadata?.search_time_ms,
                request_id: searchRes.request_id,
              },
            },
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          pi.logger?.warn?.(`[AnySearch] Search failed: ${message}`);

          // Graceful fallback to native web_search tool if available
          if (config.fallbackToNative !== false && typeof ctx?.invokeTool === "function") {
            try {
              onUpdate?.({
                content: [{ type: "text", text: `AnySearch failed (${message}); falling back to native search...` }],
              });
              const nativeRes = await ctx.invokeTool(params, { signal, onUpdate });
              const nativeText = nativeRes.content
                ?.map((item) => (item.type === "text" ? item.text : ""))
                .filter(Boolean)
                .join("\n") || "";

              return {
                ...nativeRes,
                content: [
                  {
                    type: "text",
                    text: `Note: AnySearch unavailable (${message}); fell back to native search provider.\n\n${nativeText}`,
                  },
                ],
              };
            } catch (nativeErr: unknown) {
              const nativeMsg = nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
              throw new AnySearchError(`Both AnySearch and native web_search failed. AnySearch: ${message}; Native: ${nativeMsg}`);
            }
          }

          throw err;
        }
      }

      // No API key configured: fallback to native built-in tool if possible
      if (typeof ctx?.invokeTool === "function") {
        return await ctx.invokeTool(params, { signal, onUpdate });
      }

      throw new AnySearchError("AnySearch API key is not configured and native fallback is unavailable.");
    },
  });

  // 2. Register dedicated anysearch tool for explicit/advanced vertical searches
  pi.registerTool({
    name: "anysearch",
    label: "AnySearch Advanced",
    description:
      "Direct AnySearch vertical search with explicit tags (e.g. 'code.doc', 'academic.search', 'finance.quote'), " +
      "region zones ('cn' or 'intl'), and structured parameters.",
    parameters: z.object({
      query: z.string().describe("Search query text"),
      tag: z.string().optional().describe("Capability tag for vertical domain (e.g. 'code.doc', 'finance.quote')"),
      zone: z.enum(["cn", "intl"]).optional().describe("Region: 'cn' or 'intl'"),
      language: z.string().optional().describe("Preferred language, e.g. 'zh-CN' or 'en'"),
      max_results: z.number().min(1).max(10).optional().describe("Number of results (1-10)"),
      params: z.record(z.string(), z.unknown()).optional().describe("Domain-specific extra parameters (e.g. { library: 'react' })"),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const config = loadAnySearchConfig();
      if (!config.apiKey) {
        throw new AnySearchError("AnySearch API key is not configured. Run /anysearch-setup <api_key> or set ANYSEARCH_API_KEY.");
      }

      const query = typeof params.query === "string" ? params.query : "";
      const tag = typeof params.tag === "string" ? params.tag : undefined;
      const zone = params.zone === "cn" || params.zone === "intl" ? params.zone : undefined;
      const language = typeof params.language === "string" ? params.language : undefined;
      const maxResults = typeof params.max_results === "number" ? params.max_results : 10;
      const extraParams = typeof params.params === "object" && params.params !== null
        ? (params.params as Record<string, unknown>)
        : undefined;

      const res = await searchAnySearch(
        {
          query,
          tag,
          zone: zone ?? config.defaultZone ?? "intl",
          language,
          max_results: maxResults,
          params: extraParams,
        },
        config.apiKey,
        signal
      );

      return {
        content: [{ type: "text", text: formatAnySearchResults(query, res) }],
        details: {
          request_id: res.request_id,
          total_results: res.data.metadata?.total_results,
          search_time_ms: res.data.metadata?.search_time_ms,
        },
      };
    },
  });

  // 3. Register anysearch_extract tool for full page content extraction
  pi.registerTool({
    name: "anysearch_extract",
    label: "AnySearch Page Extraction",
    description: "Extract cleaned, readable markdown content from any web page URL via AnySearch extraction service.",
    parameters: z.object({
      url: z.string().url().describe("The URL to extract content from"),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const config = loadAnySearchConfig();
      if (!config.apiKey) {
        throw new AnySearchError("AnySearch API key is not configured. Set ANYSEARCH_API_KEY or run /anysearch-setup.");
      }

      const url = typeof params.url === "string" ? params.url : "";
      const res = await extractAnySearch(url, config.apiKey, signal);

      return {
        content: [{ type: "text", text: formatExtractResult(res.data.url, res.data.title, res.data.content) }],
        details: {
          request_id: res.request_id,
          url: res.data.url,
          title: res.data.title,
        },
      };
    },
  });

  // 4. Slash commands for managing AnySearch
  pi.registerCommand("anysearch-status", {
    description: "Check AnySearch provider connection and configuration status",
    handler: async (_args, ctx) => {
      const config = loadAnySearchConfig();
      const masked = maskApiKey(config.apiKey);
      ctx.ui.notify(`AnySearch Status: API Key=${masked}, Enabled=${config.enabled !== false}, Zone=${config.defaultZone || "intl"}`, "info");

      if (config.apiKey) {
        try {
          const testStart = Date.now();
          const res = await searchAnySearch({ query: "ping", max_results: 1 }, config.apiKey);
          const latency = Date.now() - testStart;
          ctx.ui.notify(`AnySearch connection verified! Latency: ${latency}ms (upstream: ${res.data.metadata?.search_time_ms || "?"}ms)`, "info");
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          ctx.ui.notify(`AnySearch probe failed: ${msg}`, "error");
        }
      } else {
        ctx.ui.notify("AnySearch API key is not configured. Run /anysearch-setup <key> to configure.", "warning");
      }
    },
  });

  pi.registerCommand("anysearch-setup", {
    description: "Configure AnySearch API key: /anysearch-setup <api_key>",
    handler: (args, ctx) => {
      const trimmed = args.trim();
      if (!trimmed) {
        ctx.ui.notify("Usage: /anysearch-setup <api_key>", "warning");
        return;
      }
      saveAnySearchConfig({ apiKey: trimmed, enabled: true });
      ctx.ui.notify(`AnySearch API key saved (${maskApiKey(trimmed)}).`, "info");
    },
  });

  pi.registerCommand("anysearch", {
    description: "Run an AnySearch query directly: /anysearch <query>",
    handler: async (args, ctx) => {
      const query = args.trim();
      if (!query) {
        ctx.ui.notify("Usage: /anysearch <query>", "warning");
        return;
      }
      const config = loadAnySearchConfig();
      if (!config.apiKey) {
        ctx.ui.notify("AnySearch API key not configured. Run /anysearch-setup <key>", "error");
        return;
      }
      try {
        const res = await searchAnySearch({ query, max_results: 5 }, config.apiKey);
        const text = formatAnySearchResults(query, res);
        ctx.ui.notify(`AnySearch returned ${res.data.results.length} result(s):\n${text}`, "info");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.ui.notify(`AnySearch query error: ${msg}`, "error");
      }
    },
  });
}
