import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import { Field } from "../components/Field";
import { Fingerprint } from "../components/Fingerprint";
import { Passport, PassportFoot, PassportRows, PassportRule } from "../components/Passport";
import { isHandoffStale, type PassportSnapshot, type Share } from "../data/snapshot";
import { HandOff } from "../components/HandOff";
import { localApi, usePassport } from "../data/use-passport";
import { destinationLabel, destinationShortName } from "../lib/destination";
import { formatInstant, shortRevision } from "../lib/time";
import { LoadGate } from "./LoadGate";

import "./share-preview.css";

/** Proposed share when nothing has been published yet. Scopes match the connector fixture. */
const PROPOSED_SCOPES = ["project:read", "handoff:read", "setup-plan:read"] as const;

const PROPOSED_HOURS = 24;

const DEFAULT_RELAY_URL = "https://wist-relay.feedback-signal.workers.dev";

export function SharePreview() {
  const { state, reload } = usePassport();

  return (
    <LoadGate
      state={state}
      reload={reload}
      emptyLabel="Nothing to share"
      emptyBody={
        <>
          <p>
            Hand off a project first. Then this screen shows exactly what a destination would
            receive.
          </p>
          <HandOff onCaptured={reload} />
        </>
      }
    >
      {(snapshot) => <SharePreviewReady snapshot={snapshot} reload={reload} />}
    </LoadGate>
  );
}

