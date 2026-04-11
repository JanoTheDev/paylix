"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingStepper } from "@/components/onboarding-stepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ProfilePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    legalName: "",
    supportEmail: "",
    country: "",
    addressLine1: "",
    city: "",
    postalCode: "",
    taxId: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessProfile: form }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Failed to save profile");
      setSubmitting(false);
      return;
    }
    router.push("/onboarding/wallet");
  }

  return (
    <div className="space-y-8">
      <OnboardingStepper active="profile" />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-100">
          Company profile
        </h1>
        <p className="text-sm text-slate-400">
          Shown on invoices and receipts. You can change all of this later in
          Settings.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="legalName">Legal name</Label>
          <Input id="legalName" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="supportEmail">Support email</Label>
          <Input id="supportEmail" type="email" value={form.supportEmail} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="country">Country (ISO-2)</Label>
          <Input id="country" maxLength={2} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="addressLine1">Address</Label>
          <Input id="addressLine1" value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="city">City</Label>
            <Input id="city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="postalCode">Postal code</Label>
            <Input id="postalCode" value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="taxId">Tax ID (optional)</Label>
          <Input id="taxId" value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Continue"}
          </Button>
          <button
            type="button"
            className="text-sm text-slate-400 hover:text-slate-200"
            onClick={() => router.push("/onboarding/wallet")}
          >
            Skip for now
          </button>
        </div>
      </form>
    </div>
  );
}
