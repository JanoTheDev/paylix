"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { OnboardingStepper } from "@/components/onboarding-stepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function makeRow(): { id: string; email: string } {
  return { id: crypto.randomUUID(), email: "" };
}

export default function InvitePage() {
  const router = useRouter();
  const [rows, setRows] = useState(() => [makeRow(), makeRow(), makeRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSubmitting(true);
    setError(null);
    const emails = rows.map((r) => r.email.trim()).filter(Boolean);
    const results = await Promise.all(
      emails.map((email) =>
        authClient.organization.inviteMember({ email, role: "member" }),
      ),
    );
    const failures = results
      .map((r, i) => ({ res: r, email: emails[i] }))
      .filter((x) => x.res.error);
    if (failures.length > 0) {
      setError(
        `Failed to invite ${failures.map((f) => f.email).join(", ")}: ${failures[0].res.error!.message}`,
      );
      setSubmitting(false);
      return;
    }
    router.push("/overview");
  }

  return (
    <div className="space-y-8">
      <OnboardingStepper active="invite" />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">
          Invite your team
        </h1>
        <p className="text-sm text-foreground-muted">
          Invited teammates get full access to the team except removing members
          or deleting it.
        </p>
      </div>
      <div className="space-y-3">
        {rows.map((row) => (
          <Input
            key={row.id}
            type="email"
            value={row.email}
            onChange={(e) => {
              const next = rows.map((r) =>
                r.id === row.id ? { ...r, email: e.target.value } : r,
              );
              setRows(next);
            }}
            placeholder="teammate@example.com"
          />
        ))}
        <button
          type="button"
          onClick={() => setRows([...rows, makeRow()])}
          className="text-sm text-foreground-muted hover:text-foreground"
        >
          + Add another
        </button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={submitting}>
          {submitting ? "Sending…" : "Send invites"}
        </Button>
        <button
          type="button"
          className="text-sm text-foreground-muted hover:text-foreground"
          onClick={() => router.push("/overview")}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
