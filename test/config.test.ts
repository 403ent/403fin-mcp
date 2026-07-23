import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, loadConfig, normalizeBaseUrl, tokenCacheDir } from "../src/config.js";

describe("normalizeBaseUrl", () => {
  it("defaults to the production API", () => {
    expect(normalizeBaseUrl(undefined)).toBe(DEFAULT_BASE_URL);
  });

  it("trims whitespace and trailing slashes", () => {
    expect(normalizeBaseUrl("  https://api.403fin.io/  ")).toBe("https://api.403fin.io");
    expect(normalizeBaseUrl("https://self.example.com///")).toBe("https://self.example.com");
  });

  it("rejects non-https URLs (TLS is required)", () => {
    expect(() => normalizeBaseUrl("http://api.403fin.io")).toThrow(/https/);
    expect(() => normalizeBaseUrl("ftp://x")).toThrow(/https/);
  });

  it("rejects a malformed URL", () => {
    expect(() => normalizeBaseUrl("not a url")).toThrow();
  });
});

describe("tokenCacheDir", () => {
  it("uses XDG_CONFIG_HOME on linux/mac when set", () => {
    if (process.platform === "win32") {
      return;
    }
    expect(tokenCacheDir({ XDG_CONFIG_HOME: "/custom/cfg" } as NodeJS.ProcessEnv)).toBe(
      join("/custom/cfg", "403fin-mcp"),
    );
  });

  it("falls back to ~/.config on linux/mac", () => {
    if (process.platform === "win32") {
      return;
    }
    const dir = tokenCacheDir({} as NodeJS.ProcessEnv);
    expect(dir.endsWith(join(".config", "403fin-mcp"))).toBe(true);
  });
});

describe("loadConfig", () => {
  it("returns the trimmed API key when FF_API_KEY is set", () => {
    const cfg = loadConfig({ FF_API_KEY: "  ff_ak_1  " } as NodeJS.ProcessEnv);
    expect(cfg.apiKey).toBe("ff_ak_1");
    expect(cfg.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(cfg.cacheFile.endsWith("tokens.json")).toBe(true);
  });

  it("omits the API key when unset or blank", () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).apiKey).toBeUndefined();
    expect(loadConfig({ FF_API_KEY: "   " } as NodeJS.ProcessEnv).apiKey).toBeUndefined();
  });

  it("honors a self-hosted FF_BASE_URL", () => {
    const cfg = loadConfig({ FF_BASE_URL: "https://ff.internal.example/" } as NodeJS.ProcessEnv);
    expect(cfg.baseUrl).toBe("https://ff.internal.example");
  });
});
