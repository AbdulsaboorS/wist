import type { Capability, CapabilityReadinessStatus } from "@wist/domain";

import type { ReadinessRow } from "../data/snapshot";
import { Ring } from "./Ring";

type ReadinessListProps = {
  readonly rows: readonly ReadinessRow[];
  readonly ariaLabel: string;
  /** Show the verification command beside each name; hidden on narrow viewports. */
  readonly wide?: boolean;
};

function verificationText(capability: Capability): string {
  const { verification } = capability;

  if (verification.kind === "command") {
    return verification.command.join(" ");
  }

  return `GET ${new URL(verification.endpoint).pathname}`;
}

function statusOf(row: ReadinessRow): CapabilityReadinessStatus {
  return row.readiness?.status ?? "declared";
}

export function ReadinessList({ rows, ariaLabel, wide = false }: ReadinessListProps) {
  return (
    <ul className={wide ? "bom wide" : "bom"} aria-label={ariaLabel}>
      {rows.map((row) => {
        const status = statusOf(row);

        return (
          <li key={row.capability.id}>
            <Ring status={status} />
            <span>{row.capability.name}</span>
            {wide ? <span className="cmd">{verificationText(row.capability)}</span> : null}
            <span className={status === "ready" ? "state is-ready" : "state"}>{status}</span>
          </li>
        );
      })}
    </ul>
  );
}
