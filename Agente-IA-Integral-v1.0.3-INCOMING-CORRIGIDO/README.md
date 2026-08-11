# Agente IA Integral

Agente de atendimento inicial da Integral Soluções em Engenharia.

## O que esta versão faz

1. Recebe eventos `message_created` do Chatwoot.
2. Atua somente sobre mensagens `incoming`.
3. Solicita nome completo.
4. Solicita cidade.
5. Identifica o setor por número, palavras-chave ou OpenAI.
6. Encaminha a conversa para a equipe correta no Chatwoot.
7. Para de responder depois do encaminhamento para que o humano assuma.

Setores:

- Atendimento
- Comercial
- Financeiro
- Projetos
- Topografia
- Pós-Protocolo

Esta versão **não consulta o CRM ainda**. A integração futura com Supabase/CRM pode ser adicionada sem refazer a conexão Chatwoot ↔ agente.

## Modelo OpenAI

O modelo padrão configurado é `gpt-5.6-luna`, adequado ao alto volume e à classificação simples desta primeira versão. Pode ser trocado pela variável `OPENAI_MODEL`.

A integração usa a Responses API oficial através do SDK `openai`.

## Publicação rápida na Vercel

1. Crie um repositório Git com estes arquivos ou importe a pasta diretamente na Vercel.
2. Configure as variáveis do `.env.example` em **Project Settings → Environment Variables**.
3. Faça o deploy.
4. Atualize `APP_URL` com a URL de produção, por exemplo:
   `https://agente-ia-integral.vercel.app`
5. Faça novo deploy após alterar `APP_URL`.
6. Execute o setup uma única vez:

```bash
curl -X POST "https://SEU-PROJETO.vercel.app/api/setup" \
  -H "Authorization: Bearer SEU_SETUP_SECRET"
```

O setup:
- cria os atributos de conversa usados pela IA;
- cria as seis equipes no Chatwoot se não existirem;
- cria o webhook `message_created` apontando para o agente.

## Variáveis necessárias

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna

CHATWOOT_BASE_URL=https://seu-chatwoot
CHATWOOT_ACCOUNT_ID=
CHATWOOT_API_TOKEN=

WEBHOOK_TOKEN=
SETUP_SECRET=
APP_URL=https://seu-projeto.vercel.app

AI_ENABLED=true
```

### CHATWOOT_API_TOKEN

Use um token de acesso de um administrador do Chatwoot com permissão para:
- ler conversas;
- criar mensagens;
- atualizar custom attributes;
- listar/criar equipes;
- atribuir conversas;
- criar webhooks.

## Segurança

- Nunca coloque `OPENAI_API_KEY` ou `CHATWOOT_API_TOKEN` em código do navegador.
- `WEBHOOK_TOKEN` protege a URL que recebe eventos do Chatwoot.
- `SETUP_SECRET` protege a rota administrativa `/api/setup`.
- Depois do setup, você pode manter `/api/setup` protegido ou trocar o `SETUP_SECRET`.
- Para pausar a IA sem remover o webhook, defina `AI_ENABLED=false`.

## Teste

Depois do setup, mande uma mensagem de outro WhatsApp.

Fluxo esperado:

Cliente: `Olá`

Agente: solicita nome completo.

Cliente: `João da Silva`

Agente: solicita cidade.

Cliente: `Taió`

Agente: apresenta os seis setores.

Cliente: `quero segunda via do boleto`

A OpenAI/roteador classifica como `Financeiro`, o Chatwoot atribui a conversa ao time Financeiro e o agente informa que a equipe continuará o atendimento.

## Próxima evolução

Na segunda fase:
- consultar cliente pelo telefone no Supabase;
- vincular conversa ao cliente do CRM;
- consultar Projeto/Núcleo e Andamentos;
- registrar interações do Chatwoot no CRM;
- permitir respostas de Pós-Protocolo baseadas em `visivel_ia=true`.


## v1.0.1
Compatibilidade ampliada com respostas de API do Chatwoot self-hosted/Elestio que envolvem listas em `payload`, `data` ou chaves nomeadas. O `/api/setup` permanece idempotente.


## v1.0.2
O webhook agora usa token no caminho (`/api/webhook/<token>`) em vez de query string. Isso melhora compatibilidade com validação de URL do Chatwoot self-hosted.


## v1.0.3
Corrigido o reconhecimento de mensagens recebidas do Chatwoot: aceita `message_type` como `incoming`, `0` ou `"0"`. Adicionados logs de diagnóstico do webhook.
