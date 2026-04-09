"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";

interface ProductFormData {
  id?: string;
  name: string;
  description: string;
  type: "one_time" | "subscription";
  price: number;
  interval: "monthly" | "yearly" | "";
  metadata: Record<string, string>;
  checkoutFields: {
    firstName: boolean;
    lastName: boolean;
    email: boolean;
    phone: boolean;
  };
}

const inputClass =
  "h-10 w-full rounded-lg border border-[rgba(148,163,184,0.12)] bg-[#07070a] px-3.5 py-2.5 text-[14px] text-[#f0f0f3] placeholder-[#64748b] transition-[border,box-shadow] duration-150 ease-in-out focus:border-[#06d6a0] focus:outline-none focus:ring-[3px] focus:ring-[#06d6a020]";

const labelClass =
  "block text-[13px] font-medium leading-none tracking-[0.1px] text-[#94a3b8]";

const selectClass =
  "h-10 w-full appearance-none rounded-lg border border-[rgba(148,163,184,0.12)] bg-[#07070a] px-3.5 py-2.5 text-[14px] text-[#f0f0f3] transition-[border,box-shadow] duration-150 ease-in-out focus:border-[#06d6a0] focus:outline-none focus:ring-[3px] focus:ring-[#06d6a020]";

export function ProductForm({
  initialData,
  mode,
}: {
  initialData?: ProductFormData;
  mode: "create" | "edit";
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [type, setType] = useState<"one_time" | "subscription">(
    initialData?.type ?? "one_time"
  );
  const [price, setPrice] = useState(initialData?.price ? String(initialData.price) : "");
  const [interval, setInterval] = useState<"monthly" | "yearly" | "">(
    initialData?.interval ?? ""
  );

  const [metadataRows, setMetadataRows] = useState<{ key: string; value: string }[]>(
    initialData?.metadata
      ? Object.entries(initialData.metadata).map(([key, value]) => ({ key, value }))
      : []
  );

  const [checkoutFields, setCheckoutFields] = useState({
    firstName: initialData?.checkoutFields?.firstName ?? false,
    lastName: initialData?.checkoutFields?.lastName ?? false,
    email: initialData?.checkoutFields?.email ?? false,
    phone: initialData?.checkoutFields?.phone ?? false,
  });

  function updateMetadataRow(index: number, field: "key" | "value", val: string) {
    setMetadataRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  }

  function removeMetadataRow(index: number) {
    setMetadataRows((prev) => prev.filter((_, i) => i !== index));
  }

  function addMetadataRow() {
    setMetadataRows((prev) => [...prev, { key: "", value: "" }]);
  }

  function toggleCheckoutField(field: keyof typeof checkoutFields) {
    setCheckoutFields((prev) => ({ ...prev, [field]: !prev[field] }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const metadata: Record<string, string> = {};
    for (const row of metadataRows) {
      if (row.key.trim()) {
        metadata[row.key.trim()] = row.value;
      }
    }

    const payload: Record<string, unknown> = {
      name,
      description: description || undefined,
      type,
      price: Number(price),
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      checkoutFields,
    };

    if (type === "subscription" && interval) {
      payload.interval = interval;
    }

    try {
      const url =
        mode === "edit" ? `/api/products/${initialData?.id}` : "/api/products";
      const method = mode === "edit" ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Something went wrong");
        setSubmitting(false);
        return;
      }

      router.push("/products");
      router.refresh();
    } catch {
      setError("Network error");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-[560px]">
      <div className="rounded-xl border border-[rgba(148,163,184,0.12)] bg-[#111116] p-6">
        {error && (
          <div className="mb-6 rounded-lg border border-[#f8717130] bg-[#f8717112] px-4 py-3 text-[13px] text-[#f87171]">
            {error}
          </div>
        )}

        {/* Name */}
        <div>
          <label className={labelClass}>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Product"
            required
            maxLength={100}
            className={`mt-2 ${inputClass}`}
          />
        </div>

        {/* Description */}
        <div className="mt-4">
          <label className={labelClass}>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description..."
            rows={3}
            className={`mt-2 w-full resize-none rounded-lg border border-[rgba(148,163,184,0.12)] bg-[#07070a] px-3.5 py-2.5 text-[14px] text-[#f0f0f3] placeholder-[#64748b] transition-[border,box-shadow] duration-150 ease-in-out focus:border-[#06d6a0] focus:outline-none focus:ring-[3px] focus:ring-[#06d6a020]`}
          />
        </div>

        {/* Type */}
        <div className="mt-4">
          <label className={labelClass}>Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "one_time" | "subscription")}
            className={`mt-2 ${selectClass}`}
          >
            <option value="one_time">One-time</option>
            <option value="subscription">Subscription</option>
          </select>
        </div>

        {/* Price */}
        <div className="mt-4">
          <label className={labelClass}>Price (cents)</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="1000"
            required
            min={1}
            step={1}
            className={`mt-2 ${inputClass}`}
          />
          <p className="mt-1 text-[12px] text-[#64748b]">
            Enter amount in cents. 1000 = $10.00
          </p>
        </div>

        {/* Interval (only for subscription) */}
        {type === "subscription" && (
          <div className="mt-4">
            <label className={labelClass}>Billing Interval</label>
            <select
              value={interval}
              onChange={(e) =>
                setInterval(e.target.value as "monthly" | "yearly" | "")
              }
              className={`mt-2 ${selectClass}`}
            >
              <option value="">Select interval</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
        )}

        {/* Metadata */}
        <div className="mt-6">
          <label className={labelClass}>Metadata</label>
          <div className="mt-2 space-y-2">
            {metadataRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.key}
                  onChange={(e) => updateMetadataRow(i, "key", e.target.value)}
                  placeholder="key"
                  className={`${inputClass} w-[40%]`}
                />
                <input
                  type="text"
                  value={row.value}
                  onChange={(e) => updateMetadataRow(i, "value", e.target.value)}
                  placeholder="value"
                  className={`${inputClass} flex-1`}
                />
                <button
                  type="button"
                  onClick={() => removeMetadataRow(i)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#94a3b8] transition-colors hover:bg-[#111116] hover:text-[#f0f0f3]"
                >
                  <Trash2 size={16} strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addMetadataRow}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-[18px] py-2.5 text-[14px] font-medium text-[#94a3b8] transition-colors hover:bg-[#111116] hover:text-[#f0f0f3]"
          >
            <Plus size={16} strokeWidth={1.5} />
            Add field
          </button>
        </div>

        {/* Checkout Fields */}
        <div className="mt-6">
          <label className={labelClass}>Checkout Fields</label>
          <div className="mt-3 space-y-3">
            <ToggleRow
              label="First Name"
              checked={checkoutFields.firstName}
              onToggle={() => toggleCheckoutField("firstName")}
            />
            <ToggleRow
              label="Last Name"
              checked={checkoutFields.lastName}
              onToggle={() => toggleCheckoutField("lastName")}
            />
            <ToggleRow
              label="Email"
              checked={checkoutFields.email}
              onToggle={() => toggleCheckoutField("email")}
            />
            <ToggleRow
              label="Phone"
              checked={checkoutFields.phone}
              onToggle={() => toggleCheckoutField("phone")}
            />
          </div>
        </div>

        {/* Submit */}
        <div className="mt-8">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded-lg bg-[#06d6a0] px-[18px] py-2.5 text-[14px] font-medium text-[#07070a] transition-colors hover:bg-[#05bf8e] active:bg-[#04a87b] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting
              ? "Saving..."
              : mode === "edit"
                ? "Update Product"
                : "Create Product"}
          </button>
        </div>
      </div>
    </form>
  );
}

function ToggleRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-[#f0f0f3]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        className="relative h-6 w-11 rounded-full transition-colors duration-200"
        style={{
          background: checked ? "#06d6a0" : "rgba(148, 163, 184, 0.15)",
        }}
      >
        <span
          className="absolute top-[3px] left-[3px] block h-[18px] w-[18px] rounded-full bg-[#f0f0f3] transition-transform duration-200"
          style={{
            transform: checked ? "translateX(20px)" : "translateX(0)",
          }}
        />
      </button>
    </div>
  );
}
