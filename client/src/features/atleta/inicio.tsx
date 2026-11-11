"use client";

import Link from "next/link";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useId, useRef, useState } from "react";
import type { CarteirinhaPropria } from "../../lib/area-pessoal";
import type { HistoricoAtleta } from "../../lib/presidente";
import { useAreaPessoal } from "../area-pessoal/shell";
import { EstadoConsulta, useConsulta } from "../area-pessoal/consulta";
import { SituacaoCadastro } from "../area-pessoal/cadastro";
import { FotoPrivada } from "../area-pessoal/foto";
import { Dialogo } from "../ui/dialogo";
import { Iniciais } from "../ui/identificacao";
import { STATUS_JOGO } from "../area-pessoal/historico";
import { dia } from "../ui/formatos";
import controles from "../ui/controles.module.css";
import pagina from "../ui/pagina.module.css";
import pessoal from "../area-pessoal/pessoal.module.css";
import styles from "./carteirinha.module.css";

function Qr({ token, ampliado = false }: { token: string; ampliado?: boolean }) {
  return <div className={`${styles.qr} ${ampliado ? styles.qrAmpliado : ""}`}><QRCodeSVG value={token} size={288} marginSize={4} level="M" title="QR da carteirinha para leitura pela arbitragem" /></div>;
}

