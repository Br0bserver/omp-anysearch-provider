import type { AnySearchItem, AnySearchResponse } from "./api.js";

export function formatAnySearchResults(
  query: string,
  response: AnySearchResponse
): string {
  const results = response.data.results || [];
  if (results.length === 0) {
    return `No results found for "${query}" via AnySearch.`;
  }

  const lines: string[] = [];
  const meta = response.data.metadata;
  const timeStr = meta?.search_time_ms === undefined ? "" : ` (${meta.search_time_ms}ms)`;
  lines.push(`Found ${results.length} result(s) for "${query}" via AnySearch${timeStr}:`);
  lines.push("");

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    const title = item.title?.trim() || "Untitled";
    const url = item.url?.trim() || "";
    lines.push(`[${i + 1}] ${title}`);
    if (url) {
      lines.push(`    ${url}`);
    }
    const snippet = item.snippet?.trim() || item.content?.trim();
    if (snippet) {
      const truncated = snippet.length > 300 ? `${snippet.slice(0, 300)}...` : snippet;
      lines.push(`    ${truncated}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function formatExtractResult(
  url: string,
  title: string,
  content: string
): string {
  const lines: string[] = [];
  if (title) {
    lines.push(`# ${title}`);
    lines.push("");
  }
  lines.push(`Source: ${url}`);
  lines.push("");
  lines.push(content);
  return lines.join("\n");
}
