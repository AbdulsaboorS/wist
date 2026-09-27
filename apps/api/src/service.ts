import { HandoffSchema, inspectSetupPlan, RuntimeSchema, type Runtime } from "@wist/domain";
import type { CaptureAssessment, CaptureAssessor } from "@wist/intelligence";

import {
  MAX_COMPACT_RESPONSE_TOKENS,
  PassportBundleSchema,
  estimateJsonTokens,
  type PassportBundle,
  type ProjectBrief,
} from "./contracts.js";
import {
  PassportStoreConflictError,
  type PassportStore,
  type StoredConnectionGrant,
} from "./store.js";

export type ServiceErrorCode =
  | "expired"
  | "forbidden"
  | "invalid"
  | "not_found"
  | "revoked"
  | "unauthorized";

export class PassportServiceError extends Error {
  readonly code: ServiceErrorCode;

  constructor(code: ServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type PublishResult = {
  readonly project: ProjectBrief;
};

export type CaptureAssessmentOutcome =
  | { readonly status: "complete"; readonly assessment: CaptureAssessment }
  | { readonly status: "not_configured" | "unavailable"; readonly assessment: null };

export class PassportService {
  readonly #store: PassportStore;
  readonly #assessor: CaptureAssessor | undefined;
  readonly #now: () => Date;

  constructor(options: { store: PassportStore; assessor?: CaptureAssessor; now?: () => Date }) {
    this.#store = options.store;
    this.#assessor = options.assessor;
    this.#now = options.now ?? (() => new Date());
  }

  async publish(input: {
    bundle: PassportBundle;
    shareId: string;
    identityId: string;
    grant: StoredConnectionGrant;
  }): Promise<PublishResult> {
    const bundle = this.#publishable(input.bundle);

    try {
      await this.#store.publish({
        share: {
          id: input.shareId,
          identityId: input.identityId,
          projectId: bundle.project.id,
          handoffId: bundle.handoff.id,
          expiresAt: bundle.handoff.expiresAt,
          bundle,
          createdAt: this.#now().toISOString(),
          updatedAt: this.#now().toISOString(),
        },
        grant: input.grant,
      });
    } catch (error) {
      if (error instanceof PassportStoreConflictError) {
        throw new PassportServiceError("invalid", error.message);
      }

      throw error;
    }

    return { project: this.#brief(bundle) };
  }

  async publishHandoff(input: {
    bundle: PassportBundle;
    identityId: string;
  }): Promise<PublishResult> {
    const bundle = this.#publishable(input.bundle);
    const share = await this.#store.getShare(bundle.project.id);

    if (share === undefined) {
      throw new PassportServiceError("not_found", "Project has no share to update.");
    }

    if (share.identityId !== input.identityId) {
      throw new PassportServiceError("forbidden", "Another identity owns this share.");
    }

    if (share.revokedAt !== undefined) {
      throw new PassportServiceError("revoked", "The Project share has been revoked.");
    }

    if (share.handoffId === bundle.handoff.id) {
      throw new PassportServiceError("invalid", "The share already serves this Handoff.");
    }

    const updated = await this.#store.updateHandoff({
      projectId: bundle.project.id,
      identityId: input.identityId,
      bundle,
      updatedAt: this.#now().toISOString(),
    });

    if (!updated) {
      throw new PassportServiceError("revoked", "The Project share is no longer active.");
    }

    return { project: this.#brief(bundle) };
  }

