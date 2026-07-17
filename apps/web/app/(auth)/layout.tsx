import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-pad">
      <div className="w-full max-w-[380px]">
        <div className="mb-5 flex items-center justify-center gap-[9px] font-disp text-[17px] font-extrabold tracking-[-0.01em]">
          <Logo size={26} className="rounded-[8px]" />
          Tess Portal
        </div>
        {children}
      </div>
    </div>
  );
}
