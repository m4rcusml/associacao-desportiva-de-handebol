import { DetalheCampeonato } from "../../../../features/presidente/campeonatos/detalhe-campeonato";

export default async function CampeonatoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DetalheCampeonato key={id} campeonatoId={id} />;
}
