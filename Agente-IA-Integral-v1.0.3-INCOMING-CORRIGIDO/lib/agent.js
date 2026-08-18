import OpenAI from "openai";

import {
  assignConversationToTeam,
  getConversation,
  listTeams,
  sendMessage,
  updateConversationAttributes,
} from "./chatwoot.js";

import {
  transcriptionFromPayload,
} from "./audio.js";

const SECTORS = [
  "Atendimento",
  "Comercial",
  "Financeiro",
  "Projetos",
  "Topografia",
  "Pós-Protocolo",
];

const TEAM_ALIASES = {
  Atendimento: ["atendimento"],
  Comercial: ["comercial", "vendas"],
  Financeiro: ["financeiro", "cobranca", "cobrança"],
  Projetos: ["projetos", "projeto"],
  Topografia: ["topografia", "topografico", "topográfico"],
  "Pós-Protocolo": [
    "pós-protocolo",
    "pos-protocolo",
    "pós protocolo",
    "pos protocolo",
  ],
};

/*
===========================================
NORMALIZAÇÃO
===========================================
*/

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeText(value) {
  return normalize(value).replace(/\s+/g, " ");
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

/*
===========================================
SAUDAÇÃO
===========================================
*/

function isSimpleGreeting(message) {
  const text = normalizeText(message);

  return [
    "oi",
    "ola",
    "olá",
    "bom dia",
    "boa tarde",
    "boa noite",
    "opa",
    "e ai",
    "e aí",
    "tudo bem",
    "como vai",
  ]
    .map(normalizeText)
    .includes(text);
}

/*
===========================================
PEDIDO PARA FALAR COM HUMANO
===========================================
*/

function isHumanRequest(message) {
  const text = normalizeText(message);

  const terms = [
    "falar com alguem",
    "falar com alguém",
    "falar com uma pessoa",
    "falar com atendente",
    "falar com um atendente",
    "falar com humano",
    "falar com um humano",
    "quero falar com alguem",
    "quero falar com alguém",
    "quero falar com uma pessoa",
    "gostaria de falar com alguem",
    "gostaria de falar com alguém",
    "gostaria de falar com uma pessoa",
    "preciso falar com alguem",
    "preciso falar com alguém",
    "preciso falar com uma pessoa",
    "tem alguem ai",
    "tem alguém aí",
    "alguem ai",
    "alguém aí",
  ];

  return terms.some((term) =>
    text.includes(normalizeText(term))
  );
}

/*
===========================================
INTENÇÃO DE ANDAMENTO
===========================================
*/

function isAndamentoIntent(message) {
  const text = normalizeText(message);

  const terms = [
    "andamento",
    "andamentos",
    "status do processo",
    "status processo",
    "como esta meu processo",
    "como esta o meu processo",
    "como está meu processo",
    "como está o meu processo",
    "em que fase",
    "em qual fase",
    "qual etapa",
    "etapa do processo",
    "fase do processo",
    "situacao do processo",
    "situação do processo",
    "previsao",
    "previsão",
    "quando fica pronto",
    "quando vai ficar pronto",
    "quando termina",
    "quando vai terminar",
    "ja foi protocolado",
    "já foi protocolado",
    "foi protocolado",
    "protocolo do processo",
    "prefeitura analisou",
    "cartorio analisou",
    "cartório analisou",
    "registro de imoveis",
    "registro de imóveis",
    "crf",
  ];

  return terms.some((term) =>
    text.includes(normalizeText(term))
  );
}

/*
===========================================
VALOR AMBÍGUO
===========================================
*/

function isAmbiguousValueIntent(message) {
  const text = normalizeText(message);

  const hasValue =
    text.includes("valor") ||
    text.includes("preco") ||
    text.includes("preço");

  if (!hasValue) return false;

  const clearFinancial = [
    "boleto",
    "parcela",
    "pagamento",
    "cobranca",
    "cobrança",
    "pix",
    "segunda via",
    "comprovante",
    "vencimento",
    "pagar",
  ];

  const clearCommercial = [
    "orcamento",
    "orçamento",
    "proposta",
    "contratar",
    "novo servico",
    "novo serviço",
    "vendas",
  ];

  const isClear =
    clearFinancial.some((term) =>
      text.includes(normalizeText(term))
    ) ||
    clearCommercial.some((term) =>
      text.includes(normalizeText(term))
    );

  return !isClear;
}

/*
===========================================
AÇÕES SENSÍVEIS
===========================================
*/

function isSensitiveActionIntent(message) {
  const text = normalizeText(message);

  const terms = [
    "dar desconto",
    "conceder desconto",
    "negociar valor",
    "alterar contrato",
    "cancelar contrato",
    "rescindir contrato",
    "alterar parcela",
    "mudar parcela",
    "alterar vencimento",
    "mudar vencimento",
    "prometer prazo",
    "garantir prazo",
    "alterar cadastro",
    "trocar titular",
    "mudar titular",
    "autorizar",
    "aprovar",
  ];

  return terms.some((term) =>
    text.includes(normalizeText(term))
  );
}

/*
===========================================
CRM / ANDAMENTO
===========================================
*/

async function getClientProgress(conversationId) {
  const secret = process.env.CRM_AGENT_READ_SECRET;

  const baseUrl =
    process.env.CRM_BASE_URL ||
    "https://www.crmintegralreurb.work";

  if (!secret) {
    console.error(
      "CRM_AGENT_READ_SECRET não configurado."
    );

    return {
      ok: false,
      code: "CRM_SECRET_MISSING",
    };
  }

  try {
    const response = await fetch(
      `${baseUrl}/api/andamento-cliente`,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          conversation_id: conversationId,
        }),
      }
    );

    const raw = await response.text();

    let data = null;

    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = {
        ok: false,
        error: "Resposta inválida do CRM.",
      };
    }

    if (!response.ok) {
      console.error(
        "Erro consulta andamento CRM:",
        {
          status: response.status,
          data,
        }
      );

      return {
        ok: false,
        code: "CRM_REQUEST_ERROR",
      };
    }

    console.log(
      "Consulta andamento CRM:",
      {
        conversationId,
        found: data?.found,
        andamentoAvailable:
          data?.andamento_available,
        code: data?.code || null,
      }
    );

    return data;

  } catch (error) {
    console.error(
      "Falha de comunicação com CRM:",
      error
    );

    return {
      ok: false,
      code: "CRM_CONNECTION_ERROR",
    };
  }
}

