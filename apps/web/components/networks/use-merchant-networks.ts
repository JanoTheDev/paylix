"use client";

import { useEffect, useMemo, useState } from "react";
import type { TokenConfig } from "@paylix/config/networks";

/** The slice of `GET /api/settings` the product/onboarding forms consume. */
export interface MerchantSettings {
  checkoutFieldDefaults?: {
    firstName?: boolean;
    lastName?: boolean;
    email?: boolean;
    phone?: boolean;
  };
  networks?: Array<{
    networkKey: string;
    chainName: string;
    displayLabel: string;
    enabled: boolean;
  }>;
}

export interface EnabledNetworkToken {
  symbol: string;
  name: string;
  bridged: boolean;
  /** False when the token has no gasless path for this payment type. */
  usable: boolean;
}

export interface EnabledNetwork {
  networkKey: string;
  chainName: string;
  displayLabel: string;
  tokens: EnabledNetworkToken[];
}

export type PaymentType = "one_time" | "subscription";

export interface MerchantNetworksState {
  /**
   * Raw settings payload. Referentially stable once loaded — the fetch runs
   * exactly once per mount, so callers may safely depend on it in an effect.
   */
  settings: MerchantSettings | undefined;
  networks: EnabledNetwork[];
  loading: boolean;
  /** Non-empty when the fetch failed or a network key could not be resolved. */
  error: string;
}

/** What the one-shot load resolves to, before `paymentType` is applied. */
interface Registry {
  networks: Array<{
    networkKey: string;
    chainName: string;
    displayLabel: string;
    tokens: TokenConfig[];
  }>;
  isTokenUsable: (token: TokenConfig, paymentType: PaymentType) => boolean;
}

/**
 * Loads the merchant's settings once and derives the enabled-network/token
 * matrix from that single response.
 *
 * `paymentType` deliberately does NOT trigger a refetch. It only decides which
 * tokens are marked `usable`, which is a pure mapping and therefore derived in
 * a `useMemo`. Refetching on every one-time/subscription flip would defeat the
 * point of UI-23 *and* hand callers a brand-new `settings` object on each flip,
 * which silently re-ran their "apply account defaults" effects and clobbered
 * whatever the merchant had toggled.
 *
 * Both `ProductForm` and `OnboardingWizard` need this and had drifted apart:
 * one swallowed fetch errors, the other had none at all, and both indexed
 * `NETWORKS[key]` unguarded so an unrecognised key from the API threw inside
 * a promise chain and left the selector silently empty forever.
 *
 * DAI-permit is gated from subscription products here — the contract and the
 * relay reject it further down the stack, but the UI should never show an
 * option that would 400 at submit time.
 */
export function useMerchantNetworks(
  paymentType: PaymentType,
): MerchantNetworksState {
  const [settings, setSettings] = useState<MerchantSettings | undefined>(
    undefined,
  );
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError("");
      let data: MerchantSettings;
      try {
        const res = await fetch("/api/settings", { signal: controller.signal });
        if (!res.ok) throw new Error(`Settings request failed (${res.status})`);
        data = (await res.json()) as MerchantSettings;
      } catch (err) {
        if (cancelled) return;
        setLoading(false);
        setError(
          err instanceof Error
            ? `Couldn't load your settings: ${err.message}`
            : "Couldn't load your settings.",
        );
        return;
      }
      if (cancelled) return;
      setSettings(data);

      const { NETWORKS, isTokenUsable } = await import(
        "@paylix/config/networks"
      );
      if (cancelled) return;

      const unknownKeys: string[] = [];
      const resolved: Registry["networks"] = [];
      for (const n of data.networks ?? []) {
        if (!n.enabled) continue;
        const network = NETWORKS[n.networkKey as keyof typeof NETWORKS];
        if (!network) {
          unknownKeys.push(n.networkKey);
          continue;
        }
        resolved.push({
          networkKey: n.networkKey,
          chainName: n.chainName,
          displayLabel: n.displayLabel,
          tokens: Object.values(network.tokens),
        });
      }

      setRegistry({ networks: resolved, isTokenUsable });
      setLoading(false);
      if (unknownKeys.length > 0) {
        setError(
          `Skipped unrecognised network${unknownKeys.length > 1 ? "s" : ""}: ${unknownKeys.join(", ")}.`,
        );
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const networks = useMemo<EnabledNetwork[]>(() => {
    if (!registry) return [];
    return registry.networks.map((n) => ({
      networkKey: n.networkKey,
      chainName: n.chainName,
      displayLabel: n.displayLabel,
      tokens: n.tokens.map((t) => ({
        symbol: t.symbol,
        name: t.name,
        bridged: Boolean(t.bridged),
        usable: registry.isTokenUsable(t, paymentType),
      })),
    }));
  }, [registry, paymentType]);

  return { settings, networks, loading, error };
}
