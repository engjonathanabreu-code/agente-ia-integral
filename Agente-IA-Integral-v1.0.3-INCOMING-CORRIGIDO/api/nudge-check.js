import {
  getConversation,
  listConversations,
  sendMessage,
  updateConversationAttributes,
} from "../lib/chatwoot.js";

import { getScheduleState } from "../lib/businessHours.js";


/*
============================================
REGRA DE INATIVIDADE — 30 MINUTOS
============================================

Só entra em ação quando TODAS as condições
abaixo forem verdadeiras:

- a conversa está com status "open" (aberta,
  não resolvida);
- a conversa já foi encaminhada para um
  atendente/equipe humana (não está mais
  "presa" no fluxo do agente IA);
- a ÚLTIMA mensagem da conversa é do cliente
  — se a última mensagem foi enviada por nós
  (humano ou a própria IA), a regra não dispara.

Quando essas condições valem e o cliente fica
30+ minutos sem resposta de um humano, a IA:

1. Durante o horário comercial (Seg a Sex,
   08h-18h): envia um aviso pedindo paciência
   por causa do fluxo de atendimentos, e
   repete a cada 30 minutos enquanto o
   cliente continuar sem resposta.

2. Ao final do expediente (mesmo dia útil,
   após as 18h): envia, uma única vez, um
   pedido de desculpas informando que o
   atendimento será agilizado no dia seguinte.

Fora do horário comercial (antes das 8h,
depois da meia-noite, ou fim de semana) a
regra fica em silêncio até o próximo período
válido.
*/

const NUDGE_THRESHOLD_MS = 30 * 60 * 1000;
const NUDGE_INTERVAL_MS = 30 * 60 * 1000;

const NUDGE_MESSAGE =
  "Olá! Estamos com um grande fluxo de atendimentos no momento e pedimos a sua paciência — em breve um de nossos atendentes continua a sua conversa. Obrigado por aguardar! 🙏";

const END_OF_DAY_MESSAGE =
  "Encerramos o nosso horário de atendimento por hoje e pedimos desculpas por não termos concluído o seu atendimento. Estamos com um grande fluxo de clientes, mas amanhã vamos agilizar e dar continuidade à sua conversa assim que possível. Obrigado pela compreensão!";


function json(res, status, body) {
  res.statusCode = status;

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.end(JSON.stringify(body, null, 2));
}


function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data?.payload)) return value.data.payload;
  if (Array.isArray(value?.payload)) return value.payload;
  return [];
}


function totalCount(value) {
  return Number(
    value?.data?.meta?.all_count ??
      value?.meta?.all_count ??
      0
  );
}


function isFromIntegralAi(message) {
  return Boolean(message?.content_attributes?.integral_ai);
}


function isClientMessage(message) {
  return message?.message_type === 0;
}


function isHumanAgentMessage(message) {
  return message?.message_type === 1 && !isFromIntegralAi(message);
}


function wasHandedOffToHuman(conversation) {
  const attrs = conversation?.custom_attributes || {};

  return (
    attrs.ia_atendimento_concluido === true ||
    attrs.ia_etapa === "encaminhado"
  );
}


/*
Conversa precisa estar de fato com um time ou
agente humano — não apenas ter passado pelo
fluxo da IA em algum momento. Se não há equipe
nem agente atribuído, ela ainda está "parada"
no agente IA e não deve receber cutucada.
*/

function hasHumanOwner(conversation) {
  return Boolean(
    conversation?.meta?.team?.id ||
      conversation?.team?.id ||
      conversation?.meta?.assignee?.id ||
      conversation?.assignee?.id
  );
}


/*
A conversa precisa estar aberta (não resolvida,
não parada/snoozed).
*/

function isOpenConversation(conversation) {
  return conversation?.status === "open";
}


/*
Busca todas as conversas de um status,
paginando quando necessário.
*/

async function fetchAllConversations(status) {
  const results = [];
  let page = 1;

  while (page <= 10) {
    const response = await listConversations({ status, page });
    const items = asArray(response);

    results.push(...items);

    const all = totalCount(response);

    if (!items.length || results.length >= all) break;

    page += 1;
  }

  return results;
}


