import type { ReactNode } from "react";

import type { LoadState } from "../data/snapshot";
import type { PassportSnapshot } from "../data/snapshot";

type LoadGateProps = {
  readonly state: LoadState;
  readonly reload: () => void;
  readonly emptyLabel: string;
  readonly emptyBody: ReactNode;
  readonly children: (snapshot: PassportSnapshot) => ReactNode;
};

/** Shared loading / unauthorized / error / empty shells for dashboard screens. */
export function LoadGate({ state, reload, emptyLabel, emptyBody, children }: LoadGateProps) {
  if (state.status === "loading") {
    return (
      <div className="slot" role="status" aria-live="polite">
        <span className="label">Passport</span>
        <span className="mono">Reading from 127.0.0.1</span>
      </div>
    );
  }

  if (state.status === "unauthorized") {
    return (
      <div className="slot">
        <span className="label">Opened without its key</span>
        <p>
          Open this dashboard from the link printed by the Wist CLI. A new tab or daemon launch
          needs a fresh link.
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="slot" role="alert">
        <span className="label">Daemon unreachable</span>
        <p>{state.message}</p>
        <div className="slot-actions">
          <button className="btn" type="button" onClick={reload}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (state.status === "empty") {
    return (
      <div className="slot">
        <span className="label">{emptyLabel}</span>
        {emptyBody}
      </div>
    );
  }

  return children(state.snapshot);
}
