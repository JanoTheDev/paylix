import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PAYMENT_VAULT_ABI,
  SUBSCRIPTION_MANAGER_ABI,
  ON_CHAIN_SUBSCRIPTION_STATUS,
  FLOW_EIP2612,
  FLOW_PERMIT2,
  FLOW_DAI_PERMIT,
  signatureDeadline,
} from "../contracts";

/**
 * The inline ABIs in `lib/contracts.ts` are hand-maintained. Struct field
 * order is part of the ABI encoding AND of every EIP-712 digest, so a tuple
 * that merely looks right silently produces unverifiable signatures at relay
 * time. Pin them to the generated artifacts so a contract change that isn't
 * mirrored here fails in CI instead of on-chain.
 */

const ABI_ROOT = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "contracts",
  "abi",
);

type AbiParam = {
  name: string;
  type: string;
  components?: readonly AbiParam[];
};
type AbiFn = {
  type: string;
  name?: string;
  stateMutability?: string;
  inputs?: readonly AbiParam[];
  outputs?: readonly AbiParam[];
};

function loadGenerated(file: string): AbiFn[] {
  const raw = JSON.parse(readFileSync(join(ABI_ROOT, file), "utf8"));
  return Array.isArray(raw) ? raw : raw.abi;
}

/** Strip `internalType` and any other artifact-only keys. */
function shape(params: readonly AbiParam[] | undefined): unknown[] {
  return (params ?? []).map((p) =>
    p.components
      ? { name: p.name, type: p.type, components: shape(p.components) }
      : { name: p.name, type: p.type },
  );
}

function fnByName(abi: AbiFn[], name: string): AbiFn {
  const hit = abi.find((e) => e.type === "function" && e.name === name);
  if (!hit) throw new Error(`${name} is not in the generated ABI`);
  return hit;
}

function expectMatchesGenerated(
  inline: readonly AbiFn[],
  generated: AbiFn[],
  names: string[],
) {
  for (const name of names) {
    const ours = inline.find((e) => e.type === "function" && e.name === name);
    expect(ours, `${name} missing from the inline ABI`).toBeDefined();
    const theirs = fnByName(generated, name);
    expect(shape(ours!.inputs), `${name} inputs`).toEqual(shape(theirs.inputs));
    expect(shape(ours!.outputs), `${name} outputs`).toEqual(
      shape(theirs.outputs),
    );
    expect(ours!.stateMutability, `${name} stateMutability`).toBe(
      theirs.stateMutability,
    );
  }
}

describe("PAYMENT_VAULT_ABI matches packages/contracts/abi/PaymentVault.json", () => {
  const generated = loadGenerated("PaymentVault.json");

  it("matches every function we declare", () => {
    const declared = PAYMENT_VAULT_ABI.filter((e) => e.type === "function").map(
      (e) => (e as AbiFn).name!,
    );
    expectMatchesGenerated(
      PAYMENT_VAULT_ABI as readonly AbiFn[],
      generated,
      declared,
    );
  });

  it("carries maxFeeBps on all three gasless entry points", () => {
    for (const name of [
      "createPaymentWithPermit",
      "createPaymentWithPermit2",
      "createPaymentWithDaiPermit",
    ]) {
      const fn = (PAYMENT_VAULT_ABI as readonly AbiFn[]).find(
        (e) => e.name === name,
      )!;
      const tuple = fn.inputs![0];
      expect(
        tuple.components!.map((c) => c.name),
        name,
      ).toContain("maxFeeBps");
    }
  });

  it("keeps PaymentIntentData's buyer-before-token order", () => {
    const fn = (PAYMENT_VAULT_ABI as readonly AbiFn[]).find(
      (e) => e.name === "createPaymentWithPermit",
    )!;
    expect(fn.inputs![0].components!.map((c) => c.name)).toEqual([
      "buyer",
      "token",
      "merchant",
      "amount",
      "productId",
      "customerId",
      "maxFeeBps",
      "deadline",
    ]);
  });
});

describe("SUBSCRIPTION_MANAGER_ABI matches packages/contracts/abi/SubscriptionManager.json", () => {
  const generated = loadGenerated("SubscriptionManager.json");

  it("matches every function we declare", () => {
    const declared = SUBSCRIPTION_MANAGER_ABI.filter(
      (e) => e.type === "function",
    ).map((e) => (e as AbiFn).name!);
    expectMatchesGenerated(
      SUBSCRIPTION_MANAGER_ABI as readonly AbiFn[],
      generated,
      declared,
    );
  });

  it("carries maxFeeBps on all three gasless creation paths", () => {
    for (const name of [
      "createSubscriptionWithPermit",
      "createSubscriptionWithPermitDiscount",
      "createSubscriptionWithPermit2",
    ]) {
      const fn = (SUBSCRIPTION_MANAGER_ABI as readonly AbiFn[]).find(
        (e) => e.name === name,
      )!;
      expect(
        fn.inputs![0].components!.map((c) => c.name),
        name,
      ).toContain("maxFeeBps");
    }
  });

  it("requires the backup wallet's own consent signature (SC-01)", () => {
    const fn = (SUBSCRIPTION_MANAGER_ABI as readonly AbiFn[]).find(
      (e) => e.name === "addSubscriptionBackupPayer",
    )!;
    expect(fn.inputs!.map((i) => i.name)).toEqual([
      "p",
      "subscriberAuthSig",
      "backupConsentSig",
    ]);
    expect(fn.inputs![0].components!.map((c) => c.name)).toEqual([
      "subscriptionId",
      "backup",
      "authDeadline",
      "maxAmount",
      "consentDeadline",
      "permitValue",
      "permitDeadline",
      "v",
      "r",
      "s",
    ]);
  });

  it("exposes the three independent nonce counters", () => {
    const names = (SUBSCRIPTION_MANAGER_ABI as readonly AbiFn[]).map(
      (e) => e.name,
    );
    expect(names).toContain("getIntentNonce");
    expect(names).toContain("getBackupAuthNonce");
    expect(names).toContain("getBackupConsentNonce");
  });
});

describe("contract constants", () => {
  it("mirrors the renumbered Status enum with no Expired member", () => {
    expect(ON_CHAIN_SUBSCRIPTION_STATUS).toEqual({
      None: 0,
      Active: 1,
      PastDue: 2,
      Cancelled: 3,
    });
    expect(Object.keys(ON_CHAIN_SUBSCRIPTION_STATUS)).not.toContain("Expired");
    // None must stay zero: an unwritten storage slot decodes as None (SC-05).
    expect(ON_CHAIN_SUBSCRIPTION_STATUS.None).toBe(0);
  });

  it("mirrors the on-chain flow identifiers", () => {
    const src = readFileSync(
      join(ABI_ROOT, "..", "src", "PaymentVault.sol"),
      "utf8",
    );
    expect(src).toContain(`uint8 public constant FLOW_EIP2612 = ${FLOW_EIP2612}`);
    expect(src).toContain(`uint8 public constant FLOW_PERMIT2 = ${FLOW_PERMIT2}`);
    expect(src).toContain(
      `uint8 public constant FLOW_DAI_PERMIT = ${FLOW_DAI_PERMIT}`,
    );
  });

  it("signatureDeadline returns one shared value", () => {
    const d = signatureDeadline(600);
    const now = BigInt(Math.floor(Date.now() / 1000));
    expect(d).toBeGreaterThan(now);
    expect(d).toBeLessThanOrEqual(now + 601n);
    expect(() => signatureDeadline(0)).toThrow();
    expect(() => signatureDeadline(1.5)).toThrow();
  });
});