async function processConversation(conversationSummary, scheduleState) {
  if (!wasHandedOffToHuman(conversationSummary)) {
    return null;
  }

  const conversation = await getConversation(conversationSummary.id);
  const attrs = conversation?.custom_attributes || {};

  /*
  Confirma no objeto completo da conversa (não
  só no resumo da listagem) que ela está aberta
  e realmente com um time/agente humano.
  */

  if (!isOpenConversation(conversation)) return null;
  if (!hasHumanOwner(conversation)) return null;

  const messages = Array.isArray(conversation?.messages)
    ? [...conversation.messages]
    : [];

  messages.sort(
    (a, b) => (a.created_at || 0) - (b.created_at || 0)
  );

  const lastMessage = messages[messages.length - 1];

  if (!lastMessage) return null;


  /*
  Um atendente humano já respondeu — se havia
  estado de "cutucada" pendente, limpa e sai.
  */

  if (isHumanAgentMessage(lastMessage)) {
    if (attrs.ia_ultima_cutucada_em || attrs.ia_fim_expediente_avisado_em) {
      await updateConversationAttributes(conversation.id, {
        ia_ultima_cutucada_em: "",
        ia_fim_expediente_avisado_em: "",
      });

      return { id: conversation.id, action: "reset" };
    }

    return null;
  }


  /*
  Última mensagem não é do cliente (ex.: só há
  mensagens da própria IA ainda) — nada a fazer.
  */

  if (!isClientMessage(lastMessage)) return null;


  const waitingSinceMs = (lastMessage.created_at || 0) * 1000;
  const waitingMs = Date.now() - waitingSinceMs;

  if (waitingMs < NUDGE_THRESHOLD_MS) return null;


  /*
  Dentro do horário comercial: cutucada
  recorrente a cada 30 minutos.
  */

  if (scheduleState.open) {
    const lastNudgeAt = attrs.ia_ultima_cutucada_em
      ? new Date(attrs.ia_ultima_cutucada_em).getTime()
      : 0;

    if (Date.now() - lastNudgeAt < NUDGE_INTERVAL_MS) return null;

    await sendMessage(conversation.id, NUDGE_MESSAGE);

    await updateConversationAttributes(conversation.id, {
      ia_ultima_cutucada_em: new Date().toISOString(),
    });

    return { id: conversation.id, action: "nudge" };
  }


  /*
  Fim do expediente do dia útil: pedido de
  desculpas único, deduplicado pela data
  (fuso de São Paulo).
  */

  if (scheduleState.justClosed) {
    if (attrs.ia_fim_expediente_avisado_em === scheduleState.dateKey) {
      return null;
    }

    await sendMessage(conversation.id, END_OF_DAY_MESSAGE);

    await updateConversationAttributes(conversation.id, {
      ia_fim_expediente_avisado_em: scheduleState.dateKey,
    });

    return { id: conversation.id, action: "end_of_day" };
  }


  /*
  Fora do horário comercial (antes das 8h ou
  fim de semana) — aguarda o próximo período.
  */

  return null;
}


export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  const token =
    req.query?.token ||
    String(req.headers["x-nudge-token"] || "");

  if (
    !process.env.NUDGE_CRON_TOKEN ||
    token !== process.env.NUDGE_CRON_TOKEN
  ) {
    return json(res, 401, { ok: false, error: "Não autorizado." });
  }

  try {
    const scheduleState = getScheduleState(new Date());

    /*
    Só nos interessam conversas "open" (abertas,
    não resolvidas). "pending"/"snoozed" ficam
    de fora da regra.
    */

    const conversations = await fetchAllConversations("open");

    const results = [];
    const errors = [];

    for (const conversation of conversations) {
      try {
        const outcome = await processConversation(conversation, scheduleState);

        if (outcome) results.push(outcome);
      } catch (error) {
        errors.push({
          id: conversation?.id,
          error: error?.message || String(error),
        });
      }
    }

    return json(res, 200, {
      ok: true,
      schedule: scheduleState,
      scanned: conversations.length,
      actions: results,
      errors,
    });
  } catch (error) {
    console.error("Erro no nudge-check:", error);

    return json(res, 500, {
      ok: false,
      error: error?.message || "Erro desconhecido.",
      status: error?.status,
      detail: error?.data,
    });
  }
}
