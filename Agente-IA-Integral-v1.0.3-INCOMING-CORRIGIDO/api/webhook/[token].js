import {
  handleConversationStatusChanged,
  handleIncomingMessage,
} from "../../lib/agent.js";

import {
  handleAgentPresentation,
  resetAgentPresentation,
} from "../../lib/presentation.js";

import {
  updateConversationAttributes,
} from "../../lib/chatwoot.js";


/*
============================================
DEDUPLICAÇÃO LOCAL
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
  res.statusCode = status;

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.end(
    JSON.stringify(data)
  );
}


/*
============================================
RESET DE NOVA CONVERSA
============================================
*/

async function resetNewConversation(
  payload
) {
  const conversationId =
    payload?.id ||
    payload?.conversation?.id ||
    payload?.display_id;

  if (!conversationId) {
    return {
      ignored: true,
      reason:
        "conversation_id_missing",
    };
  }


  /*
  IMPORTANTE:
  Limpa somente atributos da sessão de IA.

  Nome e cidade também são limpos porque
  trata-se de uma conversa realmente nova.
  */

  await updateConversationAttributes(
    conversationId,
    {
      ia_etapa:
        "inicio",

      ia_nome:
        "",

      ia_cidade:
        "",

      ia_setor:
        "",

      ia_motivo_contato:
        "",

      ia_atendimento_concluido:
        false,

      ia_agente_apresentado:
        "",
    }
  );


  console.log(
    "Nova conversa preparada para IA",
    {
      conversation_id:
        conversationId,
    }
  );


  return {
    reset: true,
    stage:
      "inicio",
  };
}


/*
============================================
HANDLER
============================================
*/

export default async function handler(
  req,
  res
) {

  /*
  HEALTH
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
        conversation_reset:
          true,
      }
    );
  }


  /*
  SOMENTE POST
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
  TOKEN
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
  IA ATIVA?
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
          String(
            payload?.event ||
            ""
          ).startsWith(
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
  ============================================
  NOVA CONVERSA
  ============================================
  */

  if (
    payload.event ===
    "conversation_created"
  ) {
    try {
      const result =
        await resetNewConversation(
          payload
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
        "Erro ao preparar nova conversa:",
        error
      );

      return sendJson(
        res,
        500,
        {
          ok: false,
          error:
            "Falha ao preparar nova conversa.",
        }
      );
    }
  }


  /*
  ============================================
  CONVERSA ATUALIZADA
  ============================================
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
        }
      );
    }
  }


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
      const aiResult =
        await handleConversationStatusChanged(
          payload
        );

      const presentationResult =
        await resetAgentPresentation(
          payload
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
  SOMENTE CLIENTE
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
  NOTA PRIVADA
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
  DEDUPLICAÇÃO
  */

  const messageId =
    payload?.id;


  if (messageId) {
    const reserved =
      reserveMessage(
        messageId
      );

    if (!reserved) {
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
  IA
  */

  try {
    const result =
      await handleIncomingMessage(
        payload
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
      }
    );
  }
}
