/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@tessportal/shared", "@tessportal/db"],
  // renamed out of `experimental` in Next 15; these packages ship native
  // or non-bundleable code and must stay external to the server bundle
  serverExternalPackages: [
    "@node-rs/argon2",
    "mammoth",
    "pdfjs-dist",
    "docx",
    "wink-nlp",
    "wink-eng-lite-web-model",
  ],
  poweredByHeader: false,
  async redirects() {
    return [{ source: "/", destination: "/pipeline", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
