import type {
  CaptureAssessmentOutcome,
  IdentityRegistrationRequest,
  PassportBundle,
  ProjectBrief,
} from "@wist/api";

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response> | Response;

type PublishResponse = {
  readonly project: ProjectBrief;
};

export class PassportApiClient {
  readonly #baseUrl: string;
  readonly #fetch: Fetch;

  constructor(baseUrl: string, fetchImplementation: Fetch = fetch) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#fetch = fetchImplementation;
  }

  registerIdentity(registration: IdentityRegistrationRequest): Promise<{ identityId: string }> {
    return this.#request<{ identityId: string }>("/v1/identities", undefined, {
      method: "POST",
      body: JSON.stringify(registration),
    });
  }

  assess(bundle: PassportBundle, token: string): Promise<CaptureAssessmentOutcome> {
    return this.#request<CaptureAssessmentOutcome>(
      `/v1/projects/${bundle.project.id}/assess`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ project: bundle.project, handoff: bundle.handoff }),
      },
    );
  }

  publish(
    bundle: PassportBundle,
    authorization: { ownerToken: string; shareId: string; connectionToken: string },
  ): Promise<PublishResponse> {
    return this.#request<PublishResponse>(
      `/v1/projects/${bundle.project.id}/publish`,
      authorization.ownerToken,
      {
        method: "POST",
        body: JSON.stringify({
          bundle,
          approved: true,
          shareId: authorization.shareId,
          connectionToken: authorization.connectionToken,
        }),
      },
    );
  }

  publishHandoff(bundle: PassportBundle, ownerToken: string): Promise<PublishResponse> {
    return this.#request<PublishResponse>(`/v1/projects/${bundle.project.id}/handoff`, ownerToken, {
      method: "PUT",
      body: JSON.stringify({ bundle, approved: true }),
    });
  }

  getProject(projectId: string, token: string): Promise<ProjectBrief> {
    return this.#request<ProjectBrief>(`/v1/projects/${projectId}`, token);
  }

  async revoke(projectId: string, ownerToken: string, reason: string): Promise<void> {
    await this.#request<undefined>(`/v1/projects/${projectId}/revoke`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  replaceConnection(
    projectId: string,
    ownerToken: string,
    input: { oldTokenId: string; connectionToken: string; scopes: readonly string[] },
  ): Promise<{ connectionId: string; tokenId: string; expiresAt: string }> {
    return this.#request(`/v1/projects/${projectId}/connections`, ownerToken, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async #request<T>(path: string, token: string | undefined, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);

    if (token !== undefined) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    if (init.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Wist API returned ${response.status}: ${detail}`);
    }

    if (response.status === 204) {
      // SAFETY: Callers use this branch only for endpoints whose declared response has no body.
      return undefined as T;
    }

    // SAFETY: Each caller supplies the response type declared by the matching OpenAPI route.
    return (await response.json()) as T;
  }
}
