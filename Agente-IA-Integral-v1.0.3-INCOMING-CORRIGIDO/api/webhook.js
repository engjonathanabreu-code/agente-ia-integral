import {
  handleConversationStatusChanged,
  handleIncomingMessage,
} from "../lib/agent.js";

import { guardIntakeMessage } from "../lib/intake-guard.js";


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


/*
Remove IDs antigos para não deixar
a memória crescer indefinidamente.
*/

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


/*
Tenta reservar uma mensagem.

Retorna:
true  = pode processar
false = já foi recebida/processada
*/

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

  /*
  Reserva ANTES de chamar a IA.

  Isso é importante porque impede
  duas chamadas quase simultâneas
  dentro da mesma instância.
  */

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


export default async function handler(
  req,
  res
) {

  /*
  ============================================
  GET / HEALTH
  ============================================
  */

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


  /*
  ============================================
  SEGURANÇA
  ============================================
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


  /*
  ============================================
  STATUS DA CONVERSA
  ============================================
  */

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


  /*
  ============================================
  SOMENTE MESSAGE_CREATED
  ============================================
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
  ============================================
  SOMENTE MENSAGEM DO CLIENTE
  ============================================
  */

  const isIncoming =
    payload.message_type ===
      "incoming" ||
    payload.message_type === 0 ||
    payload.message_type ===
      "0";


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


  /*
  ============================================
  IGNORA NOTAS PRIVADAS
  ============================================
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
  ============================================
  DEDUPLICAÇÃO
  ============================================
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
  ============================================
  PROCESSAMENTO DA IA
  ============================================
  */

  try {

    const guarded = await guardIntakeMessage(payload);

    const result = guarded ||
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

    /*
    Se deu erro real, removemos a reserva
    para permitir que uma tentativa futura
    processe novamente a mensagem.
    */

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
