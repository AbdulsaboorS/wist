import type { ReactNode } from "react";

import "./passport.css";

type PassportProps = {
  readonly variant: "full" | "compact";
  /** A revoked passport keeps every field and loses its colour. */
  readonly drained?: boolean;
  readonly issued?: string | undefined;
  readonly ariaLabel: string;
  readonly children: ReactNode;
};

export function Passport({ variant, drained = false, issued, ariaLabel, children }: PassportProps) {
  const className = ["pp", variant, drained ? "drained" : ""].join(" ").trim();

  return (
    <dl className={className} aria-label={ariaLabel}>
      <div className="pp-head">
        <span className="pp-title">Wist</span>
        {issued === undefined ? null : <span className="mono dim">{issued}</span>}
      </div>
      {children}
    </dl>
  );
}

export function PassportRows({ children }: { readonly children: ReactNode }) {
  return <div className="pp-rows">{children}</div>;
}

export function PassportRule() {
  return <hr className="rule" />;
}

export function PassportFoot({ children }: { readonly children: ReactNode }) {
  return <div className="pp-foot">{children}</div>;
}
