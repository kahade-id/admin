import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Cegah clickjacking pada panel admin.
          { key: "X-Frame-Options", value: "DENY" },
          // Cegah MIME-sniffing.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Batasi informasi referrer yang bocor ke pihak ketiga.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
