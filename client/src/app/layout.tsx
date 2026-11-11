import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--fonte-plex" });

export const metadata: Metadata = {
  title: "Associação Desportiva de Handebol",
  description: "Gestão de clubes, atletas e competições de handebol.",
  icons: { icon: "/figma/pessoal/clubes.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR" className={plex.variable}>
      <body>{children}</body>
    </html>
  );
}