/*
===========================================
ORIENTAÇÃO INTERNA DA IA
===========================================
*/

function customerTextFromAiOrientation(value) {
  const raw = String(value || "").trim();

  if (!raw) return null;

  const text = normalizeText(raw);

  if (
    text.includes("empresa fez o possivel") ||
    text.includes("empresa fez o possível") ||
    text.includes("acelerar o processo") ||
    text.includes("dar celeridade")
  ) {
    return "A empresa realizou todas as providências ao seu alcance para dar celeridade ao processo e, neste momento, aguardamos a atuação do órgão responsável.";
  }

  /*
  Qualquer orientação não reconhecida é tratada
  como instrução interna e não aparece ao cliente.
  */
  return null;
}

/*
===========================================
FORMATA ANDAMENTO
===========================================
*/

function progressResponseText(data) {
  const name =
    firstName(
      data?.cliente?.nome
    );

  const progress =
    data?.andamento_atual;

  if (!progress) {
    return null;
  }

  const parts = [];

  parts.push(
    name
      ? `${name}, consultei seu processo no nosso sistema.`
      : "Consultei seu processo no nosso sistema."
  );

  if (data?.projeto?.nome) {
    parts.push(
      `Projeto/Núcleo: ${data.projeto.nome}.`
    );
  }

  if (progress.etapa) {
    parts.push(
      `Etapa atual: ${progress.etapa}.`
    );
  }

  if (progress.status_operacional) {
    parts.push(
      `Situação: ${progress.status_operacional}.`
    );
  }

  if (progress.descricao_cliente) {
    parts.push(
      progress.descricao_cliente
    );
  }

  if (progress.previsao) {
    const date =
      new Date(
        `${progress.previsao}T12:00:00`
      );

    if (!Number.isNaN(date.getTime())) {
      const formatted =
        new Intl.DateTimeFormat(
          "pt-BR"
        ).format(date);

      parts.push(
        `Previsão registrada: ${formatted}.`
      );
    }
  }

  const orientationText =
    customerTextFromAiOrientation(
      progress.orientacao_ia
    );

  if (orientationText) {
    parts.push(
      orientationText
    );
  }

  parts.push(
    "Se precisar de mais alguma informação sobre esse processo, pode me perguntar por aqui. Se preferir falar com nossa equipe, também posso direcionar seu atendimento."
  );

  return parts
    .filter(Boolean)
    .join("\n\n");
}

/*
===========================================
TENTA RESPONDER ANDAMENTO
===========================================
*/

