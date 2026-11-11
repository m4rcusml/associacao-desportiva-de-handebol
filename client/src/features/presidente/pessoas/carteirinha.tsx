"use client";

import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import type { AlteracaoCarteirinha, DetalheCarteirinha, EventoCarteirinha } from "../../../lib/presidente";
import { Confirmacao } from "../../ui/confirmacao";
import { data } from "../../ui/formatos";
import { conflito, status, useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import { useSessaoPresidente } from "../shell";
import { CLASSE_CARTEIRINHA, NOME_CARTEIRINHA } from "./nomes";
import styles from "./pessoa.module.css";

type Operacao = "invalidar" | "reativar" | "substituir";
type Estado = { tipo: "carregando" } | { tipo: "falha"; mensagem: string } | { tipo: "ausente" } | { tipo: "pronta"; carteirinha: DetalheCarteirinha };

const NOME_EVENTO: Record<EventoCarteirinha["tipo"], string> = {
  invalidacao: "Invalidada",
  reativacao: "Reativada",
  substituicao_qr: "QR substituído",
};

const OPERACAO = {
  invalidar: {
    rota: "invalidacao", titulo: "Invalidar a carteirinha?", rotulo: "Invalidar carteirinha", tom: "perigo",
    texto: "A carteirinha deixa de valer no credenciamento até ser reativada. O código e o QR continuam os mesmos.",
  },
  reativar: {
    rota: "reativacao", titulo: "Reativar a carteirinha?", rotulo: "Reativar carteirinha", tom: "aprovar",
    texto: "A carteirinha volta a valer no credenciamento, com o mesmo código e o QR atual.",
  },
  substituir: {
    rota: "substituicao-qr", titulo: "Substituir o QR?", rotulo: "Substituir QR", tom: "perigo",
    texto: "Um novo QR é gerado e o atual deixa de identificar a carteirinha. Use quando o QR foi perdido ou exposto. O código e a situação da carteirinha não mudam.",
  },
} as const;

/** Carteirinha do atleta aprovado: consulta, QR vigente, invalidação, reativação, substituição do QR e histórico. */
export function Carteirinha({ atletaId, revisao }: { atletaId: string; revisao: number }) {
  const tratarErro = useErroApi();
  const { sessao } = useSessaoPresidente();
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [mostrarQr, setMostrarQr] = useState(false);
  const [operacao, setOperacao] = useState<Operacao | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [erroLeitura, setErroLeitura] = useState("");
  const consulta = useRef(0);
  const envio = useRef(false);

  const carregar = useCallback(() => {
    const versao = ++consulta.current;
    api<DetalheCarteirinha>(`/carteirinhas/atleta/${atletaId}`)
      .then(carteirinha => { if (versao === consulta.current) { setEstado({ tipo: "pronta", carteirinha }); setErroLeitura(""); } })
      .catch(falha => { if (versao === consulta.current) { setErroLeitura(tratarErro(falha)); setEstado(atual => atual.tipo === "pronta" ? atual : status(falha) === 404 ? { tipo: "ausente" } : { tipo: "falha", mensagem: tratarErro(falha) }); } });
  }, [atletaId, tratarErro]);

  // `revisao` muda após transferência: o clube atual exibido precisa ser relido.
  const invalidarConsulta = useCallback(() => { consulta.current++; }, []);
  useEffect(() => { carregar(); return invalidarConsulta; }, [carregar, revisao, invalidarConsulta]);

  async function confirmar(carteirinha: DetalheCarteirinha, op: Operacao) {
    if (envio.current) return;
    envio.current = true;
    consulta.current++;
    setEnviando(true);
    setErro("");
    try {
      // A substituição informa a versão vista: um pedido repetido não troca o QR duas vezes.
      const corpo = op === "substituir" ? { versaoQr: carteirinha.versaoQr } : {};
      const { carteirinha: atual, alterado } = await api<AlteracaoCarteirinha>(`/carteirinhas/atleta/${atletaId}/${OPERACAO[op].rota}`, corpo);
      setEstado({ tipo: "pronta", carteirinha: atual });
      if (op === "substituir") {
        setMostrarQr(true);
        setAviso(alterado ? `QR substituído. Versão ${atual.versaoQr} em vigor; mostre o novo QR ao atleta.` : `O QR já havia sido substituído. Versão ${atual.versaoQr} em vigor.`);
      } else {
        setAviso(alterado ? `Carteirinha ${atual.status === "ativa" ? "reativada" : "invalidada"}.` : `Nada mudou: a carteirinha já estava ${atual.status}.`);
      }
      setOperacao(null);
    } catch (falha) {
      setErro(tratarErro(falha));
      if (conflito(falha) || status(falha) === 404) carregar();
    } finally {
      envio.current = false;
      setEnviando(false);
    }
  }

  function abrir(op: Operacao) {
    setErro("");
    setAviso("");
    setOperacao(op);
  }

  return (
    <section className={pagina.secao} aria-labelledby="secao-carteirinha">
      <div className={pagina.secaoTopo}>
        <h2 id="secao-carteirinha" className={pagina.secaoTitulo}>Carteirinha</h2>
        {estado.tipo === "pronta" && (
          <span className={`${controles.status} ${CLASSE_CARTEIRINHA[estado.carteirinha.status]}`}>{NOME_CARTEIRINHA[estado.carteirinha.status]}</span>
        )}
      </div>

      {estado.tipo === "pronta" && erroLeitura && <p className={controles.erro} role="alert">{erroLeitura} A última carteirinha confirmada foi mantida. <button type="button" className={controles.secundario} onClick={carregar}>Atualizar carteirinha</button></p>}

      {estado.tipo === "carregando" && <p className={pagina.carregando} role="status">Carregando carteirinha…</p>}
      {estado.tipo === "ausente" && <p className={pagina.secaoTexto}>Carteirinha ainda não emitida. Ela é emitida na aprovação do cadastro.</p>}
      {estado.tipo === "falha" && (
        <>
          <p className={controles.erro} role="alert">{estado.mensagem}</p>
          <button type="button" className={`${controles.secundario} ${pagina.acaoVazio}`} onClick={() => { setEstado({ tipo: "carregando" }); carregar(); }}>Tentar novamente</button>
        </>
      )}

      {estado.tipo === "pronta" && (() => {
        const c = estado.carteirinha;
        return (
          <>
            <dl className={pagina.ficha}>
              <div><dt>Código</dt><dd>{c.codigo}</dd></div>
              <div><dt>Situação</dt><dd>{NOME_CARTEIRINHA[c.status]}</dd></div>
              <div><dt>Clube atual</dt><dd>{c.clubeAtual?.nome ?? "Sem clube"}</dd></div>
              <div><dt>Emitida</dt><dd>{data(c.emitidaEm)}</dd></div>
              <div><dt>Versão do QR</dt><dd>{c.versaoQr}</dd></div>
            </dl>

            <p className={pagina.aviso} role="status">{aviso}</p>

            <div className={pagina.acoes}>
              <button type="button" className={controles.secundario} aria-expanded={mostrarQr} aria-controls="qr-carteirinha" onClick={() => setMostrarQr(m => !m)}>
                {mostrarQr ? "Ocultar QR" : "Mostrar QR"}
              </button>
              {c.status === "ativa"
                ? <button type="button" className={controles.rejeitar} onClick={() => abrir("invalidar")}>Invalidar carteirinha</button>
                : <button type="button" className={controles.aprovar} onClick={() => abrir("reativar")}>Reativar carteirinha</button>}
              <button type="button" className={controles.secundario} onClick={() => abrir("substituir")}>Substituir QR</button>
            </div>

            <div id="qr-carteirinha" hidden={!mostrarQr}>
              {mostrarQr && (
                <figure className={styles.qr}>
                  <QRCodeSVG value={c.tokenQr} size={224} marginSize={4} level="M" title={`QR da carteirinha ${c.codigo}, versão ${c.versaoQr}`} />
                  <figcaption className={styles.qrLegenda}>
                    <strong>{c.nomeCompleto}</strong>
                    <span>Carteirinha {c.codigo}, QR versão {c.versaoQr}</span>
                    {c.status === "invalidada" && <span className={controles.textoAlerta}>Carteirinha invalidada: não vale no credenciamento.</span>}
                  </figcaption>
                </figure>
              )}
              {mostrarQr && <p className={pagina.secaoTexto}>O QR só identifica a carteirinha; não dá acesso à conta. Mostre-o ao atleta e oculte em seguida.</p>}
            </div>

            <h3 className={pagina.subtitulo}>Histórico da carteirinha</h3>
            {c.historico.length === 0 ? (
              <p className={pagina.secaoTexto}>Sem invalidações, reativações ou substituições desde a emissão.</p>
            ) : (
              <ol className={styles.eventos}>
                {[...c.historico].reverse().map(e => (
                  <li key={`${e.tipo}-${e.versaoQr}-${e.ocorridoEm}`}>
                    <span className={styles.eventoNome}>{NOME_EVENTO[e.tipo]}{e.tipo === "substituicao_qr" ? `, versão ${e.versaoQr}` : ""}</span>
                    <span className={styles.eventoMeta}>
                      <time dateTime={e.ocorridoEm}>{data(e.ocorridoEm)}</time>, {e.presidenteId === sessao.usuario.id ? "por você" : "por outro presidente"}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <Confirmacao
              aberto={operacao !== null}
              titulo={operacao ? OPERACAO[operacao].titulo : ""}
              rotulo={operacao ? OPERACAO[operacao].rotulo : ""}
              tom={operacao ? OPERACAO[operacao].tom : "primario"}
              enviando={enviando}
              erro={erro}
              aoConfirmar={() => operacao && confirmar(c, operacao)}
              aoFechar={() => setOperacao(null)}
            >
              {operacao && <p className={pagina.confirmacaoTexto}>{OPERACAO[operacao].texto}</p>}
            </Confirmacao>
          </>
        );
      })()}
    </section>
  );
}
