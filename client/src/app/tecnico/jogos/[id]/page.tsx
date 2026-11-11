import { JogoTecnico } from "../../../../features/tecnico/jogo";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JogoTecnico key={id} id={id.toLowerCase()} />;
}
