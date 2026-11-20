import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Server-level redirect so `/` answers 307 immediately (the page-level
    // redirect() streams a meta refresh under vinext).
    return [{ source: "/", destination: "/login", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          // Only frame-ancestors: a script/style CSP would break Google sign-in and framer-motion.
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