async function tryAnswerProgress(
  conversationId,
  text,
  attrs
) {
  if (!isAndamentoIntent(text)) {
    return null;
  }

  const result =
    await getClientProgress(
      conversationId
    );

  if (
    !result ||
    result.ok === false
  ) {
    return null;
  }

  if (result.found === false) {
    return null;
  }

  if (
    result.code ===
    "PROJETO_NAO_VINCULADO"
  ) {
    return {
      handled: false,
      forceHandoff: true,
      reason: "project_not_linked",

      handoffMessage:
        `${firstName(
          attrs?.ia_nome ||
          result?.cliente?.nome
        ) || "Olá"}, localizei seu cadastro, mas ele ainda não está vinculado a um Projeto/Núcleo no nosso sistema. A equipe de Atendimento precisa verificar essa vinculação para consultar o andamento correto.`,
    };
  }

  if (
    result.andamento_available ===
    false
  ) {
    return {
      handled: false,
      forceHandoff: true,
      reason: "progress_not_available",

      handoffMessage:
        `${firstName(
          attrs?.ia_nome ||
          result?.cliente?.nome
        ) || "Olá"}, localizei seu cadastro e o Projeto/Núcleo relacionado, mas não há uma atualização liberada para consulta automática neste momento. A equipe de Atendimento vai verificar a situação atual.`,
    };
  }

  const message =
    progressResponseText(
      result
    );

  if (!message) {
    return null;
  }

  await sendMessage(
    conversationId,
    message
  );

  await updateConversationAttributes(
    conversationId,
    {
      ...attrs,

      ia_ultima_consulta_andamento:
        new Date().toISOString(),

      ia_ultimo_contexto:
        "andamento",

      ia_atendimento_concluido:
        false,
    }
  );

  return {
    handled: true,
    andamento: result,
  };
}

/*
===========================================
VALIDAÇÃO DE NOME
===========================================
*/

function validFullName(value) {
  const clean =
    String(value || "")
      .trim()
      .replace(/\s+/g, " ");

  if (
    clean.length < 5 ||
    clean.length > 100
  ) {
    return false;
  }

  if (
    clean
      .split(" ")
      .filter(Boolean)
      .length < 2
  ) {
    return false;
  }

  if (/\d/.test(clean)) {
    return false;
  }

  return /^[A-Za-zÀ-ÿ'’\-\s]+$/.test(
    clean
  );
}

/*
===========================================
VALIDAÇÃO DE CIDADE
===========================================
*/

function validCity(value) {
  const clean =
    String(value || "")
      .trim()
      .replace(/\s+/g, " ");

  if (
    clean.length < 2 ||
    clean.length > 80
  ) {
    return false;
  }

  const text =
    normalizeText(clean);

  const invalid = [
    "nao",
    "não",
    "nao sei",
    "não sei",
    "tanto faz",
    "brasil",
    "sc",
    "pr",
    "rs",
    "sp",
    "mg",
    "rj",
    "sim",
    "ok",
    "beleza",
  ];

  if (
    invalid
      .map(normalizeText)
      .includes(text)
  ) {
    return false;
  }

  if (
    clean.includes("?") ||
    /\d{4,}/.test(clean)
  ) {
    return false;
  }

  return /^[A-Za-zÀ-ÿ'’\-\s]+$/.test(
    clean
  );
}

/*
===========================================
MOTIVO
===========================================
*/

function validContactReason(value) {
  const clean =
    String(value || "")
      .trim()
      .replace(/\s+/g, " ");

  if (
    clean.length < 5 ||
    clean.length > 1500
  ) {
    return false;
  }

  return !isSimpleGreeting(clean);
}

/*
===========================================
CLASSIFICAÇÃO DIRETA
===========================================
*/

function directSectorMatch(message) {
  const t =
    normalizeText(message);

  /*
  Número do menu tem prioridade.
  */
  const numeric =
    t.match(/^([1-6])$/)?.[1];

  if (numeric) {
    return SECTORS[
      Number(numeric) - 1
    ];
  }

  const patterns = [
    [
      "Financeiro",
      [
        "financeiro",
        "boleto",
        "parcela",
        "pagamento",
        "pagar",
        "pix",
        "cobranca",
        "cobrança",
        "divida",
        "dívida",
        "nota fiscal",
        "segunda via",
        "comprovante",
        "vencimento",
      ],
    ],

    [
      "Topografia",
      [
        "topografia",
        "topografo",
        "topógrafo",
        "medicao",
        "medição",
        "levantamento",
        "campo",
        "medir terreno",
      ],
    ],

    [
      "Pós-Protocolo",
      [
        "pos protocolo",
        "pós protocolo",
        "processo protocolado",
        "prefeitura",
        "cartorio",
        "cartório",
        "registro de imoveis",
        "registro de imóveis",
        "crf",
      ],
    ],

    [
      "Projetos",
      [
        "projeto",
        "planta",
        "memorial",
        "engenharia",
        "correcao de projeto",
        "correção de projeto",
      ],
    ],

    [
      "Comercial",
      [
        "comercial",
        "orcamento",
        "orçamento",
        "proposta",
        "contratar",
        "novo servico",
        "novo serviço",
        "vendas",
      ],
    ],

    [
      "Atendimento",
      [
        "atendimento",
        "duvida",
        "dúvida",
        "informacao",
        "informação",
        "documentacao",
        "documentação",
      ],
    ],
  ];

  for (
    const [sector, terms]
    of patterns
  ) {
    if (
      terms.some(
        (term) =>
          t.includes(
            normalizeText(term)
          )
      )
    ) {
      return sector;
    }
  }

  return null;
}

