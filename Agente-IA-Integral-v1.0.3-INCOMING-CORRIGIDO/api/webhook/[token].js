import {
  handleConversationStatusChanged,
  handleIncomingMessage,
} from "../../lib/agent.js";


/*
============================================
CONTROLE DE DUPLICIDADE
============================================
*/

const processedMessages =
  globalThis.__integralProcessedMessages ||
  new Map();

globalThis.__integralProcessedMessages =
  processedMessages;


const MESSAGE_TTL_MS =
  10 * 60 * 1000;


function cleanupProcessedMessages() {
  const now =
    Date.now();


  for (
    const [id, timestamp]
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


function reserveMessage(
  messageId
) {

  if (!messageId) {
    return true;
  }


  cleanupProcessedMessages();


  const key =
    String(messageId);


  if (
    processedMessages.has(
      key
    )
  ) {
    return false;
  }


  /*
  Reserva imediatamente.

  Dessa forma, uma segunda execução
  da mesma mensagem encontra o ID
  antes de chamar a IA.
  */

  processedMessages.set(
    key,
    Date.now()
  );


  return true;
}


function releaseMessage(
  messageId
) {

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


export default async function handler(
  req,
  res
) {

  /*
  ============================================
  GET
  ============================================
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

        deduplication:
          true,
      }
    );
  }


  /*
  ============================================
  SOMENTE POST
  ============================================
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
  ============================================
  TOKEN
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


  /*
  ============================================
  IA ATIVADA?
  ============================================
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

        ignored:
          true,

        reason:
          "ai_disabled",
      }
    );
  }


  /*
  ============================================
  PAYLOAD
  ============================================
  */

  const payload =
    req.body;


  if (!payload) {

    return sendJson(
      res,
      200,
      {
        ok: true,

        ignored:
          true,

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
        payload?.conversation?.display_id,

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
          ok:
            false,

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

        ignored:
          true,

        reason:
          "event_not_supported",
      }
    );
  }


  /*
  ============================================
  CONFIRMA QUE VEIO DO CLIENTE
  ============================================
  */

  const isIncoming =
    payload.message_type ===
      "incoming" ||
    payload.message_type ===
      0 ||
    payload.message_type ===
      "0";


  if (!isIncoming) {

    console.log(
      "Webhook ignorado: message_type não é incoming",
      {
        event:
          payload.event,

        message_id:
          payload?.id,

        message_type:
          payload.message_type,

        conversation_id:
          payload?.conversation?.id,
      }
    );


    return sendJson(
      res,
      200,
      {
        ok:
          true,

        ignored:
          true,

        reason:
          "not_incoming",
      }
    );
  }


  /*
  ============================================
  NOTA PRIVADA
  ============================================
  */

  if (
    payload.private === true
  ) {

    return sendJson(
      res,
      200,
      {
        ok:
          true,

        ignored:
          true,

        reason:
          "private_message",
      }
    );
  }


  /*
  ============================================
  DEDUPLICAÇÃO PELO MESSAGE.ID
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
          ok:
            true,

          ignored:
            true,

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
  EXECUTA O AGENTE
  ============================================
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

        conversation_id:
          payload?.conversation?.id,

        result,
      }
    );


    return sendJson(
      res,
      200,
      {
        ok:
          true,

        result,

        message_id:
          messageId,
      }
    );

  } catch (error) {

    /*
    Libera o ID somente se o processamento
    realmente falhar.

    Assim uma nova tentativa do Chatwoot
    pode executar novamente.
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
        ok:
          false,

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
