import {
  handleConversationStatusChanged,
  handleIncomingMessage,
} from "../lib/agent.js";

import { guardIntakeMessage } from "../lib/intake-guard.js";
import {
  assignConversationToAgent,
  getConversationMessages,
} from "../lib/chatwoot.js";


/*
============================================
CONTROLE DE DUPLICIDADE
============================================

Guarda IDs de mensagens processadas recentemente.

Em ambiente serverless isso funciona como
proteção local da instância e evita grande
parte dos reenvios imediatos do Chatwoot.
*/

const processedMessages =
  globalThis.__integralProcessedMessages ||
  new Map();

globalThis.__integralProcessedMessages =
  processedMessages;


const MESSAGE_TTL_MS =
  10 * 60 * 1000;


function cleanupProcessedMessages() {
  const now = Date.now();

  for (
    const [id, timestamp]
    of processedMessages.entries()
  ) {
    if (
      now - timestamp >
      MESSAGE_TTL_MS
    ) {
      processedMessages.delete(id);
    }
  }
}


function reserveMessage(messageId) {
  if (!messageId) {
    return true;
  }

  cleanupProcessedMessages();

  const key =
    String(messageId);

  if (
    processedMessages.has(key)
  ) {
    return false;
  }

  processedMessages.set(
    key,
    Date.now()
  );

  return true;
}


function releaseMessage(messageId) {
  if (!messageId) {
    return;
  }

  processedMessages.delete(
    String(messageId)
  );
}


function sendJson(
  res,
  status,
  data
) {
  res.statusCode = status;

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.end(
    JSON.stringify(data)
  );
}


function isIncomingMessage(message) {
  return (
    message?.message_type === "incoming" ||
    message?.message_type === 0 ||
    message?.message_type === "0"
  );
}


function isTemplateMessage(message) {
  return (
    message?.message_type === "template" ||
    message?.message_type === 3 ||
    message?.message_type === "3"
  );
}


function isActivityMessage(message) {
  return (
    message?.message_type === "activity" ||
    message?.message_type === 2 ||
    message?.message_type === "2"
  );
}


/*
============================================
RETORNO DE TEMPLATE PARA AGENTE HUMANO
============================================

Quando um agente inicia o contato usando um template,
a resposta do cliente não deve iniciar o fluxo da IA.

A regra procura a mensagem imediatamente anterior do
atendimento. Se ela for um template enviado por um
usuário humano, a conversa é atribuída diretamente ao
mesmo agente e o processamento da IA termina ali.
*/

async function routeTemplateReplyToHuman(payload) {
  const conversationId =
    payload?.conversation?.id ||
    payload?.conversation_id;

  if (!conversationId) {
    return null;
  }

  const history =
    await getConversationMessages(
      conversationId
    );

  const messages =
    Array.isArray(history?.payload)
      ? history.payload
      : Array.isArray(history)
        ? history
        : [];

  if (!messages.length) {
    return null;
  }

  const currentMessageId =
    String(payload?.id || "");

  const ordered =
    [...messages].sort((a, b) => {
      const timeA = Number(a?.created_at || 0);
      const timeB = Number(b?.created_at || 0);

      if (timeA !== timeB) {
        return timeA - timeB;
      }

      return Number(a?.id || 0) - Number(b?.id || 0);
    });

  let currentIndex =
    ordered.findIndex(
      (message) =>
        String(message?.id || "") ===
        currentMessageId
    );

  if (currentIndex < 0) {
    currentIndex = ordered.length;
  }

  for (
    let index = currentIndex - 1;
    index >= 0;
    index -= 1
  ) {
    const previous = ordered[index];

    if (isActivityMessage(previous)) {
      continue;
    }

    /*
    Se já existiu outra mensagem do cliente depois do
    template, não tratamos a mensagem atual como uma
    resposta direta ao contato iniciado pelo agente.
    */
    if (isIncomingMessage(previous)) {
      return null;
    }

    /*
    Mensagens geradas pela própria IA nunca podem ser
    usadas para descobrir um agente humano.
    */
    if (
      previous?.content_attributes?.integral_ai === true
    ) {
      return null;
    }

    if (!isTemplateMessage(previous)) {
      return null;
    }

    const assigneeId =
      previous?.sender?.id ||
      previous?.sender_id;

    if (!assigneeId) {
      return null;
    }

    await assignConversationToAgent(
      conversationId,
      assigneeId
    );

    console.log(
      "Resposta de template encaminhada ao agente humano",
      {
        conversation_id: conversationId,
        incoming_message_id: payload?.id,
        template_message_id: previous?.id,
        assignee_id: assigneeId,
      }
    );

    return {
      handled: true,
      reason: "template_reply_to_human_agent",
      conversation_id: conversationId,
      template_message_id: previous?.id,
      assignee_id: Number(assigneeId),
    };
  }

  return null;
}


