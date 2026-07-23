import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** One base URL's cached OAuth state. */
export interface TokenEntry {
  /** Dynamically-registered public client id (survives token clears). */
  clientId?: string;
  accessToken?: string;
  refreshToken?: string;
  /** Access-token expiry, epoch milliseconds. */
  expiresAt?: number;
}

type Store = Record<string, TokenEntry>;

/**
 * Per-user token cache, one JSON file keyed by base URL. Writes are atomic
 * (temp file + rename) so a crash mid-write cannot lose a rotated refresh token,
 * and the file/dir are locked to the owner (0600 / 0700). Secrets never leave
 * this file — they are not logged.
 */
export class TokenStore {
  readonly #file: string;

  constructor(file: string) {
    this.#file = file;
  }

  #readAll(): Store {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.#file, "utf8"));
      return parsed && typeof parsed === "object" ? (parsed as Store) : {};
    } catch {
      return {};
    }
  }

  #writeAll(store: Store): void {
    const dir = dirname(this.#file);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      // best-effort on platforms without POSIX modes
    }
    const tmp = `${this.#file}.tmp-${randomBytes(8).toString("hex")}`;
    writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // best-effort
    }
    // rename is atomic on POSIX and replaces on Windows (MoveFileEx).
    renameSync(tmp, this.#file);
    try {
      chmodSync(this.#file, 0o600);
    } catch {
      // best-effort
    }
  }

  /** Read the entry for a base URL (empty object if none). */
  read(baseUrl: string): TokenEntry {
    return this.#readAll()[baseUrl] ?? {};
  }

  /** Merge a patch into a base URL's entry and persist atomically. */
  merge(baseUrl: string, patch: TokenEntry): void {
    const store = this.#readAll();
    store[baseUrl] = { ...(store[baseUrl] ?? {}), ...patch };
    this.#writeAll(store);
  }

  /** Drop cached tokens for a base URL but keep the registered client id. */
  clearTokens(baseUrl: string): void {
    const store = this.#readAll();
    const existing = store[baseUrl];
    if (!existing) {
      return;
    }
    store[baseUrl] = existing.clientId ? { clientId: existing.clientId } : {};
    this.#writeAll(store);
  }
}
