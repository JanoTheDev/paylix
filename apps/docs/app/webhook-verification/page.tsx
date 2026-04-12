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
        The signature header value is always prefixed with{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          sha256=
        </code>{" "}
        followed by the hex-encoded HMAC. Your verification code must compare
        against this exact format.
      </Callout>

      <SectionHeading>How it works</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Paylix computes{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          HMAC-SHA256(webhook_secret, raw_body)
        </code>
        , hex-encodes the result, and sends it as{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          sha256=&lt;hex&gt;
        </code>{" "}
        in the{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          x-paylix-signature
        </code>{" "}
        header. To verify, recompute the same HMAC with your webhook secret and
        compare using a constant-time comparison function.
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

function verifyWebhook(payload: string, signature: string, secret: string): boolean {
  if (!signature.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  const provided = signature.slice(7); // strip "sha256=" prefix

  if (expected.length !== provided.length) return false;

  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(provided, "hex"),
  );
}`}</CodeBlock>

      <SectionHeading>Python</SectionHeading>
      <CodeBlock language="python">{`import hmac
import hashlib

def verify_webhook(payload: bytes, signature: str, secret: str) -> bool:
    """Verify a Paylix webhook signature.

    payload: raw request body as bytes
    signature: value of the x-paylix-signature header
    secret: your webhook secret (whsec_...)
    """
    if not signature.startswith("sha256="):
        return False

    expected = hmac.new(
        secret.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()

    provided = signature[7:]  # strip "sha256=" prefix
    return hmac.compare_digest(expected, provided)`}</CodeBlock>

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
