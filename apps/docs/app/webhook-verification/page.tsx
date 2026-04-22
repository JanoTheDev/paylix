import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  PageHeading,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Webhook Verification" };

export default function WebhookVerificationPage() {
  return (
    <>
      <PageHeading
        title="Webhook Verification"
        description="Verify webhook signatures in any language. Every Paylix webhook includes an x-paylix-signature header containing an HMAC-SHA256 digest of the raw request body."
      />

      <Callout variant="tip" title="Signature format">
        The current Paylix signature is{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          t=&lt;unix_seconds&gt;,v1=&lt;hex&gt;
        </code>
        . The HMAC covers{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          &lt;unix_seconds&gt;.&lt;raw_body&gt;
        </code>{" "}
        (dot-separated). Receivers should reject signatures whose timestamp
        is outside a 5-minute window to block replay attacks. Older deploys
        still accept the legacy{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          sha256=&lt;hex&gt;
        </code>{" "}
        format for backward compatibility, but new integrations should use
        the timestamped form.
      </Callout>

      <SectionHeading>How it works</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Paylix generates a Unix-seconds timestamp and computes{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          HMAC-SHA256(webhook_secret, &lt;timestamp&gt;.&lt;raw_body&gt;)
        </code>
        , hex-encodes the result, and sends the value{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          t=&lt;timestamp&gt;,v1=&lt;hex&gt;
        </code>{" "}
        in the{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          x-paylix-signature
        </code>{" "}
        header. To verify: parse out the timestamp + HMAC, re-compute HMAC
        over <code>t.body</code> with your secret, constant-time compare,
        and reject if the timestamp is more than 5 minutes old.
      </p>

      <SectionHeading>Node.js</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        The SDK handles verification for you:
      </p>
      <CodeBlock language="ts">{`import { webhooks } from "@paylix/sdk";

const isValid = webhooks.verify({
  payload: rawBody,          // string or Buffer — must be the raw request body
  signature: req.headers["x-paylix-signature"],
  secret: "whsec_...",
});`}</CodeBlock>

      <SubsectionHeading>Manual (without the SDK)</SubsectionHeading>
      <CodeBlock language="ts">{`import { createHmac, timingSafeEqual } from "crypto";

const MAX_AGE_SECONDS = 300; // 5 minutes

function parseHeader(header: string): { t: string; v1: string } | null {
  const parts = Object.fromEntries(
    header.split(",").map((s) => s.trim().split("=", 2) as [string, string]),
  );
  return parts.t && parts.v1 ? { t: parts.t, v1: parts.v1 } : null;
}

function verifyWebhook(payload: string, signature: string, secret: string): boolean {
  const parsed = parseHeader(signature);
  if (!parsed) {
    // Legacy sha256=<hex> format — no timestamp, no replay protection.
    if (!signature.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    const provided = signature.slice(7);
    return expected.length === provided.length && timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(provided, "hex"),
    );
  }

  const ts = Number(parsed.t);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_AGE_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(\`\${parsed.t}.\${payload}\`)
    .digest("hex");
  if (expected.length !== parsed.v1.length) return false;
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(parsed.v1, "hex"),
  );
}`}</CodeBlock>

      <SectionHeading>Python</SectionHeading>
      <CodeBlock language="python">{`import hmac
import hashlib
import time

MAX_AGE_SECONDS = 300  # 5 minutes

def verify_webhook(payload: bytes, signature: str, secret: str) -> bool:
    """Verify a Paylix webhook signature.

    payload: raw request body as bytes
    signature: value of the x-paylix-signature header (either
               "t=<unix>,v1=<hex>" or legacy "sha256=<hex>")
    secret: your webhook secret (whsec_...)
    """
    # Timestamped format
    if "v1=" in signature and "t=" in signature:
        parts = dict(kv.split("=", 1) for kv in signature.split(","))
        try:
            ts = int(parts["t"])
        except (KeyError, ValueError):
            return False
        if abs(int(time.time()) - ts) > MAX_AGE_SECONDS:
            return False
        signed = f"{ts}.".encode() + payload
        expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, parts.get("v1", ""))

    # Legacy format
    if not signature.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature[7:])`}</CodeBlock>

      <SubsectionHeading>Flask example</SubsectionHeading>
      <CodeBlock language="python">{`from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route("/webhook", methods=["POST"])
def handle_webhook():
    is_valid = verify_webhook(
        request.data,
        request.headers.get("x-paylix-signature", ""),
        "whsec_...",
    )
    if not is_valid:
        return jsonify(error="Invalid signature"), 401

    event = request.json
    match event["event"]:
        case "payment.confirmed":
            # fulfill the order
            pass
        case "subscription.created":
            # activate the subscription
            pass

    return jsonify(received=True)`}</CodeBlock>

      <SectionHeading>Go</SectionHeading>
      <CodeBlock language="go">{`package paylix

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// VerifyWebhook checks the x-paylix-signature header against the raw body.
func VerifyWebhook(payload []byte, signature, secret string) bool {
	if !strings.HasPrefix(signature, "sha256=") {
		return false
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	provided := signature[7:] // strip "sha256=" prefix

	return hmac.Equal([]byte(expected), []byte(provided))
}`}</CodeBlock>

      <SubsectionHeading>net/http example</SubsectionHeading>
      <CodeBlock language="go">{`package main

import (
	"encoding/json"
	"io"
	"net/http"
)

func webhookHandler(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	signature := r.Header.Get("X-Paylix-Signature")
	if !VerifyWebhook(body, signature, "whsec_...") {
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	var event struct {
		Event string          \`json:"event"\`
		Data  json.RawMessage \`json:"data"\`
	}
	json.Unmarshal(body, &event)

	switch event.Event {
	case "payment.confirmed":
		// fulfill the order
	case "subscription.created":
		// activate the subscription
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(\`{"received":true}\`))
}`}</CodeBlock>

      <SectionHeading>Ruby</SectionHeading>
      <CodeBlock language="ruby">{`require "openssl"

def verify_webhook(payload, signature, secret)
  return false unless signature.start_with?("sha256=")

  expected = OpenSSL::HMAC.hexdigest("SHA256", secret, payload)
  provided = signature[7..] # strip "sha256=" prefix

  Rack::Utils.secure_compare(expected, provided)
end`}</CodeBlock>

      <SubsectionHeading>Sinatra example</SubsectionHeading>
      <CodeBlock language="ruby">{`require "sinatra"
require "json"

post "/webhook" do
  payload = request.body.read
  signature = request.env["HTTP_X_PAYLIX_SIGNATURE"] || ""

  unless verify_webhook(payload, signature, "whsec_...")
    halt 401, { error: "Invalid signature" }.to_json
  end

  event = JSON.parse(payload)
  case event["event"]
  when "payment.confirmed"
    # fulfill the order
  when "subscription.created"
    # activate the subscription
  end

  { received: true }.to_json
end`}</CodeBlock>

      <SectionHeading>Important notes</SectionHeading>
      <ul className="mt-4 space-y-2 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          <strong className="text-foreground">Use the raw body</strong> — compute
          the HMAC on the raw request bytes, not on parsed/re-serialized JSON.
          Parsing and re-encoding can change key order or whitespace, breaking
          the signature.
        </li>
        <li>
          <strong className="text-foreground">Constant-time comparison</strong> —
          always use a timing-safe comparison function (
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            timingSafeEqual
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            hmac.compare_digest
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            hmac.Equal
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            secure_compare
          </code>
          ) to avoid timing attacks.
        </li>
        <li>
          <strong className="text-foreground">Check the prefix</strong> — the
          signature always starts with{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            sha256=
          </code>
          . Reject signatures that don&apos;t match this format.
        </li>
      </ul>
    </>
  );
}
