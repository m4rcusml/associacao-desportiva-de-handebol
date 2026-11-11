import { Clube } from "../../../../features/presidente/clubes/clube";

export default async function ClubePage({ params, searchParams }: PageProps<"/presidente/clubes/[clubeId]">) {
  const [{ clubeId }, busca] = await Promise.all([params, searchParams]);
  // `criado=1` vem da criação do clube, para confirmar o sucesso na página do novo clube.
  return <Clube key={clubeId} clubeId={clubeId} criado={busca.criado === "1"} />;
}
