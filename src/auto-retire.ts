import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RetireContext {
  ui?: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
  };
  logger?: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

interface SearchProviderLike {
  id: string;
  label?: string;
}

interface ModelLike {
  id: string;
  provider: string;
}

interface ModelsFacadeLike {
  resolve?(spec: string): ModelLike | undefined;
  list?(): ModelLike[];
}

interface PiPiInternal {
  getSearchProvider?(name: string): Promise<SearchProviderLike>;
  isRegisteredSearchEngine?(name: string): boolean;
}

export interface ExtensionCheckTarget {
  pi?: PiPiInternal;
  models?: ModelsFacadeLike;
}

/**
 * Check if omp has native built-in AnySearch support.
 * Detection criteria:
 * 1. SIMULATE_NATIVE_ANYSEARCH environment variable is set to "1" (for sandbox simulation).
 * 2. pi.pi.getSearchProvider("anysearch") resolves successfully without throwing.
 * 3. ctx.models.resolve("web/anysearch") resolves to a registered search model.
 */
export async function checkNativeAnySearch(target: ExtensionCheckTarget): Promise<boolean> {
  // Check 1: Sandbox simulation hook
  if (process.env.SIMULATE_NATIVE_ANYSEARCH === "1") {
    return true;
  }

  // Check 2: Check internal SearchProvider registry (f3r / getSearchProvider)
  if (typeof target.pi?.getSearchProvider === "function") {
    try {
      const provider = await target.pi.getSearchProvider("anysearch");
      if (provider && provider.id === "anysearch") {
        return true;
      }
    } catch {
      // Not in native provider registry
    }
  }

  // Check 3: Check isRegisteredSearchEngine if exposed
  if (typeof target.pi?.isRegisteredSearchEngine === "function") {
    try {
      if (target.pi.isRegisteredSearchEngine("anysearch")) {
        return true;
      }
    } catch {
      // Not registered
    }
  }

  // Check 4: Check if web/anysearch model is resolved in model registry
  if (typeof target.models?.resolve === "function") {
    try {
      const resolved = target.models.resolve("web/anysearch");
      if (resolved && resolved.provider === "web" && resolved.id === "anysearch") {
        return true;
      }
    } catch {
      // Not resolved
    }
  }

  return false;
}

/**
 * Fallback direct disable: directly update ~/.omp/plugins/omp-plugins.lock.json
 * to set omp-anysearch-provider enabled: false.
 */
export function disablePluginInLockfile(): boolean {
  const home = process.env.HOME || os.homedir();
  const lockfilePath = path.join(home, ".omp", "plugins", "omp-plugins.lock.json");

  try {
    if (!fs.existsSync(lockfilePath)) return false;
    const content = fs.readFileSync(lockfilePath, "utf-8");
    const parsed = JSON.parse(content) as {
      plugins?: Record<string, { enabled?: boolean; [key: string]: unknown }>;
    };

    if (parsed.plugins?.["omp-anysearch-provider"]) {
      parsed.plugins["omp-anysearch-provider"].enabled = false;
      fs.writeFileSync(lockfilePath, JSON.stringify(parsed, null, 2), "utf-8");
      return true;
    }
  } catch {
    // Write failed
  }

  return false;
}

/**
 * Retire the plugin when native support is detected:
 * 1. Attempt `omp plugin uninstall omp-anysearch-provider` (preferred).
 * 2. If uninstall fails, attempt `omp plugin disable omp-anysearch-provider` (fallback 1).
 * 3. If command fails, directly disable in omp-plugins.lock.json (fallback 2).
 */
export async function retirePlugin(ctx?: RetireContext): Promise<"uninstalled" | "disabled" | "failed"> {
  const pluginName = "omp-anysearch-provider";
  const logPrefix = "[AnySearch Auto-Retire]";

  // 1. Preferred: omp plugin uninstall
  try {
    await execFileAsync("omp", ["plugin", "uninstall", pluginName]);
    const msg = `🎉 检测到 omp 已增加原生 AnySearch 支持！插件 ${pluginName} 已自动卸载。后续会话将直接使用原生引擎。`;
    ctx?.logger?.info?.(`${logPrefix} ${msg}`);
    ctx?.ui?.notify(msg, "info");
    return "uninstalled";
  } catch (uninstallError) {
    const errorMsg = uninstallError instanceof Error ? uninstallError.message : String(uninstallError);
    ctx?.logger?.warn?.(`${logPrefix} 自动卸载失败，尝试禁用插件: ${errorMsg}`);
  }

  // 2. Fallback 1: omp plugin disable
  try {
    await execFileAsync("omp", ["plugin", "disable", pluginName]);
    const msg = `检测到 omp 已增加原生 AnySearch 支持！由于卸载受阻，插件 ${pluginName} 已自动禁用，释放搜索控制权。`;
    ctx?.logger?.info?.(`${logPrefix} ${msg}`);
    ctx?.ui?.notify(msg, "info");
    return "disabled";
  } catch (disableError) {
    const errorMsg = disableError instanceof Error ? disableError.message : String(disableError);
    ctx?.logger?.warn?.(`${logPrefix} omp plugin disable 失败，尝试直接写入 lockfile: ${errorMsg}`);
  }

  // 3. Fallback 2: Direct lockfile update
  if (disablePluginInLockfile()) {
    const msg = `检测到 omp 已增加原生 AnySearch 支持！插件 ${pluginName} 已在 lockfile 中标记禁用。`;
    ctx?.logger?.info?.(`${logPrefix} ${msg}`);
    ctx?.ui?.notify(msg, "info");
    return "disabled";
  }

  ctx?.logger?.error?.(`${logPrefix} 自动卸载与禁用均未成功，请手动运行 'omp plugin uninstall ${pluginName}'`);
  return "failed";
}
