import type { Config } from "../config.js";
import { ApiKeyProvider } from "./apikey.js";
import { OAuthProvider } from "./oauth.js";
import { TokenStore } from "./tokenstore.js";
import type { CredentialProvider } from "./types.js";

/**
 * Choose the credential provider: an ff_ API key (FF_API_KEY) uses the API-key
 * path; otherwise the interactive OAuth 2.1 flow. FF_SCOPES overrides the
 * requested OAuth scope.
 */
export function createCredentialProvider(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
): CredentialProvider {
  if (config.apiKey) {
    return new ApiKeyProvider(config.apiKey);
  }
  return new OAuthProvider({
    baseUrl: config.baseUrl,
    store: new TokenStore(config.cacheFile),
    scope: env.FF_SCOPES?.trim() || undefined,
  });
}