export function InicioAtleta() {
  const { sessao } = useAreaPessoal();
  const consulta = useConsulta<CarteirinhaPropria>(sessao.usuario.aprovado ? "/carteirinhas/minha" : null);
  const registros = useConsulta<HistoricoAtleta>(sessao.usuario.aprovado ? `/atletas/${sessao.usuario.id}/historico` : null);
  const [ampliado, setAmpliado] = useState(false);
  const [offline, setOffline] = useState(false);
  const tituloId = useId();
  const fechar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const verificar = () => setOffline(!navigator.onLine);
    verificar(); window.addEventListener("online", verificar); window.addEventListener("offline", verificar);
    return () => { window.removeEventListener("online", verificar); window.removeEventListener("offline", verificar); };
  }, []);
  if (!sessao.usuario.aprovado) return <SituacaoCadastro />;
  const card = consulta.dados;
  const ultimo = registros.dados?.jogos[0];
  return <div className={`${pessoal.pilha} ${styles.inicio}`}>
    <h1 className={pessoal.titulo}>Minha carteirinha</h1>
    <p className={styles.apresentacao}>Sua identificação sempre à mão.</p>
    {offline && <p className={controles.nota} role="status">Sem conexão. Conecte-se e atualize a carteirinha. A arbitragem precisa de internet para validar seu credenciamento.</p>}
    <div className={styles.composicao}>
    {card && <section className={styles.carteirinha} aria-label="Identificação do atleta">
      <div className={styles.identificacao}>
        {card.possuiFoto ? <FotoPrivada atletaId={sessao.usuario.id} nome={card.nomeCompleto} /> : <Iniciais nome={card.nomeCompleto} grande />}
        <div><h2 className={styles.nome}>{card.nomeCompleto}</h2><p className={styles.clube}>{card.clubeAtual?.nome ?? "Clube atual não informado"}</p></div>
      </div>
      <span className={`${controles.status} ${card.status === "ativa" ? controles.statusAprovado : controles.statusRejeitado}`}>{card.status === "ativa" ? "Carteirinha ativa" : "Carteirinha invalidada"}</span>
      {card.status === "invalidada" && <p className={controles.erro}>Carteirinha invalidada pelo presidente. Novos credenciamentos ficam bloqueados até a reativação. Consulte o presidente.</p>}
      {card.status === "ativa" && <Qr token={card.tokenQr} />}
      <p className={styles.codigo} aria-label={`Código da carteirinha: ${card.codigo}`}>{card.codigo}</p>
      {card.status === "ativa" && <button className={controles.primario} onClick={() => setAmpliado(true)}>Ampliar QR para leitura</button>}
      <p className={controles.ajuda}>Apresente esta tela à arbitragem. A elegibilidade é conferida para cada jogo.</p>
    </section>}
    <aside className={styles.registros} aria-label="Seus registros">
      <h2 className={pessoal.titulo}>Seus registros</h2>
      {ultimo ? <article className={pessoal.cardHistorico}>
        <div className={pessoal.linha}><p className={controles.ajuda}>{dia(ultimo.jogo.iniciadoEm ?? ultimo.jogo.inicioPrevistoEm, ultimo.jogo.fusoHorario)}</p><span className={`${controles.status} ${ultimo.jogo.status === "cancelado" ? controles.statusRejeitado : controles.statusAprovado}`}>{STATUS_JOGO[ultimo.jogo.status]}</span></div>
        <h3>{ultimo.clube.clube.nome} × {ultimo.adversario.clube.nome}</h3>
        <p className={pessoal.placar}>{ultimo.placar ? `${ultimo.placar.clube} × ${ultimo.placar.adversario}` : "Sem placar"}</p>
        <p className={controles.ajuda}>{ultimo.entradaAnulada ? "Entrada em quadra anulada." : ultimo.entrouEmQuadra ? "Você entrou em quadra." : ultimo.credenciado ? "Você foi credenciado." : "Você foi escalado."} {ultimo.metricas ? `${ultimo.metricas.gols} gols e ${ultimo.metricas.cartoesAmarelos} amarelos.` : "Métricas indisponíveis antes do credenciamento."}</p>
        {ultimo.jogo.invalidadoEm && <p className={controles.erro}>Resultado invalidado; estatísticas preservadas.</p>}
        <Link className={controles.discreto} href="/atleta/historico">Ver minha participação</Link>
      </article> : <p className={controles.ajuda}>{registros.carregando ? "Consultando suas participações…" : registros.erro ? "Não foi possível consultar os registros. Abra o histórico para tentar novamente." : "Nenhuma participação registrada ainda."}</p>}
      <Link className={pessoal.atalho} href="/atleta/historico"><Image src="/figma/pessoal/registros.svg" alt="" width={24} height={24} /><span><strong>Ver meu histórico</strong><small>Participações, gols e cartões</small></span><Image src="/figma/pessoal/chevron.svg" alt="" width={20} height={20} /></Link>
      <Link className={pessoal.atalho} href="/atleta/conta"><Image src="/figma/pessoal/pessoa.svg" alt="" width={24} height={24} /><span><strong>Minha foto</strong><small>{card?.possuiFoto ? "Consultar ou atualizar foto" : "Nenhuma foto enviada"}</small></span><Image src="/figma/pessoal/chevron.svg" alt="" width={20} height={20} /></Link>
    </aside>
    </div>
    <EstadoConsulta {...consulta} rotulo="Atualizar carteirinha" atualizar={() => { void consulta.carregar(); void registros.carregar(); }} />
    <Dialogo aberto={ampliado && !!card && card.status === "ativa"} aoFechar={() => setAmpliado(false)} tituloId={tituloId} focoInicial={fechar}>
      <div className={`${pagina.detalhe} ${pessoal.pilha}`}><h2 id={tituloId} className={pagina.secaoTitulo}>QR da minha carteirinha</h2>
        {card && <><p className={pagina.texto}>{card.nomeCompleto}</p>{card.status === "ativa" && <Qr token={card.tokenQr} ampliado />}<p className={styles.codigo}>{card.codigo}</p></>}
        {offline && <p className={controles.nota}>Sem conexão. A validade precisa ser conferida online.</p>}
        {consulta.erro && <p className={controles.nota}>A última atualização falhou. Feche e atualize a carteirinha para conferir o QR vigente.</p>}
        <button ref={fechar} className={controles.secundario} onClick={() => setAmpliado(false)}>Fechar QR ampliado</button>
      </div>
    </Dialogo>
  </div>;
}
