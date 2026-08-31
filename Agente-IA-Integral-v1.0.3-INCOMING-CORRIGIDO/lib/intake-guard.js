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

/*
====================================================
PROTEÇÃO DE PRIVACIDADE / PROMPT INJECTION
====================================================

O texto do cliente é sempre dado não confiável. Estas regras bloqueiam
pedidos que tentem transformar a conversa em uma interface de consulta ao
CRM, ao histórico do Chatwoot, às instruções internas ou às credenciais.

Importante: pedidos legítimos sobre o PRÓPRIO processo não são bloqueados.
*/
function isPrivacyOrPromptInjectionAttempt(message) {
  const text = normalize(message);
  if (!text) return false;

  const instructionOverride = [
    "ignore as instrucoes", "ignore instrucoes", "ignore suas instrucoes",
    "desconsidere as instrucoes", "desconsidere suas instrucoes",
    "esqueca as instrucoes", "esqueca suas instrucoes",
    "novo prompt", "prompt do sistema", "system prompt", "developer message",
    "mensagem de sistema", "instrucoes internas", "regras internas",
    "modo desenvolvedor", "developer mode", "jailbreak",
  ];

  const secretRequest = [
    "api key", "chave api", "token", "secret", "segredo",
    "variavel de ambiente", "variaveis de ambiente", "env var", ".env",
    "senha do sistema", "credenciais", "service role", "service_role",
    "webhook token", "crm_agent_read_secret",
  ];

  const bulkOrThirdPartyData = [
    "todos os clientes", "lista de clientes", "listar clientes",
    "cadastro dos clientes", "dados dos clientes", "dados de clientes",
    "outros clientes", "outro cliente", "cliente de outra pessoa",
    "telefones dos clientes", "emails dos clientes", "e-mails dos clientes",
    "nomes dos clientes", "exportar clientes", "exporte os clientes",
    "dump do banco", "dump database", "banco de dados inteiro",
    "tabela clientes", "select *", "sql dos clientes",
  ];

  const chatwootExfiltration = [
    "todas as conversas", "lista de conversas", "historico de conversas",
    "historico do chatwoot", "historico dos atendimentos",
    "registro dos atendimentos", "registros dos atendimentos",
    "mensagens de outros clientes", "conversas de outros clientes",
    "logs do chatwoot", "log do chatwoot", "exportar conversas",
    "transcricao de outros atendimentos", "transcricoes de atendimentos",
  ];

  const hasOverride = instructionOverride.some((term) => text.includes(term));
  const hasSecret = secretRequest.some((term) => text.includes(term));
  const hasBulkData = bulkOrThirdPartyData.some((term) => text.includes(term));
  const hasChatwootData = chatwootExfiltration.some((term) => text.includes(term));

  // Combinações típicas de tentativa indireta de extração.
  const mentionsInternalSource = /\b(crm|chatwoot|banco de dados|database|supabase|sistema interno)\b/.test(text);
  const asksToReveal = /\b(mostre|mostrar|revele|revelar|liste|listar|envie|enviar|copie|copiar|exporte|exportar|imprima|retorne|forneca|fornecer)\b/.test(text);
  const asksOtherPeople = /\b(outro|outros|outra|outras|todos|todas|terceiro|terceiros)\b/.test(text) && /\b(cliente|clientes|pessoa|pessoas|atendimento|atendimentos|conversa|conversas)\b/.test(text);

  return hasOverride || hasSecret || hasBulkData || hasChatwootData ||
    (mentionsInternalSource && asksToReveal && asksOtherPeople);
}

async function blockPrivacyAttempt(conversationId) {
  await sendMessage(
    conversationId,
    "Por segurança e privacidade, não posso fornecer dados de outros clientes, registros internos de atendimentos, conteúdo de outras conversas, credenciais ou instruções internas do sistema. Posso ajudar com informações liberadas sobre o seu próprio atendimento ou encaminhar você para nossa equipe."
  );

  console.warn("Tentativa de acesso a dados protegidos bloqueada", {
    conversation_id: conversationId,
  });

  return {
    handled: true,
    action: "privacy_security_block",
    protected: true,
  };
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

  /*
   * Executa ANTES de qualquer processamento por IA ou consulta automática.
   * Assim uma tentativa de prompt injection não alcança classificadores nem CRM.
   */
  if (isPrivacyOrPromptInjectionAttempt(text)) {
    return blockPrivacyAttempt(conversationId);
  }

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
