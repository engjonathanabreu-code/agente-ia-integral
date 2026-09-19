# Chatwoot e Integração

O projeto Vercel `crm-integral-andamentos_1` recebe o webhook existente e registra todos os eventos suportados no Supabase `ycdsyilyvaxslkwbkxyo`. Não é necessário criar um segundo bot nem um segundo webhook para a IA.

Configuração de servidor:

- `INTEGRACAO_ENABLED=true` ativa gravação e consultas ao Integração. `false` preserva o fluxo anterior.
- `INTEGRACAO_SUPABASE_SECRET`: chave de servidor do Supabase do Integração, armazenada como Secret, somente Production. Aceita secret key moderna ou service role legada. O fallback `ERP_SUPABASE_SERVICE_ROLE_KEY` só funciona se pertencer ao mesmo projeto e estiver válido.
- `INTEGRACAO_ADMIN_SECRET`: segredo dedicado do diagnóstico e configuração administrativa.
- Chatwoot e OpenAI usam as variáveis protegidas já existentes. Não exponha valores nem URLs contendo tokens em logs, commits ou respostas.

Depois de salvar uma variável, publicar novamente. Validar `GET /api/integracao-admin` com autenticação Bearer administrativa. A resposta deve mostrar `banco_conectado=true`, o host e a conta corretos, um único webhook do agente e o mapeamento dos comerciais. `POST` com `action=configure` adiciona apenas mapeamentos únicos ainda ausentes e garante os quatro eventos no webhook existente. Casos sem correspondência precisam de associação manual no CRM.

Para validar sem enviar mensagens a clientes, `POST` com `action=reconcile` e `conversation_id` reprocessa a conversa e a página recente de mensagens disponíveis no Chatwoot. Repetir não duplica IDs. Isso não é importação integral do histórico antigo.

O webhook deve arquivar mensagens antes dos filtros da IA, inclusive saídas humanas e notas privadas. Falha de persistência responde 503 para permitir reenvio. A IA não atua em mensagens de saída, privadas ou após encaminhamento humano. Para manutenção da conexão, pausar com `INTEGRACAO_ENABLED=false` e republicar antes de modificar credenciais.

Nome e cidade extraídos ficam nos atributos da conversa. Somente a função de servidor `integracao_crm_identificar` decide o vínculo por dados exatos e telefone de origem. Ambiguidades pedem correção até duas vezes e então seguem para Atendimento. Nenhuma inferência altera cadastros.

A consulta de andamento exige identidade confirmada, núcleo habilitado e `visivel_ia=true`. O modelo recebe a descrição autorizada e instruções daquele núcleo; nunca recebe `observacao_interna`.

Validação local: `npm test` e `npm run check`. Testes SQL e permissões ficam no repositório Integração.
