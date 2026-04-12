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
  const [walletSuccess, setWalletSuccess] = useState(false);
  const [walletError, setWalletError] = useState("");

  const [defaultsSaving, setDefaultsSaving] = useState(false);
  const [defaultsSuccess, setDefaultsSuccess] = useState(false);

  const [networks, setNetworks] = useState<NetworkConfigUI[]>([]);
  const [networksSaving, setNetworksSaving] = useState(false);
  const [networksSuccess, setNetworksSuccess] = useState(false);

  const [profile, setProfile] = useState<BusinessProfile | null>(null);

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [notificationsSaving, setNotificationsSaving] = useState(false);
  const [notificationsSuccess, setNotificationsSuccess] = useState(false);

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

  async function saveMasterNotifications(next: boolean) {
    setNotificationsSaving(true);
    setNotificationsSuccess(false);
    const previous = notificationsEnabled;
    setNotificationsEnabled(next);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationsEnabled: next }),
      });
      if (res.ok) {
        setNotificationsSuccess(true);
        setTimeout(() => setNotificationsSuccess(false), 2000);
      } else {
        setNotificationsEnabled(previous);
      }
    } catch {
      setNotificationsEnabled(previous);
    } finally {
      setNotificationsSaving(false);
    }
  }

  async function savePreference(kind: NotificationKind, next: boolean) {
    setNotificationsSaving(true);
    setNotificationsSuccess(false);
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
        setNotificationsSuccess(true);
        setTimeout(() => setNotificationsSuccess(false), 2000);
      } else {
        setNotificationPreferences(previous);
      }
    } catch {
      setNotificationPreferences(previous);
    } finally {
      setNotificationsSaving(false);
    }
  }

  async function setAllPreferences(next: boolean) {
    setNotificationsSaving(true);
    setNotificationsSuccess(false);
    const previous = notificationPreferences;
    const optimistic: NotificationPreferences = { ...previous };
    for (const k of NOTIFICATION_KINDS) optimistic[k] = next;
    setNotificationPreferences(optimistic);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationPreferences: optimistic }),
      });
      if (res.ok) {
        setNotificationsSuccess(true);
        setTimeout(() => setNotificationsSuccess(false), 2000);
      } else {
        setNotificationPreferences(previous);
      }
    } catch {
      setNotificationPreferences(previous);
    } finally {
      setNotificationsSaving(false);
    }
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

        {/* Notifications tab */}
        <TabsContent value="notifications" className="space-y-6">
          <FormSection
            title="Automatic Email Notifications"
            description="Paylix sends transactional emails to your customers — invoices, trial reminders, subscription updates, receipts, and past-due alerts. Disable any of them if you'd rather send your own custom emails from webhook events."
          >
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface-1 p-4">
              <div className="pr-4">
                <div className="text-sm font-medium">
                  Master switch — send any emails at all
                </div>
                <div className="mt-1 text-xs leading-relaxed text-foreground-muted">
                  When off, Paylix stops sending every email below regardless
                  of the individual toggles. Webhook events still fire so you
                  can trigger your own templated emails on your side.
                </div>
              </div>
              <Switch
                checked={notificationsEnabled}
                disabled={notificationsSaving}
                onCheckedChange={saveMasterNotifications}
              />
            </div>

            {!notificationsEnabled && (
              <Alert>
                <AlertDescription>
                  Master switch is off. No emails will be sent until it&apos;s
                  turned back on. Subscribe to{" "}
                  <code className="font-mono text-[12px]">invoice.issued</code>,{" "}
                  <code className="font-mono text-[12px]">
                    subscription.created
                  </code>
                  ,{" "}
                  <code className="font-mono text-[12px]">
                    subscription.charged
                  </code>
                  , and{" "}
                  <code className="font-mono text-[12px]">
                    subscription.past_due
                  </code>{" "}
                  webhooks to send your own.
                </AlertDescription>
              </Alert>
            )}
          </FormSection>

          <FormSection
            title="Individual Email Types"
            description="Turn off specific email types while keeping others on — for example, you might send your own custom welcome email but still let Paylix send receipts."
          >
            <div className="flex items-center justify-end gap-2 pb-1">
              <span className="text-xs text-foreground-muted">Quick:</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={notificationsSaving}
                onClick={() => setAllPreferences(true)}
              >
                Enable all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={notificationsSaving}
                onClick={() => setAllPreferences(false)}
              >
                Disable all
              </Button>
            </div>
            <div className="flex flex-col gap-3">
              {NOTIFICATION_KINDS.map((kind) => {
                const meta = NOTIFICATION_LABELS[kind];
                const checked = notificationPreferences[kind];
                const effective = notificationsEnabled && checked;
                return (
                  <div
                    key={kind}
                    className="flex items-start justify-between gap-4 rounded-lg border border-border bg-surface-1 p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {meta.label}
                        </span>
                        {!notificationsEnabled && checked && (
                          <Badge variant="outline" className="text-[10px]">
                            Blocked by master
                          </Badge>
                        )}
                        {!effective && notificationsEnabled && (
                          <Badge variant="outline" className="text-[10px]">
                            Off
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-xs leading-relaxed text-foreground-muted">
                        {meta.description}
                      </div>
                    </div>
                    <Switch
                      checked={checked}
                      disabled={notificationsSaving}
                      onCheckedChange={(val) => savePreference(kind, val)}
                    />
                  </div>
                );
              })}
            </div>
            {notificationsSuccess && (
              <span className="text-sm font-medium text-success">Saved</span>
            )}
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
