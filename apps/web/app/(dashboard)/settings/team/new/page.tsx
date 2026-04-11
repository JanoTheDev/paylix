"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export default function NewTeamPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await authClient.organization.create({ name, slug: slugify(name) });
    if (res.error) {
      setError(res.error.message ?? "Error");
      setSubmitting(false);
      return;
    }
    await authClient.organization.setActive({ organizationId: res.data!.id });
    router.push("/overview");
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Create another team</h1>
      <div className="space-y-1.5">
        <Label htmlFor="name">Team name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create"}</Button>
    </form>
  );
}
