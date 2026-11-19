# Consulta de andamento: correção local

Base: `4471c8276bbcd401c80988c72de41c238772b799` (também confirmado no deploy de produção durante diagnóstico somente-leitura).

## Defeito reproduzido

A frase sintética “Gostaria de saber como anda o processo de escritura” não era reconhecida por `isAndamentoIntent`. Na etapa necessidade/esclarecimento caía no classificador, em vez da consulta oficial com confirmação de identidade. A coleta inicial não roda nessas etapas. Isso reproduz o caminho observado no caso801 sem executar conversa real.

## Mudança limitada

- Amplia o detector por padrões específicos de consulta natural; não trata apenas “processo” ou “escritura” como consulta.
- Aproveita `tryAnswerProgress` e as validações de identidade/contexto existentes. Ao pedir documento, conserva texto/intenção para retomar após confirmação.
- Mantém pedido humano e atendente ativo com precedência. Etapa motivo depois da escolha de humano continua sem consulta automática; motivo sem setor selecionado pode consultar com as mesmas validações.
- Resposta determinística com campos oficiais e data de atualização; não transmite instruções do núcleo/orientações a modelo nem as mostra ao cliente. Sem prazo inventado. Sem campos oficiais úteis, segue encaminhamento existente.
- Representante já sinalizado ou referência explícita a familiar/terceiro na consulta segue revisão de Atendimento antes de qualquer RPC; não responde pelo cadastro do interlocutor.
- Erro de RPC segue um único encaminhamento verificado ao Atendimento. Sem expor erro bruto.

## Verificação

`npm run check` aprovado. `npm test`:120/120, incluindo15 cenários novos no arquivo progress-intent.test.js. Cobertura: necessidade/esclarecimento/motivo genérico, frase801/variantes (“em que pé”, “novidade da matrícula”), referência a terceiro, identidade pendente e retomada, identidade não confirmada, sem contexto/andamento liberado, precedência humana, motivo de humano, privacidade e erroRPC. Os testes usam fetch mock e fixtures locais; nenhuma mensagem ou RPC real.

Não há scripts de lint/typecheck/build no package.json além de check/test. Sem browser: mudança exclusiva de servidor. Sem flags, configuração, migração, SQL remoto, push, PR ou deploy. O pipeline remoto pode criar preview com credenciais reais; não publicar sem coordenação.

Rollback de código: reverter este commit. Não há dados ou schema para reverter. Permanece a obrigação de revisão independente antes de publicação. Suíte completa comprova os cenários existentes, não todas as possibilidades de linguagem natural.
