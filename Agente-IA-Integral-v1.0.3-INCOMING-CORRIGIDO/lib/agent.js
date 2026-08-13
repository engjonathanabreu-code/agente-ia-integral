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
  Atendimento: [
    "atendimento",
  ],

  Comercial: [
    "comercial",
    "vendas",
  ],

  Financeiro: [
    "financeiro",
    "cobranca",
    "cobrança",
  ],

  Projetos: [
    "projetos",
    "projeto",
  ],

  Topografia: [
    "topografia",
    "topografico",
    "topográfico",
  ],

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
  return normalize(value)
    .replace(/\s+/g, " ");
}


function firstName(name) {
  return (
    String(name || "")
      .trim()
      .split(/\s+/)[0] ||
    ""
  );
}


/*
===========================================
SAUDAÇÃO / CONVERSA SIMPLES
===========================================
*/

function isSimpleGreeting(message) {
  const text =
    normalizeText(message);


  const greetings = [
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
  ];


  return greetings
    .map(normalizeText)
    .includes(text);
}


/*
===========================================
INTENÇÃO DE ANDAMENTO
===========================================
*/

function isAndamentoIntent(message) {
  const text =
    normalizeText(message);


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
    "protocolo",

    "prefeitura analisou",

    "cartorio analisou",
    "cartório analisou",

    "registro de imoveis",
    "registro de imóveis",

    "crf",
  ];


  return terms.some(
    (term) =>
      text.includes(
        normalizeText(term)
      )
  );
}


/*
===========================================
AÇÕES DE MAIOR RISCO
===========================================
*/

function isSensitiveActionIntent(message) {
  const text =
    normalizeText(message);


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
    "assinar por mim",
  ];


  return terms.some(
    (term) =>
      text.includes(
        normalizeText(term)
      )
  );
}


/*
===========================================
CONSULTA CRM / ANDAMENTO
===========================================
*/