/*
===========================================
CLASSIFICADOR CONTEXTUAL
===========================================
*/

async function contextualIntent(message) {
  if (
    isAmbiguousValueIntent(
      message
    )
  ) {
    return {
      sector: null,
      confidence: "medium",
      needsClarification: true,
      needsHuman: false,

      clarificationQuestion:
        "Esse valor é sobre uma cobrança ou pagamento já existente, ou sobre orçamento/proposta de um novo serviço?",
    };
  }

  const direct =
    directSectorMatch(
      message
    );

  if (
    direct &&
    validContactReason(
      message
    )
  ) {
    return {
      sector: direct,
      confidence: "high",
      needsClarification: false,

      needsHuman:
        isSensitiveActionIntent(
          message
        ),

      clarificationQuestion: null,
    };
  }

  const apiKey =
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      sector: direct,

      confidence:
        direct
          ? "medium"
          : "low",

      needsClarification:
        !direct,

      needsHuman: false,
      clarificationQuestion: null,
    };
  }

  const client =
    new OpenAI({
      apiKey,
    });

  const response =
    await client.responses.create({
      model:
        process.env.OPENAI_MODEL ||
        "gpt-5",

      reasoning: {
        effort: "low",
      },

      instructions: `
Você classifica solicitações de clientes da Integral Soluções em Engenharia.

Responda SOMENTE em JSON válido:

{
  "sector": "Atendimento|Comercial|Financeiro|Projetos|Topografia|Pós-Protocolo|INDEFINIDO",
  "confidence": "high|medium|low",
  "needsClarification": true,
  "needsHuman": false,
  "clarificationQuestion": "pergunta curta ou null"
}

Financeiro:
boleto, cobrança, pagamento, parcela, PIX, nota fiscal, comprovante, vencimento e valores relacionados a obrigações já existentes.

Comercial:
orçamento, proposta, contratação, preço de novo serviço e vendas.

IMPORTANTE:
A palavra "valor" sozinha NÃO significa Comercial.

Frases como:
"tenho um problema com um valor"
"tenho dúvida sobre um valor"
"quero falar sobre um valor"

são ambíguas.

Nesses casos:
confidence = medium
needsClarification = true
sector = INDEFINIDO

E pergunte:
"Esse valor é sobre uma cobrança ou pagamento já existente, ou sobre orçamento/proposta de um novo serviço?"

Projetos:
planta, memorial, projeto técnico, engenharia e correções técnicas.

Topografia:
medição, levantamento, campo, demarcação e topógrafo.

Pós-Protocolo:
somente quando o caso já foi protocolado ou envolve claramente Prefeitura, Cartório, Registro de Imóveis ou CRF.

Atendimento:
documentação, dúvidas gerais e assuntos administrativos.

Se houver negociação, desconto, alteração contratual, alteração financeira excepcional, promessa de prazo ou decisão fora do padrão:
needsHuman = true.

Nunca invente informações.
`,

      input:
        String(message || ""),
    });

  try {
    const parsed =
      JSON.parse(
        String(
          response.output_text ||
          "{}"
        )
      );

    return {
      sector:
        SECTORS.includes(
          parsed.sector
        )
          ? parsed.sector
          : null,

      confidence:
        [
          "high",
          "medium",
          "low",
        ].includes(
          parsed.confidence
        )
          ? parsed.confidence
          : "low",

      needsClarification:
        Boolean(
          parsed.needsClarification
        ),

      needsHuman:
        Boolean(
          parsed.needsHuman
        ),

      clarificationQuestion:
        parsed.clarificationQuestion ||
        null,
    };

  } catch (error) {
    console.error(
      "Falha ao interpretar classificação:",
      error
    );

    return {
      sector: direct,

      confidence:
        direct
          ? "medium"
          : "low",

      needsClarification:
        !direct,

      needsHuman: false,
      clarificationQuestion: null,
    };
  }
}

/*
===========================================
TEXTO OU ÁUDIO
===========================================
*/

async function extractCustomerText(payload) {
  const text =
    String(
      payload?.content ||
      ""
    ).trim();

  if (text) {
    return {
      text,
      source: "text",
    };
  }

  try {
    const transcription =
      await transcriptionFromPayload(
        payload
      );

    if (transcription) {
      return {
        text: transcription,
        source: "audio",
      };
    }

  } catch (error) {
    console.error(
      "Erro ao transcrever áudio:",
      error
    );
  }

  return {
    text: "",
    source: "unknown",
  };
}

