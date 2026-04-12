"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PageShell,
  PageHeader,
  FormSection,
  FormRow,
  FormActions,
} from "@/components/paykit";
import {
  BusinessProfileSection,
  type BusinessProfile,
} from "@/components/settings/business-profile-section";
import { TeamTabContent } from "@/components/settings/team-tab-content";

interface UserSettings {
  id: string;
  name: string;
  email: string;
  walletAddress: string | null;
  businessProfile?: BusinessProfile;
}

interface NetworkConfigUI {
  networkKey: string;
  chainName: string;
  displayLabel: string;
  enabled: boolean;
  usesDefault: boolean;
  overrideAddress: string | null;
}

interface CheckoutDefaults {
  firstName: boolean;
  lastName: boolean;
  email: boolean;
  phone: boolean;
}

const CHECKOUT_FIELDS: { key: keyof CheckoutDefaults; label: string }[] = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
];

export default function SettingsPage() {
  const [user, setUser] = useState<UserSettings | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [checkoutDefaults, setCheckoutDefaults] = useState<CheckoutDefaults>({
    firstName: true,
    lastName: true,
    email: true,
    phone: false,
  });

  const [walletSaving, setWalletSaving] = useState(false);
  const [walletSuccess, setWalletSuccess] = useState(false);
  const [walletError, setWalletError] = useState("");

  const [defaultsSaving, setDefaultsSaving] = useState(false);
  const [defaultsSuccess, setDefaultsSuccess] = useState(false);

  const [networks, setNetworks] = useState<NetworkConfigUI[]>([]);
  const [networksSaving, setNetworksSaving] = useState(false);
  const [networksSuccess, setNetworksSuccess] = useState(false);

  const [profile, setProfile] = useState<BusinessProfile | null>(null);

  const network = process.env.NEXT_PUBLIC_NETWORK || "base-sepolia";
  const isMainnet = network === "base";

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        setWalletAddress(data.walletAddress || "");
        if (data.checkoutFieldDefaults) {
          setCheckoutDefaults(data.checkoutFieldDefaults);
        }
        if (Array.isArray(data.networks)) {
          setNetworks(data.networks);
        }
        if (data.businessProfile) setProfile(data.businessProfile);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveWallet() {
    setWalletSaving(true);
    setWalletError("");
    setWalletSuccess(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress }),
      });
      if (!res.ok) {
        const data = await res.json();
        setWalletError(data.error?.message ?? data.error ?? "Failed to save");
      } else {
        setWalletSuccess(true);
        setTimeout(() => setWalletSuccess(false), 2000);
      }
    } catch {
      setWalletError("Failed to save");
    } finally {
      setWalletSaving(false);
    }
  }

  async function saveCheckoutDefaults() {
    setDefaultsSaving(true);
    setDefaultsSuccess(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkoutFieldDefaults: checkoutDefaults }),
      });
      if (res.ok) {
        setDefaultsSuccess(true);
        setTimeout(() => setDefaultsSuccess(false), 2000);
      }
    } catch {
      // ignore
    } finally {
      setDefaultsSaving(false);
    }
  }

  function toggleNetwork(key: string) {
    setNetworks((prev) =>
      prev.map((n) =>
        n.networkKey === key ? { ...n, enabled: !n.enabled } : n,
      ),
    );
  }

  function setNetworkMode(key: string, mode: "default" | "override") {
    setNetworks((prev) =>
      prev.map((n) =>
        n.networkKey === key
          ? {
              ...n,
              usesDefault: mode === "default",
              overrideAddress:
                mode === "default" ? null : n.overrideAddress ?? "",
            }
          : n,
      ),
    );
  }

  function updateOverride(key: string, addr: string) {
    setNetworks((prev) =>
      prev.map((n) =>
        n.networkKey === key ? { ...n, overrideAddress: addr } : n,
      ),
    );
  }

  async function saveNetworks() {
    setNetworksSaving(true);
    setNetworksSuccess(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          networks: networks.map((n) => ({
            networkKey: n.networkKey,
            enabled: n.enabled,
            overrideAddress: n.usesDefault ? null : n.overrideAddress,
          })),
        }),
      });
      if (res.ok) {
        setNetworksSuccess(true);
        setTimeout(() => setNetworksSuccess(false), 2000);
      }
    } finally {
      setNetworksSaving(false);
    }
  }

  if (!user) {
    return (
      <PageShell>
        <PageHeader title="Settings" description="Manage your organization." />
        <p className="text-sm text-foreground-muted">Loading…</p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader title="Settings" description="Manage your organization." />

      <Tabs defaultValue="payments" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="business">Business Profile</TabsTrigger>
          <TabsTrigger value="checkout">Checkout Defaults</TabsTrigger>
        </TabsList>

        {/* Payments tab: wallet + networks */}
        <TabsContent value="payments" className="space-y-6">
          <FormSection
            title="Payout Wallet"
            description="Successful checkouts deposit USDC into this wallet."
          >
            <div className="flex items-center gap-2 pb-2">
              <Badge variant={isMainnet ? "success" : "info"}>
                {isMainnet ? "Mainnet" : "Testnet"}
              </Badge>
              <span className="text-xs text-foreground-muted">
                {isMainnet ? "Base (Mainnet)" : "Base Sepolia (Testnet)"}
              </span>
            </div>
            <FormRow label="Wallet address" htmlFor="wallet-address">
              <Input
                id="wallet-address"
                type="text"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                placeholder="0x…"
                className="font-mono"
              />
            </FormRow>
            {walletError && (
              <Alert variant="destructive">
                <AlertDescription>{walletError}</AlertDescription>
              </Alert>
            )}
            <FormActions>
              {walletSuccess && (
                <span className="text-sm font-medium text-success">Saved</span>
              )}
              <Button onClick={saveWallet} disabled={walletSaving}>
                {walletSaving ? "Saving…" : "Save"}
              </Button>
            </FormActions>
          </FormSection>

          <FormSection
            title="Networks"
            description="Choose which blockchains to accept payments on. Override the wallet per-network if needed."
          >
            <div className="flex flex-col gap-3">
              {networks.map((n) => (
                <div
                  key={n.networkKey}
                  className="rounded-lg border border-border bg-surface-1 p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{n.displayLabel}</div>
                      <div className="text-xs text-foreground-muted">
                        {n.chainName}
                      </div>
                    </div>
                    <Switch
                      checked={n.enabled}
                      onCheckedChange={() => toggleNetwork(n.networkKey)}
                    />
                  </div>

                  {n.enabled && (
                    <div className="mt-3 flex flex-col gap-2">
                      <div className="flex gap-4 text-xs">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            checked={n.usesDefault}
                            onChange={() =>
                              setNetworkMode(n.networkKey, "default")
                            }
                          />
                          Use default wallet
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            checked={!n.usesDefault}
                            onChange={() =>
                              setNetworkMode(n.networkKey, "override")
                            }
                          />
                          Override
                        </label>
                      </div>
                      {!n.usesDefault && (
                        <Input
                          type="text"
                          placeholder="0x..."
                          value={n.overrideAddress ?? ""}
                          onChange={(e) =>
                            updateOverride(n.networkKey, e.target.value)
                          }
                          className="font-mono text-xs"
                        />
                      )}
                    </div>
                  )}
                </div>
              ))}

              {networks.every((n) => !n.enabled) && (
                <Alert variant="destructive">
                  <AlertDescription>
                    No networks enabled. Enable at least one to create products.
                  </AlertDescription>
                </Alert>
              )}
            </div>
            <FormActions>
              {networksSuccess && (
                <span className="text-sm font-medium text-success">Saved</span>
              )}
              <Button onClick={saveNetworks} disabled={networksSaving}>
                {networksSaving ? "Saving…" : "Save"}
              </Button>
            </FormActions>
          </FormSection>
        </TabsContent>

        {/* Team tab */}
        <TabsContent value="team">
          <TeamTabContent />
        </TabsContent>

        {/* Business Profile tab */}
        <TabsContent value="business">
          {profile ? (
            <BusinessProfileSection initial={profile} />
          ) : (
            <p className="text-sm text-foreground-muted">Loading…</p>
          )}
        </TabsContent>

        {/* Checkout Defaults tab */}
        <TabsContent value="checkout">
          <FormSection
            title="Default Checkout Fields"
            description="These fields will be enabled by default on new products."
          >
            <div className="flex flex-col gap-3">
              {CHECKOUT_FIELDS.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm">{label}</span>
                  <Switch
                    checked={checkoutDefaults[key]}
                    onCheckedChange={(val) =>
                      setCheckoutDefaults((prev) => ({ ...prev, [key]: val }))
                    }
                  />
                </div>
              ))}
            </div>
            <FormActions>
              {defaultsSuccess && (
                <span className="text-sm font-medium text-success">Saved</span>
              )}
              <Button onClick={saveCheckoutDefaults} disabled={defaultsSaving}>
                {defaultsSaving ? "Saving…" : "Save"}
              </Button>
            </FormActions>
          </FormSection>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
