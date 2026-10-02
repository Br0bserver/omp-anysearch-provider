# omp-anysearch-provider

AnySearch search provider integration for [Oh My Pi (omp)](https://omp.sh/).

## Features

- **Built-in `web_search` Shadowing**: Seamlessly intercepts model web searches to use AnySearch's REST API (`https://api.anysearch.com/v1/search`) as the primary search engine.
- **Graceful Native Fallback**: If AnySearch encounters a rate limit, quota exhaustion (HTTP 402), or network failure, it automatically delegates to omp's native search engine via `ctx.invokeTool`, ensuring uninterrupted operation.
- **Vertical Domain Search**: Dedicated `anysearch` tool supporting AnySearch's 40 capability tags (e.g. `code.doc`, `academic.search`, `finance.quote`), regions (`cn` or `intl`), and structured query parameters.
- **Page Extraction**: Dedicated `anysearch_extract` tool utilizing AnySearch's `/v1/extract` endpoint to extract clean readable markdown from any web page.
- **Slash Commands**:
  - `/anysearch-status`: Check AnySearch connection and latency.
  - `/anysearch-setup <api_key>`: Configure or update your AnySearch API key.
  - `/anysearch <query>`: Direct CLI search test.

## Configuration

The API key is resolved with the following precedence:

1. Environment variable: `ANYSEARCH_API_KEY`
2. Configuration file: `~/.omp/agent/anysearch.json` (or `~/.omp/anysearch.json`)

Example `~/.omp/agent/anysearch.json`:

```json
{
  "apiKey": "as_sk_...",
  "enabled": true,
  "fallbackToNative": true,
  "defaultZone": "intl",
  "maxResults": 10
}
```

## Tools Registered

1. `web_search`: Standard search tool used by omp models, powered by AnySearch with automatic fallback.
2. `anysearch`: Advanced vertical search with `tag`, `zone`, `params`, and `language` options.
3. `anysearch_extract`: Web page markdown extraction tool.
