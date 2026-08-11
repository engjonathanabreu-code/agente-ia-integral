import { handleIncomingMessage } from "../lib/agent.js";

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      service: "Agente IA Integral",
      enabled: process.env.AI_ENABLED !== "false",
    });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const expectedToken = process.env.WEBHOOK_TOKEN;
  const receivedToken = req.query?.token;

  if (!expectedToken || receivedToken !== expectedToken) {
    return sendJson(res, 401, { error: "Webhook não autorizado." });
  }

  if (process.env.AI_ENABLED === "false") {
    return sendJson(res, 200, { ok: true, ignored: true, reason: "ai_disabled" });
  }

  const payload = req.body;

  console.log("Webhook Chatwoot recebido", {
    event: payload?.event,
    message_type: payload?.message_type,
    private: payload?.private,
    conversation_id: payload?.conversation?.id,
    has_content: Boolean(payload?.content),
  });

  if (!payload || payload.event !== "message_created") {
    return sendJson(res, 200, { ok: true, ignored: true, reason: "event_not_supported" });
  }

  const isIncoming =
    payload.message_type === "incoming" ||
    payload.message_type === 0 ||
    payload.message_type === "0";

  if (!isIncoming) {
    console.log("Webhook ignorado: message_type não é incoming", {
      event: payload.event,
      message_type: payload.message_type,
      conversation_id: payload?.conversation?.id,
    });
    return sendJson(res, 200, { ok: true, ignored: true, reason: "not_incoming" });
  }

  if (payload.private === true) {
    return sendJson(res, 200, { ok: true, ignored: true, reason: "private_message" });
  }

  try {
    const result = await handleIncomingMessage(payload);
    console.log("Agente IA processou mensagem", result);
    return sendJson(res, 200, { ok: true, result });
  } catch (error) {
    console.error("Erro no Agente IA Integral:", error);
    return sendJson(res, 500, {
      ok: false,
      error: "Falha ao processar atendimento.",
      detail: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}
