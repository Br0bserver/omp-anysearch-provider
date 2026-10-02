# omp-anysearch-provider

AnySearch search provider integration for [Oh My Pi (omp)](https://omp.sh/).

## 核心特性

- **接管 `web_search`**：无缝路由模型搜索至 AnySearch 官方 REST API (`/v1/search`)。
- **自动降级容灾**：遇到网络异常、限流或配额耗尽（402）时，自动回退至 omp 原生引擎（`ctx.invokeTool`）。
- **原生支持自动隐退**：检测到 omp 内核增加原生 `anysearch` 支持后，启动时自动卸载并交还控制权。
- **扩展工具与指令**：提供 `anysearch`（垂直 Tag 搜索）、`anysearch_extract`（网页抽取）及 `/anysearch-status` / `/anysearch-setup` 指令。

## 配置方式

优先级：`ANYSEARCH_API_KEY` 环境变量 > `~/.omp/agent/anysearch.json`

```json
{
  "apiKey": "as_sk_...",
  "enabled": true,
  "fallbackToNative": true,
  "defaultZone": "intl",
  "maxResults": 10
}
```

## 安装与挂载

```bash
omp plugin link /path/to/omp-anysearch-provider
```
