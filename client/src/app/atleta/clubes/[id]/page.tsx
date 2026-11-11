import { ClubePessoalDetalhe } from "../../../../features/area-pessoal/clubes";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClubePessoalDetalhe key={id} id={id} />;
}
