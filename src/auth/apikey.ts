import type { CredentialProvider } from "./types.js";

/**
 * Static ff_ API key credential. The key is held only in memory and never
 * persisted or logged. A 401 is unrecoverable for an API key (there is nothing
 * to refresh), so reauthorize always reports failure.
 */
export class ApiKeyProvider implements CredentialProvider {
  readonly #key: string;

  constructor(key: string) {
    if (!key.startsWith("ff_")) {
      throw new Error(
        "FF_API_KEY does not look like a Forbidden Finance key (expected an ff_ prefix). Get one in the app under Settings → AI & API Connections.",
      );
    }
    this.#key = key;
  }

  getCredential(): Promise<string> {
    return Promise.resolve(this.#key);
  }

  reauthorize(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
