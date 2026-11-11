import type { ReactNode } from "react";
import { PessoalShell } from "../../features/area-pessoal/shell";

export default function Layout({ children }: { children: ReactNode }) {
  return <PessoalShell perfil="tecnico">{children}</PessoalShell>;
}
