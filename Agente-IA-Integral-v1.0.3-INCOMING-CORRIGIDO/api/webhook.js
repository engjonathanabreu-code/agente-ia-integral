import {
  handleConversationStatusChanged,
  handleIncomingMessage,
} from "../lib/agent.js";

function sendJson(res, status, data) {
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

  if (req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      service: "Agente IA Integral",
      enabled:
        process.env.AI_ENABLED !== "false",
    });
  }


  if (req.method !== "POST") {
    return sendJson(
      res,
      405,
      {
        error: "Method not allowed",
      }
    );
  }


  const expectedToken =
    process.env.WEBHOOK_TOKEN;

  const receivedToken =
    req.query?.token;


  if (
    !expectedToken ||
    receivedToken !== expectedToken
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
    process.env.AI_ENABLED === "false"
  ) {
    return sendJson(
      res,
      200,
      {
        ok: true,
        ignored: true,
        reason: "ai_disabled",
      }
    );
  }


  const payload = req.body;


  console.log(
    "Webhook Chatwoot recebido",
    {
      event: payload?.event,

      message_type:
        payload?.message_type,

      private:
        payload?.private,

      conversation_id:
        payload?.conversation?.id ||
        payload?.id,

      status:
        payload?.conversation?.status ||
        payload?.status,

      has_content:
        Boolean(payload?.content),
    }
  );


  if (!payload) {
    return sendJson(
      res,
      200,
      {
        ok: true,
        ignored: true,
        reason: "empty_payload",
      }
    );
  }


  /*
  MUDANÇA DE STATUS
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
  OUTROS EVENTOS
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
  GARANTE QUE A MENSAGEM
  VEIO DO CLIENTE
  */

  const isIncoming =
    payload.message_type ===
      "incoming" ||
    payload.message_type === 0 ||
    payload.message_type === "0";


  if (!isIncoming) {

    console.log(
      "Webhook ignorado: message_type não é incoming",
      {
        event: payload.event,

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
        ok: true,
        ignored: true,
        reason: "not_incoming",
      }
    );
  }


  /*
  NÃO PROCESSAR NOTA PRIVADA
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


  try {

    const result =
      await handleIncomingMessage(
        payload
      );

    console.log(
      "Agente IA processou mensagem",
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
