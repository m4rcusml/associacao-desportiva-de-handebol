import { HistoricoPessoal } from "../../../../features/area-pessoal/historico";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HistoricoPessoal key={id} atletaId={id.toLowerCase()} ficha />;
}