async function getClientProgress(
  conversationId
) {
  const secret =
    process.env.CRM_AGENT_READ_SECRET;


  const baseUrl =
    process.env.CRM_BASE_URL ||
    "https://www.crmintegralreurb.work";


  if (!secret) {

    console.error(
      "CRM_AGENT_READ_SECRET não configurado no Agente IA."
    );


    return {
      ok: false,
      code:
        "CRM_SECRET_MISSING",
    };
  }


  try {

    const response =
      await fetch(
        `${baseUrl}/api/andamento-cliente`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Bearer ${secret}`,

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              conversation_id:
                conversationId,
            }),
        }
      );


    const text =
      await response.text();


    let data =
      null;


    try {

      data =
        text
          ? JSON.parse(text)
          : null;

    } catch {

      data = {
        ok: false,

        error:
          "Resposta inválida do CRM.",
      };
    }


    if (!response.ok) {

      console.error(
        "Erro consulta andamento CRM:",
        {
          status:
            response.status,

          response:
            data,
        }
      );


      return {
        ok: false,

        code:
          "CRM_REQUEST_ERROR",

        status:
          response.status,
      };
    }


    console.log(
      "Consulta andamento CRM:",
      {
        conversationId,

        found:
          data?.found,

        andamentoAvailable:
          data?.andamento_available,

        code:
          data?.code ||
          null,
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

      code:
        "CRM_CONNECTION_ERROR",
    };
  }
}


/*
===========================================
RESPOSTA DE ANDAMENTO
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


  if (name) {
    parts.push(
      `${name}, consultei seu processo no nosso sistema.`
    );
  } else {
    parts.push(
      "Consultei seu processo no nosso sistema."
    );
  }


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


    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {

      const formatted =
        new Intl.DateTimeFormat(
          "pt-BR"
        ).format(date);


      parts.push(
        `Previsão registrada: ${formatted}.`
      );
    }
  }


  if (progress.orientacao_ia) {

    parts.push(
      progress.orientacao_ia
    );
  }


  parts.push(
    "Se precisar de mais alguma informação sobre esse processo, pode me perguntar por aqui."
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
  if (
    !isAndamentoIntent(text)
  ) {
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


  if (
    result.found === false
  ) {

    return null;
  }


  if (
    result.code ===
    "PROJETO_NAO_VINCULADO"
  ) {

    return {
      handled:
        false,

      forceHandoff:
        true,

      reason:
        "project_not_linked",

      handoffMessage:
        `${firstName(
          attrs?.ia_nome ||
          result?.cliente?.nome
        ) || "Olá"}, localizei seu cadastro, mas ele ainda não está vinculado a um Projeto/Núcleo no nosso sistema.

Por isso, vou encaminhar seu atendimento para a equipe verificar essa vinculação e consultar o andamento correto.`,
    };
  }


  if (
    result.andamento_available ===
      false
  ) {

    return {
      handled:
        false,

      forceHandoff:
        true,

      reason:
        "progress_not_available",

      handoffMessage:
        `${firstName(
          attrs?.ia_nome ||
          result?.cliente?.nome
        ) || "Olá"}, localizei seu cadastro e o Projeto/Núcleo relacionado, mas não há uma atualização liberada para consulta automática neste momento.

Vou encaminhar seu atendimento para a equipe responsável verificar a situação atual.`,
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

      ia_atendimento_concluido:
        false,
    }
  );


  return {
    handled:
      true,

    andamento:
      result,
  };
}


/*
===========================================
NOME
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


  const words =
    clean
      .split(" ")
      .filter(Boolean);


  if (words.length < 2) {
    return false;
  }


  if (/\d/.test(clean)) {
    return false;
  }


  if (
    !/^[A-Za-zÀ-ÿ'’\-\s]+$/.test(clean)
  ) {
    return false;
  }


  return true;
}


/*
===========================================
CIDADE
===========================================
*/

function isCityRefusal(value) {
  const text =
    normalizeText(value);


  const invalid = [
    "nao",
    "não",
    "nao quero",
    "não quero",
    "prefiro nao",
    "prefiro não",
    "nao quero informar",
    "não quero informar",
    "nao sei",
    "não sei",
    "tanto faz",
    "nao importa",
    "não importa",
  ];


  return invalid.some(
    (item) =>
      text ===
      normalizeText(item)
  );
}


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


  if (
    isCityRefusal(clean)
  ) {
    return false;
  }


  if (
    clean.includes("?") ||
    /\d{4,}/.test(clean)
  ) {
    return false;
  }


  if (
    clean.includes("@") ||
    clean.includes("http://") ||
    clean.includes("https://")
  ) {
    return false;
  }


  return /^[A-Za-zÀ-ÿ'’\-\s]+$/.test(
    clean
  );
}


/*
===========================================
MOTIVO SUFICIENTE
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


  if (
    isSimpleGreeting(clean)
  ) {
    return false;
  }


  return true;
}


/*
===========================================
CLASSIFICAÇÃO DIRETA
===========================================
*/

function directSectorMatch(message) {
  const t =
    normalizeText(message);


  const patterns = [
    [
      "Financeiro",
      [
        "financeiro",
        "boleto",
        "parcela",
        "pagamento",
        "pix",
        "cobranca",
        "cobrança",
        "nota fiscal",
        "segunda via",
        "comprovante",
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
        "preco",
        "preço",
        "valor",
        "novo servico",
        "novo serviço",
        "vendas",
      ],
    ],

    [
      "Atendimento",
      [
        "atendimento",
        "atendente",
        "humano",
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


  const numeric =
    t.match(/^([1-6])$/)?.[1];


  if (numeric) {

    return SECTORS[
      Number(numeric) - 1
    ];
  }


  return null;
}


/*
===========================================
CLASSIFICADOR CONTEXTUAL
===========================================
*/

async function contextualIntent(
  message
) {
  const direct =
    directSectorMatch(message);


  /*
  Casos muito claros não precisam
  gastar chamada de IA.
  */

  if (
    direct &&
    validContactReason(message)
  ) {

    return {
      sector:
        direct,

      confidence:
        "high",

      needsClarification:
        false,

      needsHuman:
        isSensitiveActionIntent(
          message
        ),

      clarificationQuestion:
        null,
    };
  }


  const apiKey =
    process.env.OPENAI_API_KEY;


  if (!apiKey) {

    return {
      sector:
        direct,

      confidence:
        direct
          ? "medium"
          : "low",

      needsClarification:
        !direct,

      needsHuman:
        false,

      clarificationQuestion:
        null,
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
        effort:
          "low",
      },

      instructions: `
Você é o classificador de atendimento da Integral Soluções em Engenharia.

Analise a mensagem e responda SOMENTE em JSON válido.

Formato:
{
  "sector": "Atendimento|Comercial|Financeiro|Projetos|Topografia|Pós-Protocolo|INDEFINIDO",
  "confidence": "high|medium|low",
  "needsClarification": true,
  "needsHuman": false,
  "clarificationQuestion": "pergunta curta ou null"
}

Regras:

Financeiro:
boleto, parcelas, pagamento, cobrança, PIX, nota fiscal, comprovante e segunda via.

Comercial:
orçamento, proposta, contratação, preço, novos serviços e vendas.

Projetos:
planta, memorial, projeto técnico, engenharia, correção técnica.

Topografia:
medição, levantamento, campo, topógrafo, demarcação.

Pós-Protocolo:
somente assuntos claramente posteriores ao protocolo, Prefeitura, Cartório, Registro de Imóveis ou CRF.

Atendimento:
documentação, dúvidas gerais e assuntos administrativos não enquadrados acima.

Se a mensagem for ambígua, use confidence medium ou low e formule UMA pergunta curta para esclarecer.

Se envolver negociação, concessão de desconto, alteração contratual, promessa de prazo, alteração financeira ou decisão excepcional:
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
        ["high", "medium", "low"]
          .includes(
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
      sector:
        direct,

      confidence:
        direct
          ? "medium"
          : "low",

      needsClarification:
        !direct,

      needsHuman:
        false,

      clarificationQuestion:
        null,
    };
  }
}


/*
===========================================
TEXTO OU ÁUDIO
===========================================
*/

async function extractCustomerText(
  payload
) {
  const text =
    String(
      payload?.content ||
      ""
    ).trim();


  if (text) {

    return {
      text,
      source:
        "text",
    };
  }


  try {

    const transcription =
      await transcriptionFromPayload(
        payload
      );


    if (transcription) {

      return {
        text:
          transcription,

        source:
          "audio",
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
    source:
      "unknown",
  };
}


/*
===========================================
LOCALIZA TIME
===========================================
*/

async function findTeamIdForSector(
  sector
) {
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


  return found?.id ||
    null;
}


/*
===========================================
MENU FALLBACK
===========================================
*/

function menuText(name) {
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


  let assigned =
    false;


  if (teamId) {

    try {

      await assignConversationToTeam(
        conversationId,
        teamId
      );


      assigned =
        true;

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


  if (customMessage) {

    await sendMessage(
      conversationId,
      `${customMessage}

Seu atendimento já foi encaminhado para o setor de ${sector}. Agora é só aguardar a continuidade por aqui.`
    );


    return {
      stage:
        "encaminhado",

      sector,

      assigned,
    };
  }


  const name =
    firstName(
      attrs.ia_nome
    );


  await sendMessage(
    conversationId,
    `${name ? `${name}, ` : ""}encaminhei seu atendimento para o setor de ${sector} com o contexto da sua solicitação.

Agora é só aguardar a continuidade por aqui.`
  );


  return {
    stage:
      "encaminhado",

    sector,

    assigned,
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
  text
) {
  /*
  Primeiro: andamento.
  */

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
      handled:
        true,

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


  /*
  Ações sensíveis:
  sempre humano.
  */

  if (
    isSensitiveActionIntent(text)
  ) {

    const classification =
      await contextualIntent(
        text
      );


    return handoffToSector(
      conversationId,
      attrs,
      classification.sector ||
      "Atendimento",
      text,
      `${firstName(
        attrs.ia_nome
      ) || "Olá"}, esse tipo de solicitação precisa ser analisado por uma pessoa da nossa equipe.`
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
    }
  );


  /*
  IA considera que precisa de humano.
  */

  if (
    intent.needsHuman
  ) {

    return handoffToSector(
      conversationId,
      attrs,
      intent.sector ||
      "Atendimento",
      text
    );
  }


  /*
  Confiança alta e motivo suficiente:
  encaminha direto.
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
  Confiança média:
  faz uma pergunta.
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


    if (
      attempts >= 1
    ) {

      return handoffToSector(
        conversationId,
        attrs,
        intent.sector ||
        "Atendimento",
        text,
        `${firstName(
          attrs.ia_nome
        ) || "Olá"}, não consegui identificar sua necessidade com segurança. Vou encaminhar para nossa equipe continuar com você.`
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
      handled:
        true,

      action:
        "clarification",
    };
  }


  /*
  Baixa confiança:
  menu apenas como fallback.
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
    menuText(
      attrs.ia_nome
    )
  );


  return {
    handled:
      true,

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
      ignored:
        true,

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
      ignored:
        true,

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
    stage:
      "retorno",

    rearmed:
      true,
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
      ignored:
        true,

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
      ignored:
        true,

      reason:
        "human_handoff_active",
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
            "retorno",

          ia_atendimento_concluido:
            false,
        }
      );


      if (
        isSimpleGreeting(
          text
        )
      ) {

        await sendMessage(
          conversationId,
          `Olá, ${firstName(
            attrs.ia_nome
          )}! Que legal falar com você novamente 😊

Como posso ajudar hoje?`
        );


        return {
          stage:
            "retorno",
        };
      }


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

    if (
      !attrs.ia_nome
    ) {

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


    if (
      !attrs.ia_cidade
    ) {

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


    if (
      isSimpleGreeting(
        text
      )
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


      await sendMessage(
        conversationId,
        `Olá, ${firstName(
          attrs.ia_nome
        )}! Que legal falar com você novamente 😊

Como posso ajudar hoje?`
      );


      return {
        stage:
          "necessidade",
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
  SETOR VIA MENU
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

        ia_setor:
          direct,

        ia_etapa:
          "motivo",

        ia_atendimento_concluido:
          false,
      }
    );


    await sendMessage(
      conversationId,
      `${firstName(
        attrs.ia_nome
      )}, certo. Me conte brevemente o que você precisa em relação ao setor de ${direct}.`
    );


    return {
      stage:
        "motivo",
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


    return routeCustomerNeed(
      conversationId,
      attrs,
      text
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
