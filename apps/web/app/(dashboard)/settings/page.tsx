"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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
import {
  NOTIFICATION_KINDS,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationKind,
  type NotificationPreferences,
} from "@paylix/db/schema";

const NOTIFICATION_LABELS: Record<
  NotificationKind,
  { label: string; description: string }
> = {
  invoice: {
    label: "Invoice receipts",
    description: "Sent after every confirmed payment — one-time and subscription charges.",
  },
  trialStarted: {
    label: "Trial started",
    description: "Sent when a customer starts a free trial.",
  },
  trialEndingSoon: {
    label: "Trial ending soon",
    description: "Sent a few days before a trial converts to a paid subscription.",
  },
  trialFailed: {
    label: "Trial conversion failed",
    description: "Sent when we can't charge the first payment after a trial ends.",
  },
  subscriptionCreated: {
    label: "Subscription activated",
    description: "Sent when a subscription successfully starts.",
  },
  subscriptionCancelled: {
    label: "Subscription cancelled",
    description: "Sent when a subscription is cancelled by either party.",
  },
  paymentReceipt: {
    label: "Recurring charge receipt",
    description: "Sent after each successful subscription renewal charge.",
  },
  pastDue: {
    label: "Past-due reminder",
    description: "Sent when a recurring charge fails and the subscription needs attention.",
  },
};

interface UserSettings {
  id: string;
  name: string;
  email: string;
  walletAddress: string | null;
  livemode?: boolean;
  businessProfile?: BusinessProfile;
  notificationsEnabled?: boolean;
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
  const [walletError, setWalletError] = useState("");

  const [defaultsSaving, setDefaultsSaving] = useState(false);

  const [networks, setNetworks] = useState<NetworkConfigUI[]>([]);
  const [networksSaving, setNetworksSaving] = useState(false);

  const [profile, setProfile] = useState<BusinessProfile | null>(null);

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [notificationsSaving, setNotificationsSaving] = useState(false);

  const [isMainnet, setIsMainnet] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        setWalletAddress(data.walletAddress || "");
        if (typeof data.livemode === "boolean") {
          setIsMainnet(data.livemode);
        }
        if (data.checkoutFieldDefaults) {
          setCheckoutDefaults(data.checkoutFieldDefaults);
        }
        if (Array.isArray(data.networks)) {
          setNetworks(data.networks);
        }
        if (data.businessProfile) setProfile(data.businessProfile);
        if (typeof data.notificationsEnabled === "boolean") {
          setNotificationsEnabled(data.notificationsEnabled);
        }
        if (data.notificationPreferences) {
          setNotificationPreferences({
            ...DEFAULT_NOTIFICATION_PREFERENCES,
            ...data.notificationPreferences,
          });
        }
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
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress }),
      });
      if (!res.ok) {
        const data = await res.json();
        const message =
          data.error?.message ?? data.error ?? "Failed to save wallet";
        setWalletError(message);
        toast.error(message);
      } else {
        toast.success("Payout wallet saved");
      }
    } catch {
      setWalletError("Failed to save");
      toast.error("Failed to save wallet");
    } finally {
      setWalletSaving(false);
    }
  }

  async function saveCheckoutDefaults() {
    setDefaultsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkoutFieldDefaults: checkoutDefaults }),
      });
      if (res.ok) {
        toast.success("Checkout defaults saved");
      } else {
        toast.error("Failed to save checkout defaults");
      }
    } catch {
      toast.error("Failed to save checkout defaults");
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

  async function saveMasterNotifications(next: boolean) {
    setNotificationsSaving(true);
    const previous = notificationsEnabled;
    setNotificationsEnabled(next);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationsEnabled: next }),
      });
      if (res.ok) {
        toast.success(
          next
            ? "Email notifications turned on"
            : "Email notifications turned off",
        );
      } else {
        setNotificationsEnabled(previous);
        toast.error("Failed to save notification settings");
      }
    } catch {
      setNotificationsEnabled(previous);
      toast.error("Failed to save notification settings");
    } finally {
      setNotificationsSaving(false);
    }
  }

  async function savePreference(kind: NotificationKind, next: boolean) {
    setNotificationsSaving(true);
    const previous = notificationPreferences;
    const optimistic = { ...previous, [kind]: next };
    setNotificationPreferences(optimistic);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationPreferences: { [kind]: next },
        }),
      });
      if (res.ok) {
        toast.success("Notification settings saved");
      } else {
        setNotificationPreferences(previous);
        toast.error("Failed to save notification settings");
      }
    } catch {
      setNotificationPreferences(previous);
      toast.error("Failed to save notification settings");
    } finally {
      setNotificationsSaving(false);
    }
  }

  async function saveNetworks() {
    setNetworksSaving(true);
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
        toast.success("Networks saved");
      } else {
        toast.error("Failed to save networks");
      }
    } catch {
      toast.error("Failed to save networks");
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
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
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

        {/* Notifications tab */}
        <TabsContent value="notifications">
          <FormSection
            title="Automatic Email Notifications"
            description="Paylix sends transactional emails to your customers — invoices, trial reminders, subscription updates, receipts, and past-due alerts. Use the master switch to turn everything off at once, or toggle individual email types below. Webhook events always fire regardless, so you can trigger your own templated emails from them."
          >
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2 p-4">
              <div className="pr-4">
                <div className="text-sm font-medium">
                  Send automatic emails
                </div>
                <div className="mt-1 text-xs leading-relaxed text-foreground-muted">
                  Master switch — when off, every email below is blocked
                  regardless of its individual toggle.
                </div>
              </div>
              <Switch
                checked={notificationsEnabled}
                disabled={notificationsSaving}
                onCheckedChange={saveMasterNotifications}
              />
            </div>

            <div className="flex flex-col gap-2">
              {NOTIFICATION_KINDS.map((kind) => {
                const meta = NOTIFICATION_LABELS[kind];
                const checked = notificationPreferences[kind];
                const blocked = !notificationsEnabled;
                return (
                  <div
                    key={kind}
                    className={`flex items-start justify-between gap-4 rounded-lg border border-border bg-surface-1 p-4 transition-opacity ${
                      blocked ? "opacity-50" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{meta.label}</div>
                      <div className="mt-1 text-xs leading-relaxed text-foreground-muted">
                        {meta.description}
                      </div>
                    </div>
                    <Switch
                      checked={checked}
                      disabled={notificationsSaving || blocked}
                      onCheckedChange={(val) => savePreference(kind, val)}
                    />
                  </div>
                );
              })}
            </div>
          </FormSection>
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