  async assessCapture(
    bundle: Pick<PassportBundle, "project" | "handoff">,
  ): Promise<CaptureAssessmentOutcome> {
    if (bundle.handoff.projectId !== bundle.project.id) {
      throw new PassportServiceError("invalid", "Handoff does not belong to the Project.");
    }

    if (this.#assessor === undefined) {
      return { status: "not_configured", assessment: null };
    }

    try {
      return {
        status: "complete",
        assessment: await this.#assessor.assess({
          project: bundle.project,
          handoff: bundle.handoff,
        }),
      };
    } catch {
      return { status: "unavailable", assessment: null };
    }
  }

  async listProjects(projectIds: readonly string[]): Promise<ProjectBrief[]> {
    const projects: ProjectBrief[] = [];

    for (const projectId of projectIds) {
      const share = await this.#store.getShare(projectId);

      if (share?.bundle !== undefined && this.#isReadable(share.bundle, share.revokedAt)) {
        projects.push(this.#brief(share.bundle));
      }
    }

    return projects;
  }

  async getBrief(projectId: string): Promise<ProjectBrief> {
    return this.#brief((await this.#requireReadable(projectId)).bundle);
  }

  async getHandoff(projectId: string) {
    return (await this.#requireReadable(projectId)).bundle.handoff;
  }

  async getSetupPlan(projectId: string) {
    return (await this.#requireReadable(projectId)).bundle.setupPlan;
  }

  async reportReadiness(projectId: string, runtimeInput: Runtime): Promise<Runtime> {
    const { shareId, bundle } = await this.#requireReadable(projectId);
    const runtime = RuntimeSchema.parse(runtimeInput);

    if (runtime.id !== bundle.setupPlan.runtimeId) {
      throw new PassportServiceError(
        "invalid",
        "Runtime readiness must describe the Runtime named by the Setup Plan.",
      );
    }

    await this.#store.recordReadiness(shareId, runtime, this.#now().toISOString());

    return runtime;
  }

  async revoke(projectId: string, identityId: string): Promise<void> {
    const share = await this.#store.getShare(projectId);

    if (share === undefined) {
      throw new PassportServiceError("not_found", "Project was not found.");
    }

    if (share.identityId !== identityId) {
      throw new PassportServiceError("forbidden", "Another identity owns this share.");
    }

    await this.#store.revokeProject(projectId, identityId, this.#now().toISOString());
  }

  async #requireReadable(projectId: string): Promise<{ shareId: string; bundle: PassportBundle }> {
    const share = await this.#store.getShare(projectId);

    if (share === undefined) {
      throw new PassportServiceError("not_found", "Project was not found.");
    }

    if (share.revokedAt !== undefined || share.bundle?.handoff.status === "revoked") {
      throw new PassportServiceError("revoked", "The Project share has been revoked.");
    }

    if (share.bundle === undefined || Date.parse(share.expiresAt) <= this.#now().getTime()) {
      throw new PassportServiceError("expired", "The Project share has expired.");
    }

    return { shareId: share.id, bundle: share.bundle };
  }

  #publishable(input: PassportBundle): PassportBundle {
    const bundle = PassportBundleSchema.parse(input);
    this.#assertBundleRelationships(bundle);

    if (bundle.handoff.status !== "published" || bundle.handoff.approvedAt === undefined) {
      throw new PassportServiceError("invalid", "Publishing requires an approved Handoff.");
    }

    if (Date.parse(bundle.handoff.expiresAt) <= this.#now().getTime()) {
      throw new PassportServiceError("expired", "The Handoff has already expired.");
    }

    return bundle;
  }

  #isReadable(bundle: PassportBundle, revokedAt?: string): boolean {
    return (
      revokedAt === undefined &&
      bundle.handoff.status === "published" &&
      Date.parse(bundle.handoff.expiresAt) > this.#now().getTime()
    );
  }

  #brief(bundle: PassportBundle): ProjectBrief {
    const brief: ProjectBrief = {
      id: bundle.project.id,
      name: bundle.project.name,
      goal: bundle.project.goal,
      activeBranch: bundle.project.repository.activeBranch,
      updatedAt: bundle.project.updatedAt,
      currentHandoff: {
        id: bundle.handoff.id,
        goal: bundle.handoff.goal,
        expiresAt: bundle.handoff.expiresAt,
      },
      handles: {
        handoff: `/v1/projects/${bundle.project.id}/handoff`,
        setupPlan: `/v1/projects/${bundle.project.id}/setup-plan`,
      },
    };

    if (estimateJsonTokens(brief) > MAX_COMPACT_RESPONSE_TOKENS) {
      throw new PassportServiceError("invalid", "The compact Project brief exceeds its budget.");
    }

    return brief;
  }

  #assertBundleRelationships(bundle: PassportBundle): void {
    if (
      bundle.handoff.projectId !== bundle.project.id ||
      bundle.setupPlan.projectId !== bundle.project.id ||
      bundle.setupPlan.handoffId !== bundle.handoff.id ||
      bundle.setupPlan.runtimeId !== bundle.runtime.id
    ) {
      throw new PassportServiceError("invalid", "Passport records do not reference one another.");
    }

    const declaredCapabilityIds = new Set(bundle.capabilities.map((capability) => capability.id));

    if (bundle.project.capabilityIds.some((id) => !declaredCapabilityIds.has(id))) {
      throw new PassportServiceError("invalid", "Project references an undeclared Capability.");
    }

    const setupIssues = inspectSetupPlan(bundle.setupPlan, bundle.capabilities);

    if (setupIssues.length > 0) {
      throw new PassportServiceError(
        "invalid",
        setupIssues[0]?.message ?? "Setup Plan is invalid.",
      );
    }

    HandoffSchema.parse(bundle.handoff);
  }
}
