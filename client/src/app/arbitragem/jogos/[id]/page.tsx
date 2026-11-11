import { JogoArbitragem } from "../../../../features/arbitragem/jogo";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JogoArbitragem key={id.toLowerCase()} id={id.toLowerCase()} />;
}
