import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { products } from "@paykit/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const createProductSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  type: z.enum(["one_time", "subscription"]),
  price: z.number().int().positive(),
  interval: z.enum(["monthly", "yearly"]).optional(),
  metadata: z.record(z.string()).optional(),
  checkoutFields: z
    .object({
      firstName: z.boolean().optional(),
      lastName: z.boolean().optional(),
      email: z.boolean().optional(),
      phone: z.boolean().optional(),
    })
    .optional(),
});

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(products)
    .where(eq(products.userId, session.user.id))
    .orderBy(products.createdAt);

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  const [product] = await db
    .insert(products)
    .values({
      userId: session.user.id,
      name: data.name,
      description: data.description ?? null,
      type: data.type,
      price: data.price,
      interval: data.type === "subscription" ? (data.interval ?? null) : null,
      metadata: data.metadata ?? {},
      checkoutFields: data.checkoutFields ?? {},
    })
    .returning();

  return NextResponse.json(product, { status: 201 });
}
