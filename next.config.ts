import type { NextConfig } from "next";

const isExport = process.env.NEXT_OUTPUT === "export";

const nextConfig: NextConfig = isExport
  ? {
      output: "export",
      trailingSlash: true,
    }
  : {
      async headers() {
        return [
          {
            source: "/(.*)",
            headers: [
              {
                key: "Cross-Origin-Opener-Policy",
                value: "same-origin",
              },
              {
                key: "Cross-Origin-Embedder-Policy",
                value: "credentialless",
              },
            ],
          },
        ];
      },
    };

export default nextConfig;
