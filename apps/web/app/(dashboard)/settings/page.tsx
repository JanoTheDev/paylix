"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";

interface UserSettings {
  id: string;
  name: string;
  email: string;
  walletAddress: string | null;
}

interface CheckoutDefaults {
  firstName: boolean;
  lastName: boolean;
  email: boolean;
  phone: boolean;
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 9999,
        backgroundColor: checked ? "#06d6a0" : "rgba(148,163,184,0.15)",
        position: "relative",
        border: "none",
        cursor: "pointer",
        transition: "background-color 200ms cubic-bezier(0.4, 0, 0.2, 1)",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: "block",
          width: 18,
          height: 18,
          borderRadius: 9999,
          backgroundColor: "#f0f0f3",
          position: "absolute",
          top: 3,
          left: checked ? 23 : 3,
          transition: "left 200ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />
    </button>
  );
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const [user, setUser] = useState<UserSettings | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [name, setName] = useState("");
  const [checkoutDefaults, setCheckoutDefaults] = useState<CheckoutDefaults>({
    firstName: true,
    lastName: true,
    email: true,
    phone: false,
  });

  const [walletSaving, setWalletSaving] = useState(false);
  const [walletSuccess, setWalletSuccess] = useState(false);
  const [walletError, setWalletError] = useState("");

  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState("");

  const [defaultsSaving, setDefaultsSaving] = useState(false);
  const [defaultsSuccess, setDefaultsSuccess] = useState(false);

  const network = process.env.NEXT_PUBLIC_NETWORK || "testnet";
  const isMainnet = network === "mainnet";

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data: UserSettings = await res.json();
          setUser(data);
          setWalletAddress(data.walletAddress || "");
          setName(data.name);
        }
      } catch {
        // ignore
      }

      // Load checkout defaults from localStorage
      const saved = localStorage.getItem("paylix_checkout_defaults");
      if (saved) {
        try {
          setCheckoutDefaults(JSON.parse(saved));
        } catch {
          // ignore
        }
      }
    }
    load();
  }, []);

  async function saveWallet() {
    setWalletSaving(true);
    setWalletError("");
    setWalletSuccess(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress }),
      });
      if (!res.ok) {
        const data = await res.json();
        setWalletError(data.error || "Failed to save");
      } else {
        setWalletSuccess(true);
        setTimeout(() => setWalletSuccess(false), 2000);
      }
    } catch {
      setWalletError("Failed to save");
    } finally {
      setWalletSaving(false);
    }
  }

  async function saveProfile() {
    setProfileSaving(true);
    setProfileError("");
    setProfileSuccess(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json();
        setProfileError(data.error || "Failed to save");
      } else {
        setProfileSuccess(true);
        setTimeout(() => setProfileSuccess(false), 2000);
      }
    } catch {
      setProfileError("Failed to save");
    } finally {
      setProfileSaving(false);
    }
  }

  function saveCheckoutDefaults() {
    setDefaultsSaving(true);
    localStorage.setItem(
      "paylix_checkout_defaults",
      JSON.stringify(checkoutDefaults)
    );
    setDefaultsSuccess(true);
    setTimeout(() => {
      setDefaultsSaving(false);
      setDefaultsSuccess(false);
    }, 1500);
  }

  const cardStyle: React.CSSProperties = {
    background: "#111116",
    border: "1px solid rgba(148,163,184,0.12)",
    borderRadius: 12,
    padding: 24,
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: "-0.4px",
    color: "#f0f0f3",
    lineHeight: 1.25,
    margin: 0,
    marginBottom: 20,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 500,
    color: "#94a3b8",
    marginBottom: 8,
    display: "block",
  };

  const descStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 400,
    color: "#64748b",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "#07070a",
    border: "1px solid rgba(148,163,184,0.12)",
    borderRadius: 8,
    padding: "10px 14px",
    height: 40,
    fontSize: 14,
    color: "#f0f0f3",
    outline: "none",
    transition: "border 150ms ease, box-shadow 150ms ease",
    boxSizing: "border-box",
  };

  const primaryBtnStyle: React.CSSProperties = {
    background: "#06d6a0",
    color: "#07070a",
    border: "none",
    borderRadius: 8,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: "background 150ms ease",
  };

  const disabledBtnStyle: React.CSSProperties = {
    ...primaryBtnStyle,
    opacity: 0.4,
    cursor: "not-allowed",
  };

  if (!user) {
    return (
      <div>
        <h1
          style={{
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: "-0.6px",
            color: "#f0f0f3",
            lineHeight: 1.15,
            marginBottom: 32,
          }}
        >
          Settings
        </h1>
        <p style={{ color: "#94a3b8", fontSize: 14 }}>Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <h1
        style={{
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: "-0.6px",
          color: "#f0f0f3",
          lineHeight: 1.15,
          marginBottom: 32,
        }}
      >
        Settings
      </h1>

      <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 560 }}>
        {/* Wallet Section */}
        <div style={cardStyle}>
          <h2 style={sectionTitleStyle}>Wallet</h2>
          <label style={labelStyle}>Payout Wallet Address</label>
          <p style={{ ...descStyle, marginBottom: 12, marginTop: 0 }}>
            USDC payments will be sent to this address on Base.
          </p>
          <input
            type="text"
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            placeholder="0x..."
            style={{
              ...inputStyle,
              fontFamily: '"Geist Mono", "JetBrains Mono", "Fira Code", ui-monospace, monospace',
              fontSize: 13,
              marginBottom: 16,
            }}
            onFocus={(e) => {
              e.target.style.borderColor = "#06d6a0";
              e.target.style.boxShadow = "0 0 0 3px #06d6a020";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "rgba(148,163,184,0.12)";
              e.target.style.boxShadow = "none";
            }}
          />
          {walletError && (
            <p style={{ color: "#f87171", fontSize: 13, margin: "0 0 12px 0" }}>
              {walletError}
            </p>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={saveWallet}
              disabled={walletSaving}
              style={walletSaving ? disabledBtnStyle : primaryBtnStyle}
              onMouseEnter={(e) => {
                if (!walletSaving) (e.target as HTMLButtonElement).style.background = "#05bf8e";
              }}
              onMouseLeave={(e) => {
                if (!walletSaving) (e.target as HTMLButtonElement).style.background = "#06d6a0";
              }}
            >
              {walletSaving ? "Saving..." : "Save"}
            </button>
            {walletSuccess && (
              <span style={{ color: "#22c55e", fontSize: 13, fontWeight: 500 }}>
                Saved
              </span>
            )}
          </div>
        </div>

        {/* Network Section */}
        <div style={cardStyle}>
          <h2 style={sectionTitleStyle}>Network</h2>
          <label style={labelStyle}>Current Network</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
            <span
              style={{
                background: isMainnet ? "#22c55e12" : "#60a5fa12",
                color: isMainnet ? "#22c55e" : "#60a5fa",
                border: `1px solid ${isMainnet ? "#22c55e30" : "#60a5fa30"}`,
                borderRadius: 9999,
                padding: "3px 10px",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.3px",
                lineHeight: 1,
              }}
            >
              {isMainnet ? "Mainnet" : "Testnet"}
            </span>
            <span style={{ color: "#f0f0f3", fontSize: 14 }}>
              {isMainnet ? "Base (Mainnet)" : "Base Sepolia (Testnet)"}
            </span>
          </div>
          <p style={{ ...descStyle, marginTop: 12, marginBottom: 0 }}>
            Network is configured via the NEXT_PUBLIC_NETWORK environment variable.
          </p>
        </div>

        {/* Profile Section */}
        <div style={cardStyle}>
          <h2 style={sectionTitleStyle}>Profile</h2>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              style={inputStyle}
              onFocus={(e) => {
                e.target.style.borderColor = "#06d6a0";
                e.target.style.boxShadow = "0 0 0 3px #06d6a020";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "rgba(148,163,184,0.12)";
                e.target.style.boxShadow = "none";
              }}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Email</label>
            <span style={{ color: "#64748b", fontSize: 14 }}>{user.email}</span>
          </div>
          {profileError && (
            <p style={{ color: "#f87171", fontSize: 13, margin: "0 0 12px 0" }}>
              {profileError}
            </p>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={saveProfile}
              disabled={profileSaving}
              style={profileSaving ? disabledBtnStyle : primaryBtnStyle}
              onMouseEnter={(e) => {
                if (!profileSaving) (e.target as HTMLButtonElement).style.background = "#05bf8e";
              }}
              onMouseLeave={(e) => {
                if (!profileSaving) (e.target as HTMLButtonElement).style.background = "#06d6a0";
              }}
            >
              {profileSaving ? "Saving..." : "Save"}
            </button>
            {profileSuccess && (
              <span style={{ color: "#22c55e", fontSize: 13, fontWeight: 500 }}>
                Saved
              </span>
            )}
          </div>
        </div>

        {/* Default Checkout Fields Section */}
        <div style={cardStyle}>
          <h2 style={sectionTitleStyle}>Default Checkout Fields</h2>
          <p style={{ ...descStyle, marginTop: 0, marginBottom: 20 }}>
            These fields will be enabled by default when creating new products.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {([
              { key: "firstName" as const, label: "First Name" },
              { key: "lastName" as const, label: "Last Name" },
              { key: "email" as const, label: "Email" },
              { key: "phone" as const, label: "Phone" },
            ]).map(({ key, label }) => (
              <div
                key={key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ color: "#f0f0f3", fontSize: 14, fontWeight: 400 }}>
                  {label}
                </span>
                <Toggle
                  checked={checkoutDefaults[key]}
                  onChange={(val) =>
                    setCheckoutDefaults((prev) => ({ ...prev, [key]: val }))
                  }
                />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20 }}>
            <button
              onClick={saveCheckoutDefaults}
              disabled={defaultsSaving}
              style={defaultsSaving ? disabledBtnStyle : primaryBtnStyle}
              onMouseEnter={(e) => {
                if (!defaultsSaving) (e.target as HTMLButtonElement).style.background = "#05bf8e";
              }}
              onMouseLeave={(e) => {
                if (!defaultsSaving) (e.target as HTMLButtonElement).style.background = "#06d6a0";
              }}
            >
              {defaultsSaving ? "Saving..." : "Save"}
            </button>
            {defaultsSuccess && (
              <span style={{ color: "#22c55e", fontSize: 13, fontWeight: 500 }}>
                Saved
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
