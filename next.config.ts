import type { NextConfig } from "next";

const imageKitOrigin = (() => {
  const endpoint = process.env.IMAGEKIT_URL_ENDPOINT;
  if (!endpoint) return "https://ik.imagekit.io";
  try {
    return new URL(endpoint).origin;
  } catch {
    return "https://ik.imagekit.io";
  }
})();

const nextConfig: NextConfig = {
  async headers() {
    const scriptPolicy = process.env.NODE_ENV === "development"
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
          "object-src 'none'",
          scriptPolicy,
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          `img-src 'self' data: blob: https://res.cloudinary.com ${imageKitOrigin}`,
          `media-src 'self' blob: https://res.cloudinary.com ${imageKitOrigin}`,
          `connect-src 'self' https://api.cloudinary.com ${imageKitOrigin}`,
        ].join("; "),
      },
      ...(process.env.NODE_ENV === "production"
        ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
        : []),
    ];

    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
