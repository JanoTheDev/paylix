"use client";

import { ProductForm } from "@/components/product-form";
import Link from "next/link";

interface EditProductClientProps {
  product: {
    id: string;
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
  };
}

export function EditProductClient({ product }: EditProductClientProps) {
  return (
    <div>
      <div className="flex items-center gap-4">
        <Link
          href="/products"
          className="inline-flex items-center rounded-lg border border-[rgba(148,163,184,0.12)] bg-transparent px-[18px] py-2.5 text-[14px] font-medium text-[#f0f0f3] transition-colors hover:border-[rgba(148,163,184,0.20)] hover:bg-[#111116]"
        >
          Back
        </Link>
        <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.6px] text-[#f0f0f3]">
          Edit Product
        </h1>
      </div>

      <div className="mt-8">
        <ProductForm mode="edit" initialData={product} />
      </div>
    </div>
  );
}