function SharePreviewReady({
  snapshot,
  reload,
}: {
  readonly snapshot: PassportSnapshot;
  readonly reload: () => void;
}) {
  const { identity, bundle, share, repository } = snapshot;
  const { project, handoff, capabilities, setupPlan } = bundle;
  const destination = destinationLabel(snapshot);
  const proposedDestination = share?.destination ?? destinationShortName(bundle.runtime);
  const scopes = share?.scopes ?? PROPOSED_SCOPES;
  const stale = isHandoffStale(snapshot);
  const revoked = share?.status === "revoked";
  const published = share !== undefined && share.status === "active";
  // The working Handoff is newer than the one the relay serves.
  const newVersion = share !== undefined && handoff.id !== share.handoffId;
  const expired = share?.status === "expired";

  const approved =
    !import.meta.env.DEV &&
    handoff.status === "published" &&
    (share === undefined || (newVersion && !published));

  const [confirmed, setConfirmed] = useState(false);
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY_URL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [revealed, setRevealed] = useState<{ connectionUrl: string; token: string }>();
  const [copiedToken, setCopiedToken] = useState(false);

  const fixture = import.meta.env.DEV;

  async function run(action: () => Promise<void>, refresh = true): Promise<void> {
    setBusy(true);
    setError(undefined);

    try {
      await action();

      if (refresh) reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The local action failed.");
    } finally {
      setBusy(false);
    }
  }

  function publish(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void run(async () => {
      await localApi(`/api/projects/${project.id}/publish`, "POST", { relayUrl });
    });
  }

  return (
    <div className="share-preview">
      <figure aria-labelledby="share-caption">
        <Passport
          variant="full"
          drained={revoked}
          issued={share === undefined ? "preview" : `issued ${formatInstant(share.issuedAt)}`}
          ariaLabel={`Share preview for ${project.name}`}
        >
          <PassportRows>
            <Field label="To">{proposedDestination}</Field>
            <Field label="Holder">
              {identity.holder}
              {identity.sample ? <span className="dim"> · sample</span> : null}
            </Field>
            <Field label="Key">
              <span className="dim">{identity.keyAlgorithm}</span>{" "}
              <Fingerprint value={identity.keyFingerprint} />
              <span className="dim"> · public</span>
            </Field>
            <Field label="Project">
              {project.repository.name}
              <span className="dim">
                {" "}
                · {project.repository.activeBranch} @ {shortRevision(project.repository.revision)}
              </span>
            </Field>
            <Field label="Handoff">{handoff.goal}</Field>
          </PassportRows>

          <PassportRule />

          <PassportRows>
            <Field label="Scopes">
              <span className={revoked ? "strike" : undefined}>
                {scopes.map((scope, index) => (
                  <span key={scope}>
                    {index > 0 ? <span className="dim"> · </span> : null}
                    {scope}
                  </span>
                ))}
              </span>
            </Field>
            <Field label="Expires">
              {share === undefined ? (
                <span>
                  in {PROPOSED_HOURS}h<span className="dim"> · default</span>
                </span>
              ) : (
                <span className={revoked ? "strike" : undefined}>
                  {formatInstant(share.expiresAt)}
                </span>
              )}
            </Field>
            <Field label="Setup">
              <span>
                {setupPlan.steps.length} steps
                <span className="dim"> · {setupPlan.status}</span>
              </span>
            </Field>
          </PassportRows>

          <PassportRule />

          <Field label="Caps">
            <ul className="cap-list" aria-label="Capability declarations in this share">
              {capabilities.map((capability) => (
                <li key={capability.id}>
                  <span>{capability.name}</span>
                  <span className="kind">{capability.kind}</span>
                </li>
              ))}
            </ul>
          </Field>

          <PassportFoot>
            {revoked ? (
              <span className="pp-revoked">
                revoked{" "}
                {share?.revokedAt === undefined ? null : (
                  <span className="dim">{formatInstant(share.revokedAt)}</span>
                )}
              </span>
            ) : published ? (
              <span className="mono">Shared · {destination}</span>
            ) : expired ? (
              <span className="mono">Expired · {destination}</span>
            ) : approved || confirmed ? (
              <span className="mono">Approved · not shared</span>
            ) : (
              <span className="mono dim">Not shared</span>
            )}
          </PassportFoot>
        </Passport>
        <figcaption id="share-caption">
          {revoked
            ? `Revoked. ${destination} can no longer read this Handoff.`
            : published
              ? `Everything ${destination} receives. Nothing else.`
              : `Exactly what ${proposedDestination} would receive. Credentials stay here.`}
        </figcaption>
      </figure>

      <aside className="share-rail" aria-label="Share decision">
        <section aria-labelledby="share-outbound">
          <h2 id="share-outbound">Sends</h2>
          <ul className="outbound">
            <li>
              <span className="what">Project</span>
              <span>
                {project.name} · {project.repository.owner}/{project.repository.name}
              </span>
            </li>
            <li>
              <span className="what">Handoff</span>
              <span>{handoff.goal}</span>
            </li>
            <li>
              <span className="what">Progress</span>
              <span>{handoff.progress.length} lines</span>
            </li>
            <li>
              <span className="what">Decisions</span>
              <span>{handoff.decisions.length}</span>
            </li>
            <li>
              <span className="what">Context</span>
              <span>{handoff.context.length} handles</span>
            </li>
            <li>
              <span className="what">Setup plan</span>
              <span>{setupPlan.steps.length} steps · no credentials</span>
            </li>
          </ul>
        </section>

        <section aria-labelledby="share-stays">
          <h2 id="share-stays">Stays here</h2>
          <ul className="stays" aria-label="Never included in the share">
            <li>
              <span>
                key · <Fingerprint value={identity.keyFingerprint} />
              </span>
              <span className="r">stays</span>
            </li>
            <li>
              <span>github · signed in here</span>
              <span className="r">stays</span>
            </li>
            <li>
              <span>codex · signed in here</span>
              <span className="r">stays</span>
            </li>
          </ul>
        </section>

        <section aria-labelledby="share-repo">
          <h2 id="share-repo">Repository</h2>
          <ul className="stays">
            <li>
              <span>captured @ {shortRevision(project.repository.revision)}</span>
              <span className="r">{formatInstant(handoff.provenance.capturedAt)}</span>
            </li>
            <li>
              <span>
                now {repository.branch} @ {shortRevision(repository.revision)}
              </span>
              <span className={stale ? "r is-caution" : "r"}>{stale ? "stale" : "current"}</span>
            </li>
          </ul>
          {stale ? (
            <p className="note caution">
              The repository moved after capture. Re-capture before sharing if the Handoff should
              match what is on disk.
            </p>
          ) : null}
        </section>

        <section aria-labelledby="share-act">
          <h2 id="share-act">Action</h2>
          {newVersion && published && handoff.status === "published" ? (
            <>
              <p className="lead">New Handoff approved</p>
              <p className="note">
                {destination} will read this Handoff through its current Connection. No new token is
                needed.
              </p>
              <div className="share-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await localApi(`/api/projects/${project.id}/publish`, "POST", { relayUrl });
                    })
                  }
                >
                  Send to {destination}
                </button>
              </div>
            </>
          ) : newVersion && handoff.status === "draft" ? (
            <>
              <p className="lead">New Handoff ready for review</p>
              <p className="note">
                {published
                  ? `After you approve and send it, ${destination} reads it through its current Connection.`
                  : "After you approve it, publishing creates a new share and Connection."}
              </p>
              <div className="share-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await localApi(`/api/projects/${project.id}/approve`, "POST");
                    })
                  }
                >
                  Approve Handoff
                </button>
              </div>
            </>
          ) : revoked && !approved ? (
            <>
              <p className="share-status is-revoked">Revoked</p>
              <p className="note">
                Publish a new share from a fresh capture if you need to continue.
              </p>
              <div className="share-actions">
                <Link className="btn" to="/">
                  Back to passport
                </Link>
              </div>
            </>
          ) : expired && !approved ? (
            <>
              <p className="share-status">Expired</p>
              <p className="note">This Connection can no longer read the Handoff.</p>
              <Link className="btn" to="/">
                Back to passport
              </Link>
            </>
          ) : published ? (
            <>
              <p className="share-status is-active">
                Shared with {destination}
                {shareEnds(share)}
              </p>
              <p className="note">
                The Connection token stays in the local Keychain until you reveal it.
              </p>
              {revealed === undefined ? null : (
                <>
                  <p className="note" role="status">
                    Connection URL: <code>{revealed.connectionUrl}</code>
                  </p>
                  {copiedToken ? (
                    <p className="note" role="status">
                      Bearer token copied. Paste it into Muse’s secure capture form, not chat.
                    </p>
                  ) : null}
                </>
              )}
              <div className="share-actions">
                {!fixture && share !== undefined ? (
                  <>
                    <button
                      className="btn"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const value = await localApi<{ connectionUrl: string; token: string }>(
                            `/api/connections/${share.connectionId}/reveal`,
                          );

                          setRevealed(value);
                          setCopiedToken(false);
                        }, false)
                      }
                    >
                      Reveal Connection URL
                    </button>
                    {revealed === undefined ? null : (
                      <button
                        className="btn"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await navigator.clipboard.writeText(revealed.token);
                            setCopiedToken(true);
                          }, false)
                        }
                      >
                        Copy bearer token
                      </button>
                    )}
                    <button
                      className="btn"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("Revoke this share and its Connection token?")) {
                          void run(async () => {
                            await localApi(`/api/projects/${project.id}/revoke`, "POST", {
                              reason: "Revoked from local dashboard",
                            });
                            setRevealed(undefined);
                            setCopiedToken(false);
                          });
                        }
                      }}
                    >
                      Revoke share
                    </button>
                  </>
                ) : null}
                <Link className="btn" to="/">
                  Back to passport
                </Link>
              </div>
            </>
          ) : approved || confirmed ? (
            <>
              <p className="share-status is-active">Approved</p>
              {fixture ? (
                <p className="note">Fixture only — no token was minted.</p>
              ) : (
                <form onSubmit={publish}>
                  <label htmlFor="relay-url">Relay URL</label>
                  <input
                    id="relay-url"
                    type="url"
                    required
                    value={relayUrl}
                    onChange={(event) => setRelayUrl(event.target.value)}
                    placeholder="https://relay.example"
                  />
                  <p className="note">
                    Publishing sends the previewed Handoff to this relay and creates a 24-hour
                    Connection.
                  </p>
                  <button className="btn btn-primary" type="submit" disabled={busy}>
                    Publish share
                  </button>
                </form>
              )}
            </>
          ) : (
            <>
              <p className="lead">
                Share with {proposedDestination}
                <span className="faint"> · {PROPOSED_HOURS}h</span>
              </p>
              <p className="note">
                Approval stays on this computer. Publishing later sends only the previewed scope;
                sign-ins and the private key remain here.
              </p>
              <div className="share-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (fixture) setConfirmed(true);
                    else
                      void run(async () => {
                        await localApi(`/api/projects/${project.id}/approve`, "POST");
                      });
                  }}
                >
                  Approve share
                </button>
                <Link className="btn" to="/">
                  Cancel
                </Link>
              </div>
            </>
          )}
          {error === undefined ? null : (
            <p className="note caution" role="alert">
              {error}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}

function shareEnds(share: Share | undefined): string {
  if (share === undefined) {
    return "";
  }

  return ` · expires ${formatInstant(share.expiresAt)}`;
}
