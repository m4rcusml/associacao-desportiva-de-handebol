const resposta = (description: string) => ({ description });
const uuid = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
const binario = { schema: { type: "string", format: "binary" } };
const imagem = { "image/jpeg": binario, "image/png": binario, "image/webp": binario };
const indisponivel = { "503": resposta("Armazenamento de fotos indisponível ou não configurado; a foto atual é preservada") };

/** Contrato das fotos privadas dos atletas (MAR-75), incluído em `GET /api/openapi.json`. */
export const openapiFotos = {
  "/atletas/{atletaId}/foto": {
    put: {
      summary: "O próprio atleta ou um presidente envia ou substitui a foto opcional (JPEG, PNG ou WebP, até 4 MB = 4 × 1024 × 1024 bytes), enviada como corpo binário. O conteúdo real é conferido e deve corresponder ao Content-Type. Não exige nem altera a aprovação. O arquivo vai ao Storage privado antes da troca no banco: falha no envio ou na persistência preserva a foto atual",
      security: [{ sessionCookie: [] }], parameters: [uuid("atletaId")],
      requestBody: { required: true, content: imagem },
      responses: {
        "200": resposta("atletaId, foto (tipo, tamanho em bytes) e substituida (true quando havia foto anterior). Não devolve chave nem URL"),
        "400": resposta("UUID inválido ou corpo vazio"),
        "401": resposta("Sessão ou cadastro indisponível"),
        "403": resposta("Conta que não é o próprio atleta nem presidente, ou origem não autorizada"),
        "404": resposta("Atleta não encontrado"),
        "413": resposta("Arquivo acima de 4 MB"),
        "415": resposta("Content-Type diferente de image/jpeg, image/png ou image/webp, conteúdo que não é imagem válida desses formatos ou divergente do Content-Type"),
        ...indisponivel,
      },
    },
    get: {
      summary: "Foto do atleta, somente para o próprio atleta, presidentes e o técnico atual (aprovado) do clube atual do atleta. Resposta sem cache (Cache-Control: no-store) e com X-Content-Type-Options: nosniff",
      security: [{ sessionCookie: [] }], parameters: [uuid("atletaId")],
      responses: {
        "200": { description: "Conteúdo da foto", content: imagem },
        "400": resposta("UUID inválido"),
        "401": resposta("Sessão ou cadastro indisponível"),
        "403": resposta("Sem permissão para a foto deste atleta (sem revelar se ele existe)"),
        "404": resposta("Atleta sem foto (ou, para o presidente, atleta não encontrado)"),
        ...indisponivel,
      },
    },
  },
  "/arbitragem/jogos/{jogoId}/atletas/{atletaId}/foto": {
    get: {
      summary: "Foto do atleta escalado ou credenciado no jogo, para a arbitragem com sessão temporária válida desse jogo. O QR não concede acesso à foto",
      security: [{ arbitragemCookie: [] }], parameters: [uuid("jogoId"), uuid("atletaId")],
      responses: {
        "200": { description: "Conteúdo da foto", content: imagem },
        "400": resposta("UUID inválido"),
        "401": resposta("Sessão de arbitragem ausente, revogada ou expirada"),
        "403": resposta("Acesso do jogo fora do período, ou atleta não escalado nem credenciado neste jogo"),
        "404": resposta("Atleta sem foto"),
        ...indisponivel,
      },
    },
  },
};
