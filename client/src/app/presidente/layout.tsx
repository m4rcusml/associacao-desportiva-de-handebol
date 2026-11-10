import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PresidenteShell } from "../../features/presidente/shell";

export const metadata: Metadata = { title: "Presidente | Associação Desportiva de Handebol" };

export default function PresidenteLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <PresidenteShell>{children}</PresidenteShell>;
}
