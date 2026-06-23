import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign up — Saveswitch",
  description:
    "Create your Saveswitch account to share your clipboard across devices seamlessly.",
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
