import {
  CapabilitySchema,
  HandoffSchema,
  ProjectSchema,
  RuntimeSchema,
  SetupPlanSchema,
  type Handoff,
} from "@wist/domain";
import { z } from "zod";

export const AccessScopeSchema = z.enum([
  "project:write",
  "project:read",
  "handoff:read",
  "setup-plan:read",
  "readiness:write",
]);

export type AccessScope = z.infer<typeof AccessScopeSchema>;

export const DestinationAccessScopeSchema = z.enum([
  "project:read",
  "handoff:read",
  "setup-plan:read",
  "readiness:write",
]);

export type DestinationAccessScope = z.infer<typeof DestinationAccessScopeSchema>;

export const Ed25519PublicKeySchema = z
  .object({
    kty: z.literal("OKP"),
    crv: z.literal("Ed25519"),
    x: z.string().min(1),
  })
  .strict();

export type Ed25519PublicKey = z.infer<typeof Ed25519PublicKeySchema>;

export const IdentityRegistrationRequestSchema = z
  .object({
    identityId: z.string().min(1),
    publicKey: Ed25519PublicKeySchema,
    proof: z.string().min(1),
  })
  .strict();

export type IdentityRegistrationRequest = z.infer<typeof IdentityRegistrationRequestSchema>;

export const PassportBundleSchema = z
  .object({
    project: ProjectSchema,
    handoff: HandoffSchema,
    capabilities: z.array(CapabilitySchema),
    runtime: RuntimeSchema,
    setupPlan: SetupPlanSchema,
  })
  .strict();

export type PassportBundle = z.infer<typeof PassportBundleSchema>;

export const PublishRequestSchema = z
  .object({
    bundle: PassportBundleSchema,
    approved: z.literal(true),
    shareId: z.uuid(),
    connectionToken: z.string().min(1),
  })
  .strict();

export const PublishHandoffRequestSchema = z
  .object({
    bundle: PassportBundleSchema,
    approved: z.literal(true),
  })
  .strict();

const TokenClaimsBaseSchema = z.object({
  iss: z.string().min(1),
  aud: z.union([z.string().min(1), z.array(z.string().min(1))]),
  sub: z.string().min(1),
  jti: z.string().min(1),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  version: z.literal(1),
});

export const IdentityTokenClaimsSchema = TokenClaimsBaseSchema.extend({
  kind: z.literal("identity"),
});

export const OwnerTokenClaimsSchema = TokenClaimsBaseSchema.extend({
  kind: z.literal("owner"),
  projectId: z.uuid(),
  scope: z.tuple([z.literal("project:write")]),
});

export const ConnectionTokenClaimsSchema = TokenClaimsBaseSchema.extend({
  kind: z.literal("connection"),
  connectionId: z.uuid(),
  projectId: z.uuid(),
  shareId: z.uuid(),
  scope: z.array(DestinationAccessScopeSchema).min(1),
});

export type ConnectionTokenClaims = z.infer<typeof ConnectionTokenClaimsSchema>;

export const CaptureAssessmentRequestSchema = z
  .object({
    project: ProjectSchema,
    handoff: HandoffSchema,
  })
  .strict();

export const RevokeRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const ErrorResponseSchema = z
  .object({
    error: z.string(),
    message: z.string(),
  })
  .strict();

export const ProjectBriefSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    goal: z.string(),
    activeBranch: z.string(),
    updatedAt: z.iso.datetime({ offset: true }),
    currentHandoff: z.object({
      id: z.uuid(),
      goal: z.string(),
      expiresAt: z.iso.datetime({ offset: true }),
    }),
    handles: z.object({
      handoff: z.string(),
      setupPlan: z.string(),
    }),
  })
  .strict();

export type ProjectBrief = z.infer<typeof ProjectBriefSchema>;

export const MAX_COMPACT_RESPONSE_TOKENS = 750;

export const MAX_DEFAULT_CONTEXT_TOKENS = 1_500;

export type CompactPayload =
  | ProjectBrief
  | { readonly projects: readonly ProjectBrief[] }
  | { readonly project: ProjectBrief; readonly handoff: Handoff };

export function estimateJsonTokens(value: CompactPayload): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}
