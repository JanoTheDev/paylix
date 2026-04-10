import { CheckoutProviders } from "@/components/providers";

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#07070a] p-4">
      <CheckoutProviders>{children}</CheckoutProviders>
    </div>
  );
}
