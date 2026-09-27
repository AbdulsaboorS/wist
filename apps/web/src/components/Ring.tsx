import type { CapabilityReadinessStatus } from "@wist/domain";

type RingProps = {
  readonly status: CapabilityReadinessStatus;
};

/**
 * Readiness as a shape: hollow declared, half installed, filled authorized, filled with a check
 * ready, dashed stale, struck unsupported. The state word sits beside it; the ring never speaks.
 */
export function Ring({ status }: RingProps) {
  return <span className={`ring ${status}`} aria-hidden="true" />;
}
