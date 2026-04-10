export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#07070a]">
      {/* Top bar */}
      <div className="h-14 border-b border-[rgba(148,163,184,0.08)] bg-[#07070a]">
        <div className="mx-auto flex h-full max-w-[960px] items-center justify-center px-6">
          <span className="text-[16px] font-semibold tracking-[-0.1px] text-[#f0f0f3]">
            Paylix
          </span>
        </div>
      </div>
      <div className="mx-auto max-w-[960px] px-6 py-12">
        {children}
      </div>
      <div className="pb-12 text-center">
        <span className="text-[12px] tracking-[0.2px] text-[#64748b]">
          Powered by Paylix
        </span>
      </div>
    </div>
  );
}
