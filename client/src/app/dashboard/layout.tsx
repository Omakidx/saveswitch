import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard — Saveswitch",
  description:
    "Your Saveswitch dashboard — manage your clipboard sharing across devices.",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh w-full overflow-hidden">
      {children}
    </div>
  );
}
