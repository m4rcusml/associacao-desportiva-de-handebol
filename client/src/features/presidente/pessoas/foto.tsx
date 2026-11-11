"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import { enviarFoto, lerFoto, TIPOS_FOTO, validarArquivo } from "./foto-api";
import styles from "./pessoa.module.css";

type Estado = { tipo: "carregando" } | { tipo: "falha"; mensagem: string } | { tipo: "sem-foto" } | { tipo: "pronta"; foto: Blob };

/** Imagem de um arquivo local: a URL temporária é criada no DOM e revogada quando o arquivo muda ou sai da página. */
function ImagemBlob({ blob, alt, className }: { blob: Blob; alt: string; className: string }) {
  const imagem = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    if (imagem.current) imagem.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  // Blob local de URL temporária: next/image não se aplica.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={imagem} alt={alt} className={className} />;
}

/** Foto privada do atleta: lida pela API com a sessão (sem URL pública) e enviada como corpo binário. */
export function Foto({ atletaId, nome }: { atletaId: string; nome: string }) {
  const tratarErro = useErroApi();
  const [foto, setFoto] = useState<Blob | null>(null);
  const [estado, setEstado] = useState<"carregando" | "pronto" | { falha: string }>("carregando");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erroArquivo, setErroArquivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState("");
  const entrada = useRef<HTMLInputElement>(null);
  const consulta = useRef(0);
  const envio = useRef(false);

  const carregar = useCallback(() => {
    const versao = ++consulta.current;
    lerFoto(atletaId)
      .then(blob => { if (versao === consulta.current) { setFoto(blob); setEstado("pronto"); } })
      .catch(falha => { if (versao === consulta.current) setEstado({ falha: tratarErro(falha) }); });
  }, [atletaId, tratarErro]);

  const invalidarConsulta = useCallback(() => { consulta.current++; }, []);
  useEffect(() => { carregar(); return invalidarConsulta; }, [carregar, invalidarConsulta]);

  const vista: Estado = estado === "carregando" ? { tipo: "carregando" }
    : typeof estado === "object" ? { tipo: "falha", mensagem: estado.falha }
      : foto ? { tipo: "pronta", foto } : { tipo: "sem-foto" };

  function escolher(lista: FileList | null) {
    const escolhido = lista?.[0] ?? null;
    setAviso("");
    if (!escolhido) { setArquivo(null); setErroArquivo(""); return; }
    const problema = validarArquivo(escolhido);
    setErroArquivo(problema);
    setArquivo(problema ? null : escolhido);
  }

  function cancelar() {
    setArquivo(null);
    setErroArquivo("");
    if (entrada.current) entrada.current.value = "";
    entrada.current?.focus();
  }

  async function enviar() {
    if (!arquivo || envio.current) return;
    envio.current = true;
    consulta.current++;
    setEnviando(true);
    setErroArquivo("");
    try {
      const { substituida } = await enviarFoto(atletaId, arquivo);
      // Mostra o próprio arquivo aceito, sem nova leitura: o servidor confirmou o mesmo conteúdo.
      setFoto(arquivo);
      setEstado("pronto");
      setArquivo(null);
      if (entrada.current) entrada.current.value = "";
      setAviso(substituida ? "Foto substituída." : "Foto enviada.");
    } catch (falha) {
      setErroArquivo(tratarErro(falha));
    } finally {
      envio.current = false;
      setEnviando(false);
    }
  }

  const temFoto = vista.tipo === "pronta";

  return (
    <section className={pagina.secao} aria-labelledby="secao-foto">
      <h2 id="secao-foto" className={`${pagina.secaoTitulo} ${pagina.erroDecisao}`}>Foto</h2>
      <div className={styles.foto}>
        <div className={styles.moldura}>
          {vista.tipo === "carregando" && <p className={pagina.carregando} role="status">Carregando foto…</p>}
          {vista.tipo === "sem-foto" && <p className={styles.semFoto}>Sem foto</p>}
          {vista.tipo === "falha" && <p className={styles.semFoto}>Foto indisponível</p>}
          {vista.tipo === "pronta" && <ImagemBlob blob={vista.foto} alt={`Foto de ${nome}`} className={styles.imagem} />}
        </div>

        <div className={styles.envio}>
          {vista.tipo === "falha" && (
            <>
              <p className={controles.erro} role="alert">{vista.mensagem}</p>
              <button type="button" className={controles.secundario} onClick={() => { setEstado("carregando"); carregar(); }}>Tentar novamente</button>
            </>
          )}
          <div className={controles.campo}>
            <label className={controles.rotulo} htmlFor="arquivo-foto">{temFoto ? "Substituir a foto" : "Enviar foto"}</label>
            <p className={controles.ajuda} id="ajuda-foto">JPEG, PNG ou WebP, até 4 MB. A foto é privada: veem presidentes, o próprio atleta, o técnico do clube atual e a arbitragem dos jogos em que ele estiver escalado ou credenciado.</p>
            <input
              ref={entrada}
              id="arquivo-foto"
              className={controles.arquivo}
              type="file"
              accept={TIPOS_FOTO.join(",")}
              aria-describedby="ajuda-foto"
              onChange={e => escolher(e.target.files)}
              disabled={enviando}
            />
          </div>
          {erroArquivo && <p className={controles.erro} role="alert">{erroArquivo}</p>}
          {arquivo && (
            <div className={styles.previa}>
              <ImagemBlob blob={arquivo} alt="Prévia da foto escolhida" className={styles.imagemPrevia} />
              <div className={pagina.acoes}>
                <button type="button" className={controles.primario} onClick={enviar} disabled={enviando}>
                  {enviando ? "Enviando…" : temFoto ? "Substituir foto" : "Enviar foto"}
                </button>
                <button type="button" className={controles.secundario} onClick={cancelar} disabled={enviando}>Cancelar</button>
              </div>
            </div>
          )}
          <p className={pagina.aviso} role="status">{aviso}</p>
        </div>
      </div>
    </section>
  );
}