/*
===========================================
LOCALIZA TIME
===========================================
*/

async function findTeamIdForSector(sector) {
  const teams =
    await listTeams();

  const aliases =
    TEAM_ALIASES[sector] ||
    [sector];

  const normalizedAliases =
    aliases.map(normalize);

  const found =
    (teams || []).find(
      (team) => {
        const teamName =
          normalize(
            team.name
          );

        return normalizedAliases.some(
          (alias) =>
            teamName === alias ||
            teamName.includes(alias)
        );
      }
    );

  return found?.id || null;
}

/*
===========================================
MENUS
===========================================
*/

function sectorMenuText(name) {
  const prefix =
    name
      ? `${firstName(name)}, `
      : "";

  return `${prefix}para eu direcionar você à equipe correta, escolha o setor com o qual deseja falar:

1. Atendimento
2. Comercial
3. Financeiro
4. Projetos
5. Topografia
6. Pós-Protocolo`;
}

function fallbackMenuText(name) {
  const prefix =
    name
      ? `${firstName(name)}, `
      : "";

  return `${prefix}não consegui identificar com segurança o assunto.

Você pode me explicar brevemente o que precisa ou escolher uma opção:

1. Atendimento
2. Comercial
3. Financeiro
4. Projetos
5. Topografia
6. Pós-Protocolo`;
}

/*
===========================================
ABRE SELEÇÃO DE SETOR
===========================================
*/

async function openSectorSelection(
  conversationId,
  attrs
) {
  await updateConversationAttributes(
    conversationId,
    {
      ...attrs,

      ia_etapa:
        "setor",

      ia_setor:
        "",

      ia_motivo_contato:
        "",

      ia_tentativas_esclarecimento:
        0,

      ia_atendimento_concluido:
        false,
    }
  );

  await sendMessage(
    conversationId,
    sectorMenuText(
      attrs.ia_nome
    )
  );

  return {
    handled: true,
    action:
      "human_requested_sector_menu",
    stage: "setor",
  };
}

/*
===========================================
ENCAMINHAMENTO
===========================================
*/

async function handoffToSector(
  conversationId,
  attrs,
  sector,
  contactReason,
  customMessage = null
) {
  const teamId =
    await findTeamIdForSector(
      sector
    );

  let assigned = false;

  if (teamId) {
    try {
      await assignConversationToTeam(
        conversationId,
        teamId
      );

      assigned = true;

    } catch (error) {
      console.error(
        "Falha ao atribuir equipe:",
        error.message
      );
    }
  }

  await updateConversationAttributes(
    conversationId,
    {
      ...attrs,

      ia_setor:
        sector,

      ia_motivo_contato:
        contactReason,

      ia_etapa:
        "encaminhado",

      ia_atendimento_concluido:
        true,

      ia_tentativas_esclarecimento:
        0,
    }
  );

  if (assigned) {
    if (customMessage) {
      await sendMessage(
        conversationId,
        customMessage
      );
    }

    return {
      stage: "encaminhado",
      sector,
      assigned: true,
    };
  }

  await sendMessage(
    conversationId,

    customMessage ||

    `${firstName(
      attrs.ia_nome
    ) || "Olá"}, registrei sua solicitação para o setor de ${sector}. A equipe responsável dará continuidade por aqui.`
  );

  return {
    stage: "encaminhado",
    sector,
    assigned: false,
  };
}

/*
===========================================
ROTEAMENTO INTELIGENTE
===========================================
*/

