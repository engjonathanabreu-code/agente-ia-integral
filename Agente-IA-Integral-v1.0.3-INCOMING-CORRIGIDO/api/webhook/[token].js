import {
  handleConversationStatusChanged,
  handleIncomingMessage,
} from "../../lib/agent.js";

import {
  handleAgentPresentation,
  resetAgentPresentation,
} from "../../lib/presentation.js";


/*
============================================
DEDUPLICAÇÃO LOCAL DE MENSAGENS
============================================
*/

const processedMessages =
  globalThis.__integralProcessedMessages ||
  new Map();


globalThis.__integralProcessedMessages =
  processedMessages;


const MESSAGE_TTL_MS =
  10 * 60 * 1000;


/*
============================================
LIMPEZA
============================================
*/

function cleanupProcessedMessages() {

  const now =
    Date.now();


  for (
    const [
      id,
      timestamp,
    ]
    of processedMessages.entries()
  ) {

    if (
      now - timestamp >
      MESSAGE_TTL_MS
    ) {

      processedMessages.delete(
        id
      );
    }
  }
}


/*
============================================
RESERVA MESSAGE ID
============================================
*/

function reserveMessage(
  messageId
) {

  if (!messageId) {
    return true;
  }


  cleanupProcessedMessages();


  const key =
    String(
      messageId
    );


  if (
    processedMessages.has(
      key
    )
  ) {
    return false;
  }


  processedMessages.set(
    key,
    Date.now()
  );


  return true;
}


/*
============================================
LIBERA MESSAGE ID
============================================
*/

function releaseMessage(
  messageId
) {

  if (!messageId) {
    return;
  }


  processedMessages.delete(
    String(
      messageId
    )
  );
}


/*
============================================
JSON
============================================
*/

function sendJson(
  res,
  status,
  data
) {

  res.statusCode =
    status;


  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );


  res.end(
    JSON.stringify(
      data
    )
  );
}


/*
============================================
HANDLER PRINCIPAL
============================================
*/

export default async function handler(
  req,
  res
) {

  /*
  ===========================================
  HEALTH
  ===========================================
  */

  if (
    req.method === "GET"
  ) {

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

        presentation:
          true,

        deduplication:
          true,
      }
    );
  }


  /*
  ===========================================
  SOMENTE POST
  ===========================================
  */

  if (
    req.method !== "POST"
  ) {

    return sendJson(
      res,
      405,
      {
        error:
          "Method not allowed",
      }
    );
  }


  /*
  ===========================================
  TOKEN
  ===========================================
  */

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


  /*
  ===========================================
  IA ATIVA?
  ===========================================
  */

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


  /*
  ===========================================
  PAYLOAD
  ===========================================
  */

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

      conversation_id:
        payload?.conversation?.id ||
        (
          payload?.event
            ?.startsWith(
              "conversation_"
            )
            ? payload?.id
            : undefined
        ),

      status:
        payload?.conversation?.status ||
        payload?.status,

      changed_attributes:
        payload?.changed_attributes,
    }
  );


  /*
  ===========================================
  CONVERSATION UPDATED
  ===========================================

  Aqui acontece a apresentação
  humana quando o agente é atribuído.
  */

  if (
    payload.event ===
    "conversation_updated"
  ) {

    try {

      const result =
        await handleAgentPresentation(
          payload
        );


      console.log(
        "Conversation updated processada",
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
        "Erro na apresentação do agente:",
        error
      );


      return sendJson(
        res,
        500,
        {
          ok: false,

          error:
            "Falha ao processar apresentação do agente.",

          detail:
            process.env.NODE_ENV ===
            "development"
              ? error.message
              : undefined,
        }
      );
    }
  }


  /*
  ===========================================
  STATUS ALTERADO
  ===========================================
  */

  if (
    payload.event ===
    "conversation_status_changed"
  ) {

    try {

      /*
      Rearma a IA para retorno futuro.
      */

      const aiResult =
        await handleConversationStatusChanged(
          payload
        );


      /*
      Também libera apresentação
      humana para uma futura sessão.
      */

      const presentationResult =
        await resetAgentPresentation(
          payload
        );


      console.log(
        "Status da conversa processado",
        {
          aiResult,
          presentationResult,
        }
      );


      return sendJson(
        res,
        200,
        {
          ok: true,

          ai:
            aiResult,

          presentation:
            presentationResult,
        }
      );


    } catch (error) {

      console.error(
        "Erro ao processar status:",
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


  /*
  ===========================================
  SOMENTE MESSAGE CREATED
  ===========================================
  */

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


  /*
  ===========================================
  SOMENTE MENSAGEM DO CLIENTE
  ===========================================
  */

  const isIncoming =
    payload.message_type ===
      "incoming" ||

    payload.message_type ===
      0 ||

    payload.message_type ===
      "0";


  if (!isIncoming) {

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


  /*
  ===========================================
  IGNORA NOTA PRIVADA
  ===========================================
  */

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


  /*
  ===========================================
  DEDUPLICAÇÃO
  ===========================================
  */

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


  /*
  ===========================================
  PROCESSA IA
  ===========================================
  */

  try {

    const result =
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
