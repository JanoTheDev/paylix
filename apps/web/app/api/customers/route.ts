import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { customers } from "@paylix/db/schema";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { requireActiveOrg, AuthError } from "@/lib/require-active-org";

const createSchema = z.object({
  firstName: z.string().trim().max(100).nullish(),
  lastName: z.string().trim().max(100).nullish(),
  email: z.string().trim().email().nullish(),
  walletAddress: z.string().trim().max(100).nullish(),
  country: z.string().trim().length(2).nullish(),
  taxId: z.string().trim().max(100).nullish(),
  metadata: z.record(z.string(), z.string()).optional().default({}),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  let organizationId: string;
  try {
    organizationId = requireActiveOrg(session);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  if (!data.firstName && !data.lastName && !data.email && !data.walletAddress) {
    return NextResponse.json(
      {
        error:
          "At least one of firstName, lastName, email, or walletAddress is required",
      },
      { status: 400 },
    );
  }

  const customerId = `manual_${randomBytes(6).toString("hex")}`;
  const [inserted] = await db
    .insert(customers)
    .values({
      organizationId,
      customerId,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      email: data.email ?? null,
      walletAddress: data.walletAddress ?? null,
      country: data.country ? data.country.toUpperCase() : null,
      taxId: data.taxId ?? null,
      source: "manual",
      metadata: data.metadata,
    })
    .returning();

  return NextResponse.json({ customer: inserted });
}
