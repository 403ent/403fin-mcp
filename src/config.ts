import { homedir, platform } from "node:os";
import { join } from "node:path";

export const DEFAULT_BASE_URL = "https://api.403fin.io";

export interface Config {
  /** The /v1 API origin, no trailing slash. Always https. */
  baseUrl: string;
  /** The ff_ API key from FF_API_KEY, if set (chooses api-key auth). */
  apiKey?: string;
  /** Directory for the OAuth token cache (0700). */
  cacheDir: string;
  /** Token cache file inside cacheDir (0600). */
  cacheFile: string;
}

/**
 * Resolve the OS-appropriate per-user config directory for the token cache.
 * Linux/mac: $XDG_CONFIG_HOME/403fin-mcp or ~/.config/403fin-mcp.
 * Windows: %APPDATA%/403fin-mcp.
 */
export function tokenCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (platform() === "win32") {
    const appData = env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "403fin-mcp");
  }
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "403fin-mcp");
}

/** Normalize a base URL: trim, drop trailing slashes, require https. */
export function normalizeBaseUrl(raw: string | undefined): string {
  const value = (raw ?? DEFAULT_BASE_URL).trim();
  const trimmed = value.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`FF_BASE_URL is not a valid URL: ${trimmed}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `FF_BASE_URL must use https (got ${parsed.protocol}//). TLS is required for the Forbidden Finance API.`,
    );
  }
  return trimmed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = normalizeBaseUrl(env.FF_BASE_URL);
  const apiKeyRaw = env.FF_API_KEY?.trim();
  const cacheDir = tokenCacheDir(env);
  return {
    baseUrl,
    apiKey: apiKeyRaw && apiKeyRaw.length > 0 ? apiKeyRaw : undefined,
    cacheDir,
    cacheFile: join(cacheDir, "tokens.json"),
  };
}
