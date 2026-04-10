"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message || "Invalid email or password");
      } else {
        router.push("/overview");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-[rgba(148,163,184,0.12)] bg-[#111116] p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#f0f0f3]">Sign in</h1>
        <p className="mt-1 text-sm text-[#94a3b8]">
          Welcome back to Paylix
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-[#f8717130] bg-[#f8717112] px-3.5 py-2.5 text-sm text-[#f87171]">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-sm text-[#94a3b8]">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="h-10 w-full rounded-lg border border-[rgba(148,163,184,0.12)] bg-[#07070a] px-3.5 text-sm text-[#f0f0f3] placeholder-[#64748b] outline-none transition-colors focus:border-[#06d6a0] focus:ring-2 focus:ring-[#06d6a020]"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm text-[#94a3b8]">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="h-10 w-full rounded-lg border border-[rgba(148,163,184,0.12)] bg-[#07070a] px-3.5 text-sm text-[#f0f0f3] placeholder-[#64748b] outline-none transition-colors focus:border-[#06d6a0] focus:ring-2 focus:ring-[#06d6a020]"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="h-10 w-full rounded-lg bg-[#06d6a0] text-sm font-medium text-[#07070a] transition-colors hover:bg-[#05bf8e] disabled:opacity-40"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-[#94a3b8]">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="text-[#06d6a0] hover:text-[#05bf8e]">
          Sign up
        </Link>
      </p>
    </div>
  );
}