export default async function handler(
  req,
  res
) {

  if (req.method === "GET") {
    return sendJson(
      res,
      200,
      {
        ok: true,
        service:
          "Agente IA Integral",
        enabled:
          process.env.AI_ENABLED !==
          "false",
        deduplication:
          true,
      }
    );
  }


  if (req.method !== "POST") {
    return sendJson(
      res,
      405,
      {
        error:
          "Method not allowed",
      }
    );
  }


  const expectedToken =
    process.env.WEBHOOK_TOKEN;

  const receivedToken =
    String(
      req.query?.token ||
      ""
    );


  if (
    !expectedToken ||
    receivedToken !==
      expectedToken
  ) {
    return sendJson(
      res,
      401,
      {
        error:
          "Webhook não autorizado.",
      }
    );
  }


  if (
    process.env.AI_ENABLED ===
    "false"
  ) {
    return sendJson(
      res,
      200,
      {
        ok: true,
        ignored: true,
        reason:
          "ai_disabled",
      }
    );
  }


  const payload =
    req.body;


  if (!payload) {
    return sendJson(
      res,
      200,
      {
        ok: true,
        ignored: true,
        reason:
          "empty_payload",
      }
    );
  }


  console.log(
    "Webhook Chatwoot recebido",
    {
      event:
        payload?.event,

      message_id:
        payload?.id,

      message_type:
        payload?.message_type,

      private:
        payload?.private,

      conversation_id:
        payload?.conversation?.id ||
        payload?.conversation?.display_id ||
        payload?.id,

      status:
        payload?.conversation?.status ||
        payload?.status,

      has_content:
        Boolean(
          payload?.content
        ),
    }
  );


  if (
    payload.event ===
    "conversation_status_changed"
  ) {

    try {

      const result =
        await handleConversationStatusChanged(
          payload
        );


      console.log(
        "Status da conversa processado",
        result
      );


      return sendJson(
        res,
        200,
        {
          ok: true,
          result,
        }
      );

    } catch (error) {

      console.error(
        "Erro ao processar status da conversa:",
        error
      );


      return sendJson(
        res,
        500,
        {
          ok: false,

          error:
            "Falha ao processar status da conversa.",

          detail:
            process.env.NODE_ENV ===
            "development"
              ? error.message
              : undefined,
        }
      );
    }
  }


  if (
    payload.event !==
    "message_created"
  ) {
    return sendJson(
      res,
      200,
      {
        ok: true,
        ignored: true,
        reason:
          "event_not_supported",
      }
    );
  }


  const isIncoming =
    isIncomingMessage(payload);


  if (!isIncoming) {

    console.log(
      "Webhook ignorado: mensagem não é incoming",
      {
        message_id:
          payload?.id,

        message_type:
          payload?.message_type,

        conversation_id:
          payload?.conversation?.id,
      }
    );


    return sendJson(
      res,
      200,
      {
        ok: true,
        ignored: true,
        reason:
          "not_incoming",
      }
    );
  }


  if (
    payload.private === true
  ) {
    return sendJson(
      res,
      200,
      {
        ok: true,
        ignored: true,
        reason:
          "private_message",
      }
    );
  }


  const messageId =
    payload?.id;


  if (messageId) {

    const reserved =
      reserveMessage(
        messageId
      );


    if (!reserved) {

      console.log(
        "Mensagem duplicada ignorada",
        {
          message_id:
            messageId,

          conversation_id:
            payload?.conversation?.id,
        }
      );


      return sendJson(
        res,
        200,
        {
          ok: true,

          ignored: true,

          reason:
            "duplicate_message",

          message_id:
            messageId,
        }
      );
    }
  }


  try {

    /*
    Esta verificação acontece ANTES de qualquer etapa da IA.
    Assim, uma resposta a template humano não recebe saudação,
    pedido de nome, cidade ou menu de setores.
    */
    const humanTemplateRoute =
      await routeTemplateReplyToHuman(
        payload
      );

    if (humanTemplateRoute) {
      return sendJson(
        res,
        200,
        {
          ok: true,
          result: humanTemplateRoute,
          message_id: messageId,
        }
      );
    }


    const guarded =
      await guardIntakeMessage(payload);

    const result =
      guarded ||
      await handleIncomingMessage(
        payload
      );


    console.log(
      "Agente IA processou mensagem",
      {
        message_id:
          messageId,

        result,
      }
    );


    return sendJson(
      res,
      200,
      {
        ok: true,
        result,
        message_id:
          messageId,
      }
    );

  } catch (error) {

    releaseMessage(
      messageId
    );


    console.error(
      "Erro no Agente IA Integral:",
      error
    );


    return sendJson(
      res,
      500,
      {
        ok: false,

        error:
          "Falha ao processar atendimento.",

        detail:
          process.env.NODE_ENV ===
          "development"
            ? error.message
            : undefined,
      }
    );
  }
}
