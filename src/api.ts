export class AnySearchError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AnySearchError";
    this.status = status;
  }
}

export interface AnySearchItem {
  title: string;
  url: string;
  snippet?: string;
  content?: string;
}

export interface AnySearchMetadata {
  total_results?: number;
  search_time_ms?: number;
}

export interface AnySearchResponse {
  code: number;
  message: string;
  request_id: string;
  data: {
    results: AnySearchItem[];
    metadata?: AnySearchMetadata;
  };
}

export interface AnySearchExtractResponse {
  code: number;
  message: string;
  request_id: string;
  data: {
    url: string;
    title: string;
    content: string;
  };
}

export interface AnySearchParams {
  query: string;
  max_results?: number;
  tag?: string;
  zone?: "cn" | "intl";
  language?: string;
  params?: Record<string, unknown>;
  format?: "json" | "markdown";
}

const SEARCH_ENDPOINT = "https://api.anysearch.com/v1/search";
const EXTRACT_ENDPOINT = "https://api.anysearch.com/v1/extract";
const SUB_DOMAINS_ENDPOINT = "https://api.anysearch.com/v1/sub-domains";

export async function searchAnySearch(
  params: AnySearchParams,
  apiKey: string,
  signal?: AbortSignal
): Promise<AnySearchResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const payload: Record<string, unknown> = {
    query: params.query,
    max_results: Math.min(10, Math.max(1, params.max_results ?? 10)),
  };

  if (params.tag) payload.tag = params.tag;
  if (params.zone) payload.zone = params.zone;
  if (params.language) payload.language = params.language;
  if (params.params) payload.params = params.params;
  if (params.format) payload.format = params.format;

  const res = await fetch(SEARCH_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status} ${res.statusText}`;
    try {
      const errorText = await res.text();
      const parsed = JSON.parse(errorText) as { message?: string };
      if (parsed.message) errorMsg = `${errorMsg}: ${parsed.message}`;
    } catch {
      // Keep default message
    }
    throw new AnySearchError(errorMsg, res.status);
  }

  const data = (await res.json()) as AnySearchResponse;
  if (data.code !== 0) {
    throw new AnySearchError(`AnySearch error [code=${data.code}]: ${data.message}`);
  }

  return data;
}

export async function extractAnySearch(
  url: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<AnySearchExtractResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(EXTRACT_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ url }),
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new AnySearchError(`AnySearch extract failed: HTTP ${res.status} - ${errorText.slice(0, 200)}`, res.status);
  }

  return (await res.json()) as AnySearchExtractResponse;
}

export async function getSubDomainsAnySearch(
  domain?: string,
  apiKey?: string,
  signal?: AbortSignal
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const endpoint = domain
    ? `${SUB_DOMAINS_ENDPOINT}?domain=${encodeURIComponent(domain)}`
    : SUB_DOMAINS_ENDPOINT;

  const res = await fetch(endpoint, {
    method: "GET",
    headers,
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new AnySearchError(`AnySearch sub-domains failed: HTTP ${res.status} - ${errorText.slice(0, 200)}`, res.status);
  }

  return await res.json();
}
