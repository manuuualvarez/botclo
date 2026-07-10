import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Genera un servidor autocontenido en .next/standalone — lo usa la imagen
  // de producción de Docker para no copiar node_modules completo al VPS.
  output: "standalone",

  // Cabeceras de seguridad para todas las respuestas. HSTS lo agrega Caddy al
  // terminar el TLS; el resto viaja desde la app.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
