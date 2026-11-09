import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O Socket.IO usa `/api/socket.io/` com barra final; o redirecionamento padrão quebraria o encaminhamento.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
