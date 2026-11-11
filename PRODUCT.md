# Associação Desportiva de Handebol

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Presidente, técnicos e atletas possuem áreas permanentes. Arbitragem é uma função temporária de um jogo. Neste redesenho no Figma, Marcus confirmou em 10/11/2026: priorizar a mesa nos registros; linha acompanha e também pode registrar, com as mesmas permissões. Depois de aprovar a simplificação da arbitragem, solicitou estender facilidade de uso, recursos visuais e caminhos curtos à visão do presidente.

## Product Purpose

Organizar clubes, atletas, campeonatos e jogos. Na arbitragem, conferir participantes e preservar um registro correto da partida com poucos passos e identificação inequívoca de clube e camisa.

## Operating Context

Interface web responsiva, celular prioritário e visão ampla para mesa. Uso em ginásio, múltiplos dispositivos e internet obrigatória. Iluminação variável, ruído e pressão são hipóteses de contexto da proto-persona, ainda sem pesquisa em quadra.

## Capabilities and Constraints

Regras e escopo têm suas fontes em docs/requisitos.md, docs/GLOSSARY.md, docs/arquitetura.md e docs/pendencias.md. Escalação, credenciamento e registro de entrada são etapas distintas. Não há controle de substituições nem cronômetro oficial. Linha/banco alteram a apresentação, não permissões. Encerramento revoga o acesso; o dispositivo que encerra conserva o recibo retornado, e correções posteriores cabem ao presidente.

## Brand Commitments

Marcus autorizou descartar a identidade anterior no Figma e estender a direção de ginásio à arbitragem, presidente, atleta, técnico e acesso, mantendo facilidade de uso e recursos visuais. Após os redesenhos, pediu a especificação e um prompt de orquestração para implementar o novo frontend, integrar à main e disponibilizar no ambiente de teste para validação com o cliente. A referência dessa implementação é docs/frontend.md. A etapa documental não implementa a aplicação nem altera o backend.

## Evidence on Hand

Protótipo Figma gwHYKm5u7V8uP1lXBmxPPG, página 4:6; docs/persona-arbitragem.md e docs/insights.md. Nomes e partidas do protótipo são fictícios. Não há entrevistas ou testes com árbitros reais documentados.

## Product Principles

- Identificar clube, atleta e camisa antes de registrar.
- Dar prioridade ao registro na mesa sem retirar autonomia da linha.
- Mostrar confirmação, incerteza de envio e recuperação de erros.
- Distinguir uma entrada já registrada de presença atual em quadra.
- Conferir resultado antes de retirar o acesso ao jogo.
