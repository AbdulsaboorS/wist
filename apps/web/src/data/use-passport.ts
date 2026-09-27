import { useEffect, useState } from "react";
import { useLocation } from "react-router";

import { loadFixtureState, scenarioFromSearch } from "./fixture-source";
import { getLaunchToken } from "./launch-token";
import type { LoadState, PassportSnapshot } from "./snapshot";

/* The dashboard data seam: fixtures in Vite development, authenticated daemon data in the build. */
export type PassportQuery = {
  readonly state: LoadState;
  readonly reload: () => void;
};

export function usePassport(): PassportQuery {
  const location = useLocation();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    // In development the scenario comes from `?scenario=`; a build only ever shows live state.
    const scenario = import.meta.env.DEV ? scenarioFromSearch(location.search) : "ready";
    const pending = import.meta.env.DEV ? loadFixtureState(scenario) : loadLiveState();

    void pending.then((next) => {
      if (!cancelled) {
        setState(next);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [location.search, attempt]);

  return { state, reload: () => setAttempt((count) => count + 1) };
}

export async function localApi<T>(
  path: string,
  method = "GET",
  body?: { relayUrl: string } | { reason: string } | { repositoryPath: string },
): Promise<T> {
  const token = getLaunchToken();

  if (token === undefined) throw new Error("Dashboard access expired. Reopen it from the CLI.");

  const headers = new Headers({ "X-Wist-Local-Token": token });
  const init: RequestInit = { method, headers };

  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(body);
  }

  const response = await fetch(path, init);

  // SAFETY: The loopback daemon owns this JSON contract; callers name the expected response type.
  const value = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    const message = value.error ?? `Local request failed (${response.status}).`;
    throw new Error(message);
  }

  return value;
}

async function loadLiveState(): Promise<LoadState> {
  if (getLaunchToken() === undefined) return { status: "unauthorized" };

  try {
    const value = await localApi<
      { status: "empty" } | { status: "ready"; snapshot: PassportSnapshot }
    >("/api/dashboard");

    if (value.status === "empty") return { status: "empty" };

    if (value.status === "ready") {
      return { status: "ready", snapshot: value.snapshot };
    }

    return { status: "error", message: "The local daemon returned an unknown dashboard state." };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "The local daemon did not answer.",
    };
  }
}
