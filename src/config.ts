import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface AnySearchConfig {
  apiKey?: string;
  enabled?: boolean;
  fallbackToNative?: boolean;
  defaultZone?: "cn" | "intl";
  maxResults?: number;
}

const DEFAULT_CONFIG: AnySearchConfig = {
  enabled: true,
  fallbackToNative: true,
  defaultZone: "intl",
  maxResults: 10,
};

function getConfigPaths(): string[] {
  const home = process.env.HOME || os.homedir();
  return [
    path.join(home, ".omp", "agent", "anysearch.json"),
    path.join(home, ".omp", "anysearch.json"),
  ];
}

export function loadAnySearchConfig(): AnySearchConfig {
  const envKey = process.env.ANYSEARCH_API_KEY?.trim();
  let fileConfig: AnySearchConfig = {};

  for (const p of getConfigPaths()) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf-8");
        fileConfig = JSON.parse(content);
        break;
      }
    } catch {
      // Ignore read/parse errors
    }
  }

  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    apiKey: envKey || fileConfig.apiKey || "",
  };
}

export function saveAnySearchConfig(updates: Partial<AnySearchConfig>): void {
  const paths = getConfigPaths();
  const targetPath = paths[0]; // ~/.omp/agent/anysearch.json
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = loadAnySearchConfig();
  const merged = { ...existing, ...updates };

  fs.writeFileSync(targetPath, JSON.stringify(merged, null, 2), "utf-8");
}

export function maskApiKey(key?: string): string {
  if (!key || key.length < 8) return "(not configured)";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}
