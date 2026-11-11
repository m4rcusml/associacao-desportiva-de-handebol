"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Dialogo } from "../ui/dialogo";
import controles from "../ui/controles.module.css";
import pagina from "../ui/pagina.module.css";
import styles from "./camera-qr.module.css";

type Props = { ativo: boolean; aoLer: (token: string) => void; aoCancelar: () => void };
type Detector = { detect: (video: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorNativo = { new (opcoes: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

function mensagemCamera(falha: unknown) {
  const nome = falha instanceof Error ? falha.name : "";
  if (nome === "NotAllowedError" || nome === "SecurityError") return "A câmera não foi autorizada. Você pode permitir o acesso no navegador ou selecionar o atleta na lista.";
  if (nome === "NotFoundError" || nome === "OverconstrainedError") return "Não encontramos uma câmera disponível. Selecione o atleta na lista para credenciar.";
  if (nome === "NotReadableError") return "A câmera está em uso ou indisponível. Feche o outro aplicativo ou selecione o atleta na lista.";
  return "Não foi possível usar a câmera. Tente novamente ou selecione o atleta na lista.";
}

function Leitor({ aoLer, aoCancelar }: Omit<Props, "ativo">) {
  const video = useRef<HTMLVideoElement>(null);
  const retorno = useRef(aoLer);
  const fluxo = useRef<MediaStream | null>(null);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("Preparando a câmera…");
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => { retorno.current = aoLer; }, [aoLer]);

  useEffect(() => {
    let encerrado = false;
    let quadro: ReturnType<typeof setTimeout> | undefined;
    let entregue = false;
    const canvas = document.createElement("canvas");
    const contexto = canvas.getContext("2d", { willReadFrequently: true });

    function parar() {
      fluxo.current?.getTracks().forEach(trilha => trilha.stop());
      fluxo.current = null;
      if (video.current) video.current.srcObject = null;
    }

    async function iniciar() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !contexto) {
        setErro("Este navegador não oferece acesso à câmera nesta conexão. Selecione o atleta na lista; para usar a câmera, abra a aplicação em uma conexão segura.");
        return;
      }
      let detector: Detector | null = null;
      const Nativo = (window as unknown as { BarcodeDetector?: DetectorNativo }).BarcodeDetector;
      if (Nativo) {
        try {
          const formatos = await Nativo.getSupportedFormats?.();
          if (!formatos || formatos.includes("qr_code")) detector = new Nativo({ formats: ["qr_code"] });
        } catch { /* A leitura local abaixo atende navegadores sem suporte ao detector nativo. */ }
      }
      let decodificar: (typeof import("jsqr"))["default"] | null = null;
      if (!detector) decodificar = (await import("jsqr")).default;
      if (encerrado) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (encerrado) { stream.getTracks().forEach(trilha => trilha.stop()); return; }
      fluxo.current = stream;
      const elemento = video.current;
      if (!elemento) { parar(); return; }
      elemento.srcObject = stream;
      await elemento.play();
      if (encerrado) return;
      setMensagem("Aponte a câmera para o QR da carteirinha. A leitura não salva imagens.");

      async function ler() {
        if (encerrado || entregue) return;
        try {
          if (elemento!.readyState >= 2 && elemento!.videoWidth > 0) {
            let token: string | null = null;
            if (detector) {
              try { token = (await detector.detect(elemento!))[0]?.rawValue ?? null; }
              catch { detector = null; decodificar = (await import("jsqr")).default; }
            } else if (decodificar) {
              const escala = Math.min(1, 720 / Math.max(elemento!.videoWidth, elemento!.videoHeight));
              canvas.width = Math.round(elemento!.videoWidth * escala);
              canvas.height = Math.round(elemento!.videoHeight * escala);
              contexto!.drawImage(elemento!, 0, 0, canvas.width, canvas.height);
              const imagem = contexto!.getImageData(0, 0, canvas.width, canvas.height);
              token = decodificar(imagem.data, imagem.width, imagem.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
            }
            if (encerrado) return;
            if (token) {
              if (token.length > 256 || !token.trim()) {
                setErro("O QR lido não corresponde a uma identificação válida. Aponte para a carteirinha ou use a lista de atletas.");
              } else {
                entregue = true;
                parar();
                retorno.current(token.trim());
                return;
              }
            }
          }
          if (!encerrado) quadro = setTimeout(() => { void ler(); }, 200);
        } catch (falha) { if (!encerrado) { parar(); setErro(mensagemCamera(falha)); } }
      }
      void ler();
    }

    void iniciar().catch(falha => { if (!encerrado) { parar(); setErro(mensagemCamera(falha)); } });
    return () => { encerrado = true; clearTimeout(quadro); parar(); };
  }, [tentativa]);

  return <div className={styles.leitor}>
    <video ref={video} className={styles.video} muted playsInline autoPlay aria-label="Câmera para ler a carteirinha" />
    {!erro && <p className={pagina.texto} role="status">{mensagem}</p>}
    {erro && <><p className={controles.nota} role="alert">{erro}</p><button type="button" className={controles.secundario} onClick={() => { setErro(""); setMensagem("Preparando a câmera…"); setTentativa(atual => atual + 1); }}>Tentar câmera novamente</button></>}
    <button type="button" className={controles.secundario} onClick={aoCancelar}>Usar lista de atletas</button>
  </div>;
}

/** Não guarda imagem/token; o pai fecha aoLer e o backend decide a identificação e o credenciamento. */
export function CameraQr({ ativo, aoLer, aoCancelar }: Props) {
  const titulo = useId();
  const fechar = useRef<HTMLButtonElement>(null);
  return <Dialogo aberto={ativo} aoFechar={aoCancelar} tituloId={titulo} focoInicial={fechar}>
    <div className={`${pagina.detalhe} ${styles.conteudo}`}>
      <div className={pagina.detalheTopo}><h2 id={titulo} className={pagina.detalheNome}>Ler carteirinha pela câmera</h2>
        <button ref={fechar} type="button" className={controles.secundario} onClick={aoCancelar}>Fechar câmera</button></div>
      {ativo && <Leitor aoLer={aoLer} aoCancelar={aoCancelar} />}
    </div>
  </Dialogo>;
}
