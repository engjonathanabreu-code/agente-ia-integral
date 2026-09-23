# Controle do atendimento — setembro de 2026

As duas URLs do webhook usam um processador único. Cada evento autenticado é
registrado no Supabase; uma reserva de 120 segundos permite apenas um worker por
conversa. A função Vercel mantém seu limite de 60 segundos, menor que a reserva.
Mensagens públicas de texto próximas são reunidas após 1,2 segundo, ordenadas por
data/ID. Os originais são arquivados individualmente. Áudios, anexos e notas
privadas permanecem separados.

Mensagens humanas interrompem a IA durante qualquer etapa. A atribuição automática
sozinha não interrompe. Antes de enviar há nova leitura do histórico, inclusive
para avisos fora do webhook. Resolver permite um novo atendimento e preserva a
identidade já coletada. Respostas a templates continuam com o agente de origem.

Atribuições precisam ser confirmadas no Chatwoot antes da mensagem de sucesso.
Falhas mantêm a solicitação pendente, sem marcar atendimento concluído.

## Operação

Aplicar as migrações antes do deploy. O coordenador usa a mesma credencial servidor
`INTEGRACAO_SUPABASE_SECRET` (ou o fallback existente), mesmo se o arquivamento for
pausado. Não há nova chave a configurar. Os oito núcleos auditados estão habilitados;
a equipe deve cadastrar andamentos e marcar `visivel_ia` apenas após aprovação.
Nenhum conteúdo de andamento foi inventado ou liberado por esta alteração.

Erros sem efeitos externos devolvem 503 para nova tentativa. Se o processo morrer
ou falhar depois de uma gravação/envio, o evento vai para `review`, em vez de
repetir uma resposta cuja entrega é incerta. Essa escolha evita duplicação, mas
exige conferência humana desses casos. O diagnóstico autenticado
`/api/integracao-admin` lista `revisoes_ia`; o banco mantém o original e o motivo.
Uma mensagem seguinte também permite drenar eventos pendentes. Não há cron novo.
Não é possível prometer entrega exatamente uma vez entre dois serviços sem uma
chave de idempotência suportada pelo destino; a reserva, os IDs das ações e a
revisão de entregas incertas tratam essa limitação conservadoramente.

Tabelas/RPC da fila são acessíveis somente por `service_role`, com RLS ativa.
O conteúdo não fica disponível a `anon` ou `authenticated`.

## Verificação

`npm test` roda testes offline de banco PostgreSQL (PGlite), concorrência,
idempotência, interrupção humana durante geração, transferências ausentes/com
erro/não confirmadas, identificação, andamento, privacidade, templates e retorno.
Nenhum teste envia mensagem a cliente nem chama o modelo real. O CI repete os
mesmos testes em cada pull request e push em main.

Rollback: reverter o código para a versão anterior; as tabelas novas podem ser
mantidas para preservar os registros. Não excluir a fila para fazer rollback.
