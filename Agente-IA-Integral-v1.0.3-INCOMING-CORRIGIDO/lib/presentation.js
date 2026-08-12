import {
  getConversation,
  sendMessage,
  updateConversationAttributes,
} from "./chatwoot.js";


/*
============================================
NORMALIZA TEXTO
============================================
*/

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}


/*
============================================
ID DA CONVERSA
============================================
*/

function getConversationId(payload) {
  return (
    payload?.conversation?.id ||
    payload?.id ||
    payload?.conversation?.display_id ||
    null
  );
}


/*
============================================
DETECTA MUDANÇA DE RESPONSÁVEL
============================================

O Chatwoot envia conversation_updated com
changed_attributes.

Nós só queremos agir quando a atribuição
do agente realmente mudou.
*/

function hasAssigneeChange(payload) {
  const changes =
    Array.isArray(
      payload?.changed_attributes
    )
      ? payload.changed_attributes
      : [];


  for (const change of changes) {
    if (
      !change ||
      typeof change !== "object"
    ) {
      continue;
    }


    const keys =
      Object.keys(change);


    const changed =
      keys.some((key) => {

        const normalized =
          normalize(key);


        return (
          normalized ===
            "assignee_id" ||

          normalized ===
            "assignee" ||

          normalized ===
            "assigned_agent_id" ||

          normalized.includes(
            "assignee"
          )
        );
      });


    if (changed) {
      return true;
    }
  }


  return false;
}


/*
============================================
LOCALIZA AGENTE
============================================
*/

function extractAssignee(
  conversation,
  payload
) {
  const candidates = [
    conversation?.meta?.assignee,

    conversation?.assignee,

    payload?.meta?.assignee,

    payload?.conversation?.meta
      ?.assignee,

    payload?.assignee,
  ];


  for (const candidate of candidates) {

    if (
      candidate &&
      candidate.id
    ) {
      return candidate;
    }
  }


  return null;
}


/*
============================================
NOME DO AGENTE
============================================
*/

function getAgentName(
  assignee
) {
  return (
    assignee?.name ||
    assignee?.available_name ||
    assignee?.display_name ||
    "atendente"
  );
}


/*
============================================
NOME DO SETOR
============================================
*/

function getSectorName(
  conversation,
  attrs
) {
  return (
    attrs?.ia_setor ||
    conversation?.meta?.team?.name ||
    conversation?.team?.name ||
    "Atendimento"
  );
}


/*
============================================
APRESENTAÇÃO HUMANA
============================================
*/

export async function handleAgentPresentation(
  payload
) {

  /*
  Somente conversation_updated.
  */

  if (
    payload?.event !==
    "conversation_updated"
  ) {
    return {
      ignored: true,
      reason:
        "event_not_conversation_updated",
    };
  }


  /*
  Só continua se houve alteração
  no responsável.
  */

  if (
    !hasAssigneeChange(
      payload
    )
  ) {
    return {
      ignored: true,
      reason:
        "assignee_not_changed",
    };
  }


  const conversationId =
    getConversationId(
      payload
    );


  if (!conversationId) {
    return {
      ignored: true,
      reason:
        "conversation_id_missing",
    };
  }


  /*
  Busca estado atualizado diretamente
  no Chatwoot.
  */

  const conversation =
    await getConversation(
      conversationId
    );


  const attrs =
    conversation
      ?.custom_attributes ||
    {};


  /*
  IMPORTANTE:

  A apresentação humana somente acontece
  depois que a IA terminou completamente
  a triagem.

  Isso impede:

  setor selecionado
  ↓
  humano se apresenta
  ↓
  IA ainda pergunta o motivo

  que foi o problema anterior.
  */

  const aiFinished =
    attrs
      .ia_atendimento_concluido ===
      true &&
    attrs.ia_etapa ===
      "encaminhado";


  if (!aiFinished) {

    return {
      ignored: true,
      reason:
        "ai_triage_not_finished",

      stage:
        attrs.ia_etapa,
    };
  }


  /*
  Descobre responsável atual.
  */

  const assignee =
    extractAssignee(
      conversation,
      payload
    );


  if (
    !assignee ||
    !assignee.id
  ) {
    return {
      ignored: true,
      reason:
        "no_assignee",
    };
  }


  const agentId =
    String(
      assignee.id
    );


  /*
  Verifica se esse agente já
  se apresentou nessa sessão.
  */

  const alreadyPresented =
    String(
      attrs
        .ia_agente_apresentado ||
      ""
    );


  if (
    alreadyPresented ===
    agentId
  ) {

    return {
      ignored: true,

      reason:
        "agent_already_presented",

      agent_id:
        agentId,
    };
  }


  const agentName =
    getAgentName(
      assignee
    );


  const sector =
    getSectorName(
      conversation,
      attrs
    );


  /*
  ============================================
  RESERVA PRIMEIRO
  ============================================

  Marcamos o agente ANTES de mandar
  a mensagem.

  A própria alteração deste atributo
  pode gerar outro conversation_updated,
  mas ele será ignorado porque não houve
  mudança de assignee.
  */

  await updateConversationAttributes(
    conversationId,
    {
      ...attrs,

      ia_agente_apresentado:
        agentId,
    }
  );


  /*
  ============================================
  ENVIA APRESENTAÇÃO
  ============================================
  */

  try {

    await sendMessage(
      conversationId,
      `Olá! Aqui é o ${agentName}, do setor ${sector} da Integral. Recebi seu atendimento e vou dar continuidade por aqui. 😊`
    );


  } catch (error) {

    /*
    Se o envio falhar,
    libera novamente para uma
    futura tentativa.
    */

    try {

      await updateConversationAttributes(
        conversationId,
        {
          ...attrs,

          ia_agente_apresentado:
            "",
        }
      );

    } catch (
      rollbackError
    ) {

      console.error(
        "Erro ao desfazer reserva de apresentação:",
        rollbackError
      );
    }


    throw error;
  }


  console.log(
    "Agente humano apresentado",
    {
      conversation_id:
        conversationId,

      agent_id:
        agentId,

      agent_name:
        agentName,

      sector,
    }
  );


  return {
    presented:
      true,

    agent_id:
      agentId,

    agent_name:
      agentName,

    sector,
  };
}


/*
============================================
RESET APÓS RESOLVER
============================================

Quando o atendimento é resolvido,
apagamos o agente apresentado.

Assim, se o cliente retornar amanhã
e o mesmo Jonathan assumir novamente,
ele poderá se apresentar de novo.
*/

export async function resetAgentPresentation(
  payload
) {

  const status =
    String(
      payload?.conversation?.status ||
      payload?.status ||
      ""
    )
      .toLowerCase()
      .trim();


  if (
    status !== "resolved"
  ) {
    return {
      ignored: true,
      reason:
        "status_not_resolved",
    };
  }


  const conversationId =
    getConversationId(
      payload
    );


  if (!conversationId) {
    return {
      ignored: true,
      reason:
        "conversation_id_missing",
    };
  }


  const conversation =
    await getConversation(
      conversationId
    );


  const attrs =
    conversation
      ?.custom_attributes ||
    {};


  if (
    !attrs
      .ia_agente_apresentado
  ) {

    return {
      ignored: true,
      reason:
        "presentation_already_empty",
    };
  }


  await updateConversationAttributes(
    conversationId,
    {
      ...attrs,

      ia_agente_apresentado:
        "",
    }
  );


  return {
    reset: true,
  };
}