async function routeCustomerNeed(
  conversationId,
  attrs,
  text,
  options = {}
) {
  const {
    allowProgress = true,
  } = options;

  /*
  Pedido para falar com alguém
  NÃO encaminha direto.

  Primeiro abre o menu.
  */

  if (isHumanRequest(text)) {
    return openSectorSelection(
      conversationId,
      attrs
    );
  }

  /*
  Consulta de andamento.

  Quando estamos coletando o MOTIVO,
  allowProgress será false para evitar
  que a IA mostre o andamento novamente.
  */

  if (allowProgress) {
    const progressResult =
      await tryAnswerProgress(
        conversationId,
        text,
        attrs
      );

    if (
      progressResult?.handled ===
      true
    ) {
      return {
        handled: true,
        action:
          "progress_answer",
      };
    }

    if (
      progressResult?.forceHandoff ===
      true
    ) {
      return handoffToSector(
        conversationId,
        attrs,
        "Atendimento",
        text,
        progressResult.handoffMessage
      );
    }
  }

  /*
  VALOR AMBÍGUO
  */

  if (
    isAmbiguousValueIntent(
      text
    )
  ) {
    await updateConversationAttributes(
      conversationId,
      {
        ...attrs,

        ia_etapa:
          "esclarecimento",

        ia_setor:
          "",

        ia_tentativas_esclarecimento:
          1,

        ia_atendimento_concluido:
          false,
      }
    );

    await sendMessage(
      conversationId,

      `${firstName(
        attrs.ia_nome
      ) || "Claro"}, esse valor é sobre uma cobrança ou pagamento já existente, ou sobre orçamento/proposta de um novo serviço?`
    );

    return {
      handled: true,
      action:
        "clarification_value",
    };
  }

  /*
  AÇÃO SENSÍVEL
  */

  if (
    isSensitiveActionIntent(
      text
    )
  ) {
    const classification =
      await contextualIntent(
        text
      );

    return handoffToSector(
      conversationId,
      attrs,

      classification.sector ||
      attrs.ia_setor ||
      "Atendimento",

      text,

      `${firstName(
        attrs.ia_nome
      ) || "Olá"}, esse tipo de solicitação precisa ser analisado diretamente pela nossa equipe.`
    );
  }

  const intent =
    await contextualIntent(
      text
    );

  console.log(
    "Classificação contextual",
    {
      text,
      intent,

      selectedSector:
        attrs.ia_setor ||
        null,
    }
  );

  /*
  A escolha feita no menu funciona como
  preferência.

  Mas se o motivo mostrar claramente que
  pertence a outro setor, a IA pode corrigir.
  */

  const preferredSector =
    intent.sector ||
    attrs.ia_setor ||
    "Atendimento";

  if (intent.needsHuman) {
    return handoffToSector(
      conversationId,
      attrs,
      preferredSector,
      text
    );
  }

  /*
  CLASSIFICAÇÃO FORTE
  */

  if (
    intent.sector &&
    intent.confidence ===
      "high" &&
    validContactReason(
      text
    )
  ) {
    return handoffToSector(
      conversationId,
      attrs,
      intent.sector,
      text
    );
  }

  /*
  Cliente escolheu setor e explicou
  um motivo válido.

  Mesmo se a IA não conseguir classificar
  com confiança, não deixamos travar.
  */

  if (
    attrs.ia_setor &&
    validContactReason(
      text
    ) &&
    intent.confidence ===
      "low"
  ) {
    return handoffToSector(
      conversationId,
      attrs,
      attrs.ia_setor,
      text
    );
  }

  /*
  ESCLARECIMENTO
  */

  if (
    intent.needsClarification ||
    intent.confidence ===
      "medium"
  ) {
    const attempts =
      Number(
        attrs.ia_tentativas_esclarecimento ||
        0
      );

    if (attempts >= 1) {
      return handoffToSector(
        conversationId,
        attrs,
        preferredSector,
        text,

        `${firstName(
          attrs.ia_nome
        ) || "Olá"}, não consegui identificar sua necessidade com total segurança, então vou encaminhar para nossa equipe continuar com você.`
      );
    }

    await updateConversationAttributes(
      conversationId,
      {
        ...attrs,

        ia_etapa:
          "esclarecimento",

        ia_setor:
          intent.sector ||
          attrs.ia_setor ||
          "",

        ia_tentativas_esclarecimento:
          attempts + 1,

        ia_atendimento_concluido:
          false,
      }
    );

    await sendMessage(
      conversationId,

      intent.clarificationQuestion ||

      `${firstName(
        attrs.ia_nome
      ) || "Claro"}, pode me explicar um pouco melhor o que você precisa?`
    );

    return {
      handled: true,
      action:
        "clarification",
    };
  }

  /*
  FALLBACK PARA MENU
  */

  await updateConversationAttributes(
    conversationId,
    {
      ...attrs,

      ia_etapa:
        "setor",

      ia_atendimento_concluido:
        false,
    }
  );

  await sendMessage(
    conversationId,
    fallbackMenuText(
      attrs.ia_nome
    )
  );

  return {
    handled: true,
    action:
      "fallback_menu",
  };
}

/*
===========================================
CONVERSA RESOLVIDA
===========================================
*/

export async function handleConversationStatusChanged(
  payload
) {
  const conversationId =
    payload?.conversation?.id ||
    payload?.id ||
    payload?.conversation?.display_id;

  if (!conversationId) {
    return {
      ignored: true,
      reason:
        "conversation_id_missing",
    };
  }

  const status =
    String(
      payload?.conversation?.status ||
      payload?.status ||
      ""
    ).toLowerCase();

  if (
    status !==
    "resolved"
  ) {
    return {
      ignored: true,
      reason:
        "status_not_resolved",
    };
  }

  const conversation =
    await getConversation(
      conversationId
    );

  const attrs =
    conversation?.custom_attributes ||
    {};

  await updateConversationAttributes(
    conversationId,
    {
      ...attrs,

      ia_etapa:
        "retorno",

      ia_atendimento_concluido:
        false,

      ia_setor:
        "",

      ia_motivo_contato:
        "",

      ia_tentativas_esclarecimento:
        0,
    }
  );

  return {
    stage: "retorno",
    rearmed: true,
  };
}

