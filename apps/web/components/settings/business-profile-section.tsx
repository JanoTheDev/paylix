"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormSection, FormRow, FormActions } from "@/components/paykit";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface BusinessProfile {
  legalName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  postalCode: string;
  country: string;
  taxId: string | null;
  supportEmail: string;
  logoUrl: string | null;
  invoicePrefix: string;
  invoiceFooter: string | null;
}

interface Props {
  initial: BusinessProfile;
}

export function BusinessProfileSection({ initial }: Props) {
  const [profile, setProfile] = useState<BusinessProfile>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");
  const [uploading, setUploading] = useState(false);

  function update<K extends keyof BusinessProfile>(
    key: K,
    value: BusinessProfile[K],
  ) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessProfile: profile }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message = data.error ?? "Failed to save business profile";
        setError(message);
        toast.error(message);
      } else {
        toast.success("Business profile saved");
      }
    } catch {
      setError("Failed to save");
      toast.error("Failed to save business profile");
    } finally {
      setSaving(false);
    }
  }

  async function onLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/logo", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message = data.error ?? "Logo upload failed";
        setError(message);
        toast.error(message);
      } else {
        const data = await res.json();
        update("logoUrl", data.url);
        toast.success("Logo uploaded");
      }
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <FormSection
      title="Business Profile"
      description="Appears on every invoice sent to your customers. Keep this accurate — invoices are legal documents and these fields cannot be edited once issued."
    >
      <FormRow label="Legal business name" htmlFor="bp-legal">
        <Input
          id="bp-legal"
          value={profile.legalName}
          onChange={(e) => update("legalName", e.target.value)}
        />
      </FormRow>
      <FormRow label="Address line 1" htmlFor="bp-addr1">
        <Input
          id="bp-addr1"
          value={profile.addressLine1}
          onChange={(e) => update("addressLine1", e.target.value)}
        />
      </FormRow>
      <FormRow label="Address line 2" htmlFor="bp-addr2">
        <Input
          id="bp-addr2"
          value={profile.addressLine2 ?? ""}
          onChange={(e) => update("addressLine2", e.target.value || null)}
        />
      </FormRow>
      <FormRow label="City" htmlFor="bp-city">
        <Input
          id="bp-city"
          value={profile.city}
          onChange={(e) => update("city", e.target.value)}
        />
      </FormRow>
      <FormRow label="Postal code" htmlFor="bp-zip">
        <Input
          id="bp-zip"
          value={profile.postalCode}
          onChange={(e) => update("postalCode", e.target.value)}
        />
      </FormRow>
      <FormRow label="Country (ISO code)" htmlFor="bp-country">
        <Input
          id="bp-country"
          placeholder="GB"
          maxLength={2}
          value={profile.country}
          onChange={(e) => update("country", e.target.value.toUpperCase())}
        />
      </FormRow>
      <FormRow label="Tax / VAT ID" htmlFor="bp-tax">
        <Input
          id="bp-tax"
          value={profile.taxId ?? ""}
          onChange={(e) => update("taxId", e.target.value || null)}
        />
      </FormRow>
      <FormRow label="Support email" htmlFor="bp-support">
        <Input
          id="bp-support"
          type="email"
          value={profile.supportEmail}
          onChange={(e) => update("supportEmail", e.target.value)}
        />
      </FormRow>
      <FormRow label="Logo" htmlFor="bp-logo">
        <div className="flex flex-col gap-2">
          {profile.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.logoUrl}
              alt="Logo preview"
              className="h-16 w-auto rounded border border-border bg-surface-1 object-contain p-1"
            />
          )}
          <Input
            id="bp-logo"
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            onChange={onLogoChange}
            disabled={uploading}
          />
          <p className="text-[11px] leading-relaxed text-foreground-muted">
            PNG, JPG, SVG, or WebP. Max 512KB.
          </p>
        </div>
      </FormRow>
      <FormRow label="Invoice number prefix" htmlFor="bp-prefix">
        <Input
          id="bp-prefix"
          value={profile.invoicePrefix}
          onChange={(e) => update("invoicePrefix", e.target.value)}
        />
      </FormRow>
      <FormRow label="Invoice footer (optional)" htmlFor="bp-footer">
        <Input
          id="bp-footer"
          value={profile.invoiceFooter ?? ""}
          onChange={(e) => update("invoiceFooter", e.target.value || null)}
        />
      </FormRow>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FormActions>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </FormActions>
    </FormSection>
  );
}
