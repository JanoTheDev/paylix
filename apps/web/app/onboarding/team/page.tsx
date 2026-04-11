"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { OnboardingStepper } from "@/components/onboarding-stepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/slug";

export default function CreateTeamPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await authClient.organization.create({
      name,
      slug: effectiveSlug,
    });
    if (res.error) {
      setError(res.error.message ?? "Could not create team");
      setSubmitting(false);
      return;
    }
    await authClient.organization.setActive({
      organizationId: res.data!.id,
    });
    router.push("/onboarding/profile");
  }

  return (
    <div className="space-y-8">
      <OnboardingStepper active="team" />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-100">
          Create your team
        </h1>
        <p className="text-sm text-slate-400">
          Your team is your company on Paylix — products, payments, and
          settings all live inside it.
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Team name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Acme Inc."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="slug">URL slug</Label>
          <Input
            id="slug"
            value={effectiveSlug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            required
            placeholder="acme"
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={submitting || !name}>
          {submitting ? "Creating…" : "Create team"}
        </Button>
      </form>
    </div>
  );
}
