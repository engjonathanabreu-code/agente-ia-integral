import {assignConversationToAgent,getConversationMessages} from './chatwoot.js';
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

export async function routeTemplateReplyToHuman(payload) {
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


