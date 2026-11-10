import { redirect } from "next/navigation";

// Entrada da aplicação: a área do presidente envia para o login quando não há sessão.
export default function Home() {
  redirect("/presidente");
}
