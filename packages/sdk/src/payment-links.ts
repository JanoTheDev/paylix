import { request } from "./request";
import type { PaylixConfig } from "./types";

export interface CreatePaymentLinkParams {
  productId: string;
  /** Internal label shown in the dashboard; not visible to buyers. */
  name: string;
  /** Pre-associate the link with one of your customers. */
  customerId?: string;
  /** Pre-lock the link to a network. Omit to let the buyer choose. */
  networkKey?: string;
  /** Pre-lock the link to a token. Omit to let the buyer choose. */
  tokenSymbol?: string;
  /** Stop accepting payments after this many completions. */
  maxRedemptions?: number;
  metadata?: Record<string, string>;
}

export interface PaymentLink {
  id: string;
  productId: string;
  name: string;
  customerId: string | null;
  networkKey: string | null;
  tokenSymbol: string | null;
  isActive: boolean;
  maxRedemptions: number | null;
  redemptionCount: number;
  metadata: Record<string, string> | null;
  createdAt: string;
  /**
   * Canonical shareable URL, when the server supplies one. Prefer
   * {@link CreatePaymentLinkResult.url}, which falls back sensibly.
   */
  url?: string;
}

export interface CreatePaymentLinkResult {
  link: PaymentLink;
  /**
   * Shareable URL to send to buyers.
   *
   * Server-supplied when the deployment returns a canonical `url`;
   * otherwise derived as `${backendUrl}/pay/${id}`. The derived form is
   * wrong on deployments whose public checkout host differs from the API
   * host, so treat a missing server-side `url` as a deployment to fix
   * rather than a shape to rely on.
   */
  url: string;
}

/** Creates a reusable hosted payment link for a product. */
export async function createPaymentLink(
  config: PaylixConfig,
  params: CreatePaymentLinkParams,
): Promise<CreatePaymentLinkResult> {
  const link = await request<PaymentLink>(config, "POST", "/api/payment-links", {
    body: params,
  });
  return {
    link,
    url: link.url ?? `${config.backendUrl.replace(/\/+$/, "")}/pay/${link.id}`,
  };
}

/** Lists every payment link on the organization, archived ones included. */
export async function listPaymentLinks(
  config: PaylixConfig,
): Promise<PaymentLink[]> {
  return request<PaymentLink[]>(config, "GET", "/api/payment-links");
}

/**
 * Deactivates a payment link. The row is retained so past redemptions keep
 * resolving; the URL stops accepting new payments.
 */
export async function archivePaymentLink(
  config: PaylixConfig,
  id: string,
): Promise<void> {
  await request<void>(
    config,
    "DELETE",
    `/api/payment-links/${encodeURIComponent(id)}`,
  );
}

/** Fetches a single payment link by id. */
export async function getPaymentLink(
  config: PaylixConfig,
  id: string,
): Promise<PaymentLink> {
  return request<PaymentLink>(
    config,
    "GET",
    `/api/payment-links/${encodeURIComponent(id)}`,
  );
}

export interface UpdatePaymentLinkParams {
  name?: string;
  /** `null` clears the cap, allowing unlimited redemptions. */
  maxRedemptions?: number | null;
  isActive?: boolean;
  metadata?: Record<string, string>;
}

/** Updates a payment link in place. Only the fields you pass are changed. */
export async function updatePaymentLink(
  config: PaylixConfig,
  id: string,
  params: UpdatePaymentLinkParams,
): Promise<PaymentLink> {
  return request<PaymentLink>(
    config,
    "PATCH",
    `/api/payment-links/${encodeURIComponent(id)}`,
    { body: params },
  );
}
