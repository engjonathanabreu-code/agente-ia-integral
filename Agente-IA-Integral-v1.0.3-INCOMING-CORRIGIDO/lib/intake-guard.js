import {
  assignConversationToTeam,
  getConversation,
  listTeams,
  sendMessage,
  updateConversationAttributes,
} from "./chatwoot.js";

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function isHumanRequest(message) {
  const text = normalize(message);
  const terms = [
    "falar com alguem", "falar com uma pessoa", "falar com atendente",
    "falar com um atendente", "falar com humano", "falar com um humano",
    "quero um atendente", "quero atendimento", "preciso de um atendente",
    "preciso falar com alguem", "gostaria de falar com alguem",
    "tem alguem ai", "atendimento humano", "atendente humano",
  ];
  return terms.some((term) => text.includes(normalize(term)));
}

function looksLikeConversationInsteadOfName(value) {
  const text = normalize(value);
  const words = text.split(" ").filter(Boolean);
  const conversational = new Set([
    "nossa", "mudou", "mudei", "mudar", "muda", "era", "estava", "esta",
    "quero", "queria", "gostaria", "preciso", "pode", "consegue", "ajuda",
    "atendimento", "atendente", "humano", "alguem", "pessoa", "obrigado",
    "obrigada", "sim", "nao", "ok", "oi", "ola",
  ]);
  return words.some((word) => conversational.has(word));
}

async function atendimentoTeamId() {
  const teams = await listTeams();
  const team = (teams || []).find((item) => normalize(item?.name).includes("atendimento"));
  return team?.id || null;
}

async function handoffHumanRequest(conversationId, attrs, text) {
  const teamId = await atendimentoTeamId();
  if (teamId) await assignConversationToTeam(conversationId, teamId);

  await updateConversationAttributes(conversationId, {
    ...attrs,
    ia_setor: "Atendimento",
    ia_motivo_contato: text,
    ia_etapa: "encaminhado",
    ia_atendimento_concluido: true,
    ia_tentativas_esclarecimento: 0,
  });

  await sendMessage(
    conversationId,
    "Entendi. Vou direcionar você diretamente ao setor de Atendimento para que uma pessoa da nossa equipe continue por aqui."
  );

  return { handled: true, action: "human_request_to_atendimento", sector: "Atendimento" };
}

export async function guardIntakeMessage(payload) {
  const conversationId = payload?.conversation?.id || payload?.conversation?.display_id;
  const text = String(payload?.content || "").trim();
  if (!conversationId || !text) return null;

  const conversation = await getConversation(conversationId);
  const attrs = conversation?.custom_attributes || {};
  const stage = attrs.ia_etapa || "inicio";

  if (attrs.ia_atendimento_concluido === true || stage === "encaminhado") return null;

  // Pedido explícito por pessoa humana tem prioridade em qualquer etapa da triagem.
  // Não obriga o cliente a terminar nome/cidade/menu antes do encaminhamento.
  if (isHumanRequest(text)) {
    return handoffHumanRequest(conversationId, attrs, text);
  }

  // Proteção específica da etapa de nome: frases conversacionais como "Nossa mudou"
  // não podem ser gravadas como nome só porque contêm duas palavras com letras.
  if (stage === "nome" && looksLikeConversationInsteadOfName(text)) {
    await sendMessage(
      conversationId,
      "Desculpe, não consegui entender seu nome. Pode me informar novamente seu nome completo, com nome e sobrenome?"
    );
    return { handled: true, action: "name_not_understood", stage: "nome" };
  }

  return null;
}