/*
===========================================
PROCESSA MENSAGEM
===========================================
*/

export async function handleIncomingMessage(
  payload
) {
  const conversationId =
    payload?.conversation?.id ||
    payload?.conversation?.display_id;

  if (!conversationId) {
    throw new Error(
      "conversation.id não encontrado."
    );
  }

  const extracted =
    await extractCustomerText(
      payload
    );

  const text =
    extracted.text;

  if (!text) {
    await sendMessage(
      conversationId,

      "Não consegui interpretar essa mensagem. Você pode escrever novamente ou enviar o áudio mais uma vez?"
    );

    return {
      ignored: true,
      reason:
        "unreadable_message",
    };
  }

  const conversation =
    await getConversation(
      conversationId
    );

  const attrs =
    conversation?.custom_attributes ||
    {};

  const stage =
    attrs.ia_etapa ||
    "inicio";

  console.log(
    "Agente IA processando mensagem",
    {
      conversationId,
      stage,

      name:
        attrs.ia_nome ||
        null,

      city:
        attrs.ia_cidade ||
        null,

      text,
    }
  );

  /*
  ===========================================
  HUMANO JÁ ASSUMIU
  ===========================================
  */

  if (
    attrs.ia_atendimento_concluido ===
      true ||
    stage ===
      "encaminhado"
  ) {
    return {
      ignored: true,
      reason:
        "human_handoff_active",
    };
  }

  /*
  ===========================================
  SAUDAÇÃO GLOBAL
  ===========================================
  */

  if (
    isSimpleGreeting(text) &&
    attrs.ia_nome &&
    attrs.ia_cidade &&
    stage !== "nome" &&
    stage !== "cidade"
  ) {
    await updateConversationAttributes(
      conversationId,
      {
        ...attrs,

        ia_etapa:
          "necessidade",

        ia_setor:
          "",

        ia_motivo_contato:
          "",

        ia_tentativas_esclarecimento:
          0,

        ia_atendimento_concluido:
          false,
      }
    );

    await sendMessage(
      conversationId,

      `Olá, ${firstName(
        attrs.ia_nome
      )}! Que bom falar com você novamente 😊

Como posso ajudar hoje?`
    );

    return {
      stage:
        "necessidade",

      greeting:
        true,
    };
  }

  /*
  ===========================================
  PRIMEIRO CONTATO
  ===========================================
  */

  if (
    stage ===
    "inicio"
  ) {
    if (
      attrs.ia_nome &&
      attrs.ia_cidade
    ) {
      await updateConversationAttributes(
        conversationId,
        {
          ...attrs,

          ia_etapa:
            "necessidade",

          ia_atendimento_concluido:
            false,
        }
      );

      return routeCustomerNeed(
        conversationId,
        attrs,
        text
      );
    }

    await updateConversationAttributes(
      conversationId,
      {
        ...attrs,

        ia_etapa:
          "nome",

        ia_atendimento_concluido:
          false,
      }
    );

    await sendMessage(
      conversationId,

      "Olá! 👋 Sou o assistente virtual da Integral Soluções em Engenharia. Para iniciarmos, por favor, informe seu nome completo."
    );

    return {
      stage:
        "nome",
    };
  }

  /*
  ===========================================
  NOME
  ===========================================
  */

  if (
    stage ===
    "nome"
  ) {
    if (
      !validFullName(
        text
      )
    ) {
      await sendMessage(
        conversationId,

        "Para registrar seu atendimento corretamente, preciso do seu nome completo. Por favor, informe seu nome e sobrenome."
      );

      return {
        stage:
          "nome",
      };
    }

    const cleanName =
      text
        .replace(/\s+/g, " ")
        .trim();

    await updateConversationAttributes(
      conversationId,
      {
        ...attrs,

        ia_nome:
          cleanName,

        ia_etapa:
          "cidade",
      }
    );

    await sendMessage(
      conversationId,

      `Obrigado, ${firstName(
        cleanName
      )}. Agora me informe a cidade relacionada ao atendimento.`
    );

    return {
      stage:
        "cidade",
    };
  }

  /*
  ===========================================
  CIDADE
  ===========================================
  */

  if (
    stage ===
    "cidade"
  ) {
    if (
      !validCity(
        text
      )
    ) {
      await sendMessage(
        conversationId,

        `${firstName(
          attrs.ia_nome
        )}, me informe apenas o nome da cidade relacionada ao atendimento, por favor.`
      );

      return {
        stage:
          "cidade",
      };
    }

    const city =
      text
        .replace(/\s+/g, " ")
        .trim();

    await updateConversationAttributes(
      conversationId,
      {
        ...attrs,

        ia_cidade:
          city,

        ia_etapa:
          "necessidade",

        ia_atendimento_concluido:
          false,
      }
    );

    await sendMessage(
      conversationId,

      `${firstName(
        attrs.ia_nome
      )}, obrigado. Como posso ajudar você hoje?`
    );

    return {
      stage:
        "necessidade",
    };
  }

  /*
  ===========================================
  RETORNO
  ===========================================
  */

  if (
    stage ===
    "retorno"
  ) {
    if (!attrs.ia_nome) {
      await updateConversationAttributes(
        conversationId,
        {
          ...attrs,

          ia_etapa:
            "nome",
        }
      );

      await sendMessage(
        conversationId,

        "Olá novamente! Para retomarmos seu atendimento, me informe seu nome completo."
      );

      return {
        stage:
          "nome",
      };
    }

    if (!attrs.ia_cidade) {
      await updateConversationAttributes(
        conversationId,
        {
          ...attrs,

          ia_etapa:
            "cidade",
        }
      );

      await sendMessage(
        conversationId,

        `${firstName(
          attrs.ia_nome
        )}, que bom falar com você novamente 😊

Me informe a cidade relacionada ao atendimento, por favor.`
      );

      return {
        stage:
          "cidade",
      };
    }

    return routeCustomerNeed(
      conversationId,
      attrs,
      text
    );
  }

  /*
  ===========================================
  NECESSIDADE
  ===========================================
  */

  if (
    stage ===
    "necessidade"
  ) {
    return routeCustomerNeed(
      conversationId,
      attrs,
      text
    );
  }

  /*
  ===========================================
  ESCLARECIMENTO
  ===========================================
  */

  if (
    stage ===
    "esclarecimento"
  ) {
    return routeCustomerNeed(
      conversationId,
      attrs,
      text
    );
  }

  /*
  ===========================================
  SETOR
  ===========================================
  */

  if (
    stage ===
    "setor"
  ) {
    const direct =
      directSectorMatch(
        text
      );

    if (!direct) {
      await sendMessage(
        conversationId,

        `${firstName(
          attrs.ia_nome
        ) || "Olá"}, escolha uma das opções de 1 a 6 para eu direcionar seu atendimento:

1. Atendimento
2. Comercial
3. Financeiro
4. Projetos
5. Topografia
6. Pós-Protocolo`
      );

      return {
        stage:
          "setor",
      };
    }

    const nextAttrs = {
      ...attrs,

      ia_setor:
        direct,

      ia_etapa:
        "motivo",

      ia_atendimento_concluido:
        false,

      ia_tentativas_esclarecimento:
        0,
    };

    await updateConversationAttributes(
      conversationId,
      nextAttrs
    );

    await sendMessage(
      conversationId,

      `${firstName(
        attrs.ia_nome
      )}, certo. Me conte brevemente o que você deseja tratar com o setor de ${direct}.`
    );

    return {
      stage:
        "motivo",

      sector:
        direct,
    };
  }

  /*
  ===========================================
  MOTIVO
  ===========================================
  */

  if (
    stage ===
    "motivo"
  ) {
    if (
      !validContactReason(
        text
      )
    ) {
      await sendMessage(
        conversationId,

        `${firstName(
          attrs.ia_nome
        )}, pode me explicar brevemente o que você precisa?`
      );

      return {
        stage:
          "motivo",
      };
    }

    /*
    MUITO IMPORTANTE:

    Aqui o cliente já escolheu o setor.

    Portanto, se ele disser:
    "quero falar sobre o andamento do processo"

    NÃO mostramos o andamento novamente.

    Agora essa mensagem é o MOTIVO
    que será analisado para encaminhamento.
    */

    return routeCustomerNeed(
      conversationId,
      attrs,
      text,
      {
        allowProgress:
          false,
      }
    );
  }

  /*
  ===========================================
  FALLBACK
  ===========================================
  */

  await updateConversationAttributes(
    conversationId,
    {
      ...attrs,

      ia_etapa:
        "necessidade",

      ia_atendimento_concluido:
        false,
    }
  );

  await sendMessage(
    conversationId,

    `${firstName(
      attrs.ia_nome
    ) || "Olá"}, como posso ajudar você?`
  );

  return {
    stage:
      "necessidade",
  };
}
