import {
  getConversation,
  sendMessage,
  updateConversationAttributes,
} from "./chatwoot.js";

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getConversationId(payload) {
  return (
    payload?.conversation?.id ||
    payload?.id ||
    payload?.conversation?.display_id ||
    null
  );
}

function hasAssigneeChange(payload) {
  const changes = Array.isArray(payload?.changed_attributes)
    ? payload.changed_attributes
    : [];

  for (const change of changes) {
    if (!change || typeof change !== "object") continue;

    const changed = Object.keys(change).some((key) => {
      const normalized = normalize(key);
      return (
        normalized === "assignee_id" ||
        normalized === "assignee" ||
        normalized === "assigned_agent_id" ||
        normalized.includes("assignee")
      );
    });

    if (changed) return true;
  }

  return false;
}

function extractAssignee(conversation, payload) {
  const candidates = [
    conversation?.meta?.assignee,
    conversation?.assignee,
    payload?.meta?.assignee,
    payload?.conversation?.meta?.assignee,
    payload?.assignee,
  ];

  for (const candidate of candidates) {
    if (candidate?.id) return candidate;
  }

  return null;
}

function getAgentName(assignee) {
  return (
    assignee?.name ||
    assignee?.available_name ||
    assignee?.display_name ||
    "atendente"
  );
}

function getCurrentSector(conversation, attrs) {
  const routedSector = String(attrs?.ia_setor || "").trim();
  const currentTeam = String(
    conversation?.meta?.team?.name ||
    conversation?.team?.name ||
    ""
  ).trim();

  // Em uma retomada o Chatwoot pode manter o time do atendimento anterior.
  // O setor gravado pela triagem atual é a fonte principal. Quando houver
  // divergência e o setor da sessão ainda estiver vazio, não inventamos setor.
  if (routedSector) return routedSector;
  return currentTeam || null;
}

export async function handleAgentPresentation(payload) {
  if (payload?.event !== "conversation_updated") {
    return { ignored: true, reason: "event_not_conversation_updated" };
  }

  if (!hasAssigneeChange(payload)) {
    return { ignored: true, reason: "assignee_not_changed" };
  }

  const conversationId = getConversationId(payload);
  if (!conversationId) {
    return { ignored: true, reason: "conversation_id_missing" };
  }

  // Dá um pequeno intervalo para a atualização de roteamento terminar antes
  // de buscar o estado atual. Isso evita usar ia_setor da sessão anterior
  // quando atribuição de time/agente e atributos chegam quase simultaneamente.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const conversation = await getConversation(conversationId);
  const attrs = conversation?.custom_attributes || {};

  const aiFinished =
    attrs.ia_atendimento_concluido === true &&
    attrs.ia_etapa === "encaminhado";

  if (!aiFinished) {
    return {
      ignored: true,
      reason: "ai_triage_not_finished",
      stage: attrs.ia_etapa,
    };
  }

  const assignee = extractAssignee(conversation, payload);
  if (!assignee?.id) {
    return { ignored: true, reason: "no_assignee" };
  }

  const agentId = String(assignee.id);
  const alreadyPresented = String(attrs.ia_agente_apresentado || "");

  if (alreadyPresented === agentId) {
    return {
      ignored: true,
      reason: "agent_already_presented",
      agent_id: agentId,
    };
  }

  const agentName = getAgentName(assignee);
  const sector = getCurrentSector(conversation, attrs);

  await updateConversationAttributes(conversationId, {
    ...attrs,
    ia_agente_apresentado: agentId,
  });

  const presentationText = sector
    ? `Olá! Aqui é o ${agentName}, do setor ${sector} da Integral. Recebi seu atendimento e vou dar continuidade por aqui. 😊`
    : `Olá! Aqui é o ${agentName}, da Integral. Recebi seu atendimento e vou dar continuidade por aqui. 😊`;

  try {
    await sendMessage(conversationId, presentationText);
  } catch (error) {
    try {
      await updateConversationAttributes(conversationId, {
        ...attrs,
        ia_agente_apresentado: "",
      });
    } catch (rollbackError) {
      console.error(
        "Erro ao desfazer reserva de apresentação:",
        rollbackError
      );
    }
    throw error;
  }

  console.log("Agente humano apresentado", {
    conversation_id: conversationId,
    agent_id: agentId,
    agent_name: agentName,
    sector,
  });

  return {
    presented: true,
    agent_id: agentId,
    agent_name: agentName,
    sector,
  };
}

export async function resetAgentPresentation(payload) {
  const status = String(
    payload?.conversation?.status ||
    payload?.status ||
    ""
  )
    .toLowerCase()
    .trim();

  if (status !== "resolved") {
    return { ignored: true, reason: "status_not_resolved" };
  }

  const conversationId = getConversationId(payload);
  if (!conversationId) {
    return { ignored: true, reason: "conversation_id_missing" };
  }

  const conversation = await getConversation(conversationId);
  const attrs = conversation?.custom_attributes || {};

  // Limpa também o setor da sessão finalizada. Assim um novo atendimento
  // nunca reaproveita Topografia/Financeiro/etc. do contato anterior apenas
  // porque o Chatwoot manteve a conversa ou a equipe anterior vinculada.
  await updateConversationAttributes(conversationId, {
    ...attrs,
    ia_agente_apresentado: "",
    ia_setor: "",
  });

  return { reset: true };
}
