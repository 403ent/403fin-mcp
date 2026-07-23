import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8")) as {
  version: string;
  name: string;
};

describe("version", () => {
  it("VERSION matches package.json (no release drift)", () => {
    expect(VERSION).toBe(pkg.version);
  });

  it("package is named @403fin/mcp", () => {
    expect(pkg.name).toBe("@403fin/mcp");
  });
});
