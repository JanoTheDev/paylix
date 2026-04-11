"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FormRow, FormActions } from "@/components/paykit";

export function TeamQuickInvite() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    const res = await authClient.organization.inviteMember({
      email,
      role: "member",
    });
    if (res.error) {
      setError(res.error.message ?? "Failed to send invite");
      setSubmitting(false);
      return;
    }
    setEmail("");
    setSuccess(true);
    setSubmitting(false);
    setTimeout(() => setSuccess(false), 3000);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <FormRow label="Email" htmlFor="team-invite-email">
        <div className="flex gap-2">
          <Input
            id="team-invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            required
          />
          <Button type="submit" disabled={submitting}>
            {submitting ? "Sending…" : "Send invite"}
          </Button>
        </div>
      </FormRow>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FormActions>
        {success && (
          <span className="text-sm font-medium text-success">Invite sent</span>
        )}
        <Link
          href="/settings/team"
          className="text-sm text-foreground-muted hover:text-foreground"
        >
          Manage team →
        </Link>
      </FormActions>
    </form>
  );
}
