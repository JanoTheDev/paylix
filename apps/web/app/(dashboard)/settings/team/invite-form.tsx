"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await authClient.organization.inviteMember({
      email,
      role: "member",
    });
    if (res.error) {
      setError(res.error.message ?? "Failed");
      setSubmitting(false);
      return;
    }
    setEmail("");
    setSubmitting(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2">
      <div className="flex-1">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@example.com"
          required
        />
      </div>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Sending…" : "Send invite"}
      </Button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
