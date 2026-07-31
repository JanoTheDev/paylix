"use client";

import { useSyncExternalStore } from "react";

export interface ServiceBalance {
  configured: boolean;
  low: boolean;
  balanceEth: string | null;
}

export interface SystemStatus {
  /** `null` while the first poll is still outstanding. */
  indexerOnline: boolean | null;
  relayer: ServiceBalance | null;
  keeper: ServiceBalance | null;
}

const POLL_INTERVAL_MS = 30_000;

const EMPTY: SystemStatus = {
  indexerOnline: null,
  relayer: null,
  keeper: null,
};

// Module-level singleton. `SidebarContent` is mounted twice on mobile-capable
// viewports — once by `Sidebar` and once by `MobileNav` -> `Sheet` — and each
// copy used to run its own 30s timer against three endpoints, i.e. six
// requests a minute per open tab for three booleans and two balance strings.
// Hoisting the poll here means one timer and one request set no matter how
// many consumers mount (UI-40).
let snapshot: SystemStatus = EMPTY;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

function sameBalance(a: ServiceBalance | null, b: ServiceBalance | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.configured === b.configured &&
    a.low === b.low &&
    a.balanceEth === b.balanceEth
  );
}

/**
 * Only swap the snapshot when something actually changed. `useSyncExternalStore`
 * compares snapshots by identity, so returning a fresh object every poll would
 * re-render every sidebar every 30 seconds for no reason.
 */
function publish(next: SystemStatus) {
  if (
    next.indexerOnline === snapshot.indexerOnline &&
    sameBalance(next.relayer, snapshot.relayer) &&
    sameBalance(next.keeper, snapshot.keeper)
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toBalance(data: Record<string, unknown> | null): ServiceBalance | null {
  if (!data) return null;
  return {
    configured: Boolean(data.configured),
    low: Boolean(data.low),
    balanceEth: (data.balanceEth as string | null | undefined) ?? null,
  };
}

async function refresh() {
  // A slow endpoint must not stack requests on top of each other.
  if (inFlight) return;
  inFlight = true;
  try {
    // TODO(api): collapse into a single `/api/system/status` once the route
    // exists — see audit/_requests-web-components.md. Only this function needs
    // to change; every consumer reads the same snapshot.
    const [indexer, relayer, keeper] = await Promise.all([
      getJson("/api/system/indexer-status"),
      getJson("/api/system/relayer-status"),
      getJson("/api/system/keeper-status"),
    ]);
    publish({
      indexerOnline: indexer ? Boolean(indexer.online) : snapshot.indexerOnline,
      relayer: toBalance(relayer) ?? snapshot.relayer,
      keeper: toBalance(keeper) ?? snapshot.keeper,
    });
  } finally {
    inFlight = false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refresh();
    timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => snapshot;
/** The server has no poll; render the pending state and let the client fill it in. */
const getServerSnapshot = () => EMPTY;

/**
 * Subscribes to the shared system-status poll. Mounting this hook any number
 * of times still yields exactly one timer; the timer stops when the last
 * consumer unmounts.
 */
export function useSystemStatus(): SystemStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
