import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in — Saveswitch",
  description:
    "Sign in to Saveswitch to share your clipboard across devices seamlessly.",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
