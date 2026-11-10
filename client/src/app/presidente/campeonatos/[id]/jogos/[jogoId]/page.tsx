import { DetalheJogo } from "../../../../../../features/presidente/jogos/detalhe-jogo";

export default async function JogoPage({ params }: { params: Promise<{ id: string; jogoId: string }> }) {
  const { id, jogoId } = await params;
  return <DetalheJogo key={jogoId} campeonatoId={id} jogoId={jogoId} />;
}
