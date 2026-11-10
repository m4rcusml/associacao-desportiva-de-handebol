import { Pessoa } from "../../../../features/presidente/pessoas/pessoa";

export default async function PessoaPage({ params }: PageProps<"/presidente/pessoas/[usuarioId]">) {
  const { usuarioId } = await params;
  // `key` reinicia o estado ao navegar entre pessoas.
  return <Pessoa key={usuarioId} usuarioId={usuarioId} />;
}
