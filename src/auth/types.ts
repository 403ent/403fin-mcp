/**
 * A source of the Bearer credential sent on every /v1 request. Either a static
 * ff_ API key or an OAuth 2.1 access token that can be refreshed.
 */
export interface CredentialProvider {
  /** Return the current Bearer credential (an ff_ token or api key). */
  getCredential(): Promise<string>;
  /**
   * Called after a 401. Attempt to obtain a fresh credential (token refresh or
   * re-auth). Return true if a new credential is now available and the request
   * should be retried once; false if this provider cannot recover (e.g. a static
   * API key, or a rejected refresh token).
   */
  reauthorize(): Promise<boolean>;
}
