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
FORMATA RESPOSTA DO ANDAMENTO
===========================================
*/

function progressResponseText(data) {
  const name =
    firstName(
      data?.cliente?.nome
    );


  const prefix =
    name
      ? `${name}, `
      : "";


  const progress =
    data?.andamento_atual;


  if (!progress) {
    return null;
  }


  const parts = [];


  parts.push(
    `${prefix}consultei seu processo no nosso sistema.`
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
    "Se quiser, também posso encaminhar seu atendimento para a equipe responsável."
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


  /*
  CRM indisponível:
  não bloqueia o atendimento.
  */

  if (
    !result ||
    result.ok === false
  ) {

    console.warn(
      "Consulta de andamento indisponível. Fluxo normal será mantido.",
      {
        conversationId,
        code:
          result?.code ||
          null,
      }
    );


    return null;
  }


  /*
  Cliente não encontrado.
  Continua para humano.
  */

  if (
    result.found === false
  ) {

    return null;
  }


  /*
  Cliente encontrado,
  mas sem Projeto/NUI.
  */

  if (
    result.code ===
    "PROJETO_NAO_VINCULADO"
  ) {

    await sendMessage(
      conversationId,
      `${firstName(
        attrs?.ia_nome ||
        result?.cliente?.nome
      ) || "Olá"}, localizei seu cadastro, mas ele ainda não está vinculado a um Projeto/Núcleo no nosso sistema.

Vou encaminhar seu atendimento para a equipe verificar essa vinculação e consultar o andamento correto.`
    );


    return {
      handled:
        false,

      forceHandoff:
        true,

      reason:
        "project_not_linked",
    };
  }


  /*
  Cliente possui projeto,
  mas não há andamento liberado.
  */

  if (
    result.andamento_available ===
      false
  ) {

    await sendMessage(
      conversationId,
      `${firstName(
        attrs?.ia_nome ||
        result?.cliente?.nome
      ) || "Olá"}, localizei seu cadastro e o Projeto/Núcleo relacionado, mas não há uma atualização de andamento liberada para consulta automática neste momento.

Vou encaminhar seu atendimento para a equipe responsável verificar a situação atual.`
    );


    return {
      handled:
        false,

      forceHandoff:
        true,

      reason:
        "progress_not_available",
    };
  }


  /*
  Andamento encontrado.
  Responde diretamente.
  */

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

      ia_etapa:
        attrs?.ia_etapa ||
        "setor",

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


  const normalized =
    normalizeText(clean);


  const invalidNames = [
    "nao quero",
    "não quero",
    "nao sei",
    "não sei",
    "prefiro nao",
    "prefiro não",
    "quero atendimento",
    "quero falar com alguem",
    "quero falar com alguém",
    "meu nome",
    "nome completo",
    "atendimento",
    "financeiro",
    "comercial",
    "projetos",
    "topografia",
    "pos protocolo",
    "pós protocolo",
  ];


  if (
    invalidNames
      .map(normalizeText)
      .includes(normalized)
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
    "nao vou informar",
    "não vou informar",
    "nao quero dizer",
    "não quero dizer",
    "prefiro nao dizer",
    "prefiro não dizer",
    "nao sei",
    "não sei",
    "nao lembro",
    "não lembro",
    "nenhuma",
    "nenhum",
    "qualquer",
    "tanto faz",
    "nao importa",
    "não importa",
    "pra que",
    "para que",
    "por que",
    "porque",
    "nao interessa",
    "não interessa",
    "nao te interessa",
    "não te interessa",
    "isso e pessoal",
    "isso é pessoal",
  ];


  return invalid.some(
    (item) =>
      text === normalizeText(item) ||
      text.startsWith(
        `${normalizeText(item)} `
      )
  );
}


function validCity(value) {
  const clean =
    String(value || "")
      .trim()
      .replace(/\s+/g, " ");


  const text =
    normalizeText(clean);


  if (
    clean.length < 2 ||
    clean.length > 80
  ) {
    return false;
  }


  if (isCityRefusal(clean)) {
    return false;
  }


  const invalid = [
    "sim",
    "ok",
    "okay",
    "okk",
    "beleza",
    "blz",
    "show",
    "entendi",
    "obrigado",
    "obrigada",
    "valeu",

    "atendimento",
    "comercial",
    "financeiro",
    "projetos",
    "topografia",
    "pos protocolo",
    "pós protocolo",

    "atendente",
    "humano",
    "quero ajuda",
    "preciso de ajuda",

    "teste",
    "cidade",

    "brasil",
    "sc",
    "pr",
    "rs",
    "sp",
    "mg",
    "rj",

    "agora",
    "depois",
    "hoje",
    "amanha",
    "amanhã",

    "aqui",
    "ali",
    "la",
    "lá",
  ];


  if (
    invalid
      .map(normalizeText)
      .includes(text)
  ) {
    return false;
  }


  if (clean.includes("?")) {
    return false;
  }


  if (/\d{4,}/.test(clean)) {
    return false;
  }


  if (
    clean.includes("@") ||
    clean.includes("http://") ||
    clean.includes("https://") ||
    clean.includes("www.")
  ) {
    return false;
  }


  if (
    clean
      .split(/\s+/)
      .filter(Boolean)
      .length > 6
  ) {
    return false;
  }


  return /^[A-Za-zÀ-ÿ'’\-\s]+$/.test(
    clean
  );
}


/*
===========================================
MOTIVO DO CONTATO
===========================================
*/

function validContactReason(value) {
  const clean =
    String(value || "")
      .trim()
      .replace(/\s+/g, " ");


  const text =
    normalizeText(clean);


  if (clean.length < 5) {
    return false;
  }


  if (clean.length > 1500) {
    return false;
  }


  const invalid = [
    "nao sei",
    "não sei",
    "nao quero dizer",
    "não quero dizer",
    "nao quero falar",
    "não quero falar",
    "prefiro nao dizer",
    "prefiro não dizer",
    "nada",
    "nenhum",
    "nenhuma",
    "qualquer coisa",
    "tanto faz",
    "sei la",
    "sei lá",
    "sim",
    "nao",
    "não",
    "ok",
    "okay",
    "beleza",
    "blz",
    "bom dia",
    "boa tarde",
    "boa noite",
    "teste",
    "testando",
    "abc",
    "asdf",
  ];


  if (
    invalid
      .map(normalizeText)
      .includes(text)
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
        "pagar",
        "pix",
        "cobranca",
        "cobrança",
        "divida",
        "dívida",
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
        "equipe de campo",
      ],
    ],

    [
      "Pós-Protocolo",
      [
        "pos protocolo",
        "pós protocolo",
        "processo protocolado",
        "ja foi protocolado",
        "já foi protocolado",
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
        "falar com alguem",
        "falar com alguém",
        "duvida",
        "dúvida",
        "informacao",
        "informação",
        "andamento",
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
CLASSIFICAÇÃO COM IA
===========================================
*/

async function aiSectorMatch(message) {
  const apiKey =
    process.env.OPENAI_API_KEY;


  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY não configurada."
    );
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

Escolha exatamente UM:

Atendimento
Comercial
Financeiro
Projetos
Topografia
Pós-Protocolo
INDEFINIDO

Financeiro:
boletos, pagamentos, parcelas, cobranças, notas fiscais, PIX, segunda via e comprovantes.

Comercial:
orçamento, proposta, preço, contratação, novos serviços e vendas.

Projetos:
projetos técnicos, plantas, memoriais, correções e engenharia.

Topografia:
levantamentos, medições, serviços de campo e topografia.

Pós-Protocolo:
SOMENTE quando o processo já tiver sido protocolado ou quando a solicitação tratar claramente de Prefeitura, Cartório, Registro de Imóveis ou CRF.

Atendimento:
dúvidas gerais, documentação, acompanhamento e pedidos genéricos de andamento sem indicação de protocolo.

Se não houver informação suficiente:
INDEFINIDO.

Responda somente com o nome exato.
`,

      input:
        String(message || ""),
    });


  const answer =
    String(
      response.output_text ||
      ""
    ).trim();


  return SECTORS.includes(answer)
    ? answer
    : null;
}


async function classifySector(message) {
  return (
    directSectorMatch(message) ||
    await aiSectorMatch(message)
  );
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
      source: "text",
    };
  }


  try {
    const transcription =
      await transcriptionFromPayload(
        payload
      );


    if (transcription) {
      console.log(
        "Áudio do cliente transcrito",
        {
          message_id:
            payload?.id,

          transcription,
        }
      );


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
    source: "unknown",
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


  return found?.id || null;
}


/*
===========================================
MENU
===========================================
*/

function menuText(name) {
  const prefix =
    name
      ? `${firstName(name)}, `
      : "";


  return `${prefix}com qual setor você deseja falar?

1. Atendimento
2. Comercial
3. Financeiro
4. Projetos
5. Topografia
6. Pós-Protocolo

Você também pode escrever ou enviar um áudio explicando o que precisa.`;
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
  contactReason
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
    }
  );


  const name =
    firstName(
      attrs.ia_nome
    );


  const prefix =
    name
      ? `${name}, `
      : "";


  const message =
    assigned
      ? `${prefix}obrigado. Já registrei o motivo do seu contato e encaminhei seu atendimento para o setor de ${sector}.

A equipe responsável receberá sua solicitação com estas informações:

“${contactReason}”

Agora é só aguardar a continuidade do atendimento por aqui.`
      : `${prefix}obrigado. Já registrei o motivo do seu contato para o setor de ${sector}.

Sua solicitação foi registrada com estas informações:

“${contactReason}”

A equipe responsável dará continuidade por aqui.`;


  await sendMessage(
    conversationId,
    message
  );


  return {
    stage: "encaminhado",
    sector,
    contactReason,
    assigned,
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


  if (status !== "resolved") {
    return {
      ignored: true,
      reason:
        "status_not_resolved",
      status,
    };
  }


  const conversation =
    await getConversation(
      conversationId
    );


  const attrs =
    conversation?.custom_attributes ||
    {};


  const wasHandedOff =
    attrs.ia_atendimento_concluido ===
      true ||
    attrs.ia_etapa ===
      "encaminhado";


  if (!wasHandedOff) {
    return {
      ignored: true,
      reason:
        "not_an_ai_handoff",
    };
  }


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
      "Não consegui interpretar essa mensagem. Você pode escrever sua solicitação ou enviar novamente o áudio?"
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
  CONSULTA AUTOMÁTICA DE ANDAMENTO
  ===========================================

  Antes de classificar ou encaminhar,
  verifica se o cliente está perguntando
  pelo andamento do próprio processo.
  */

  if (
    stage !== "nome" &&
    stage !== "cidade"
  ) {

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
        stage:
          stage,

        progressAnswered:
          true,
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
        text
      );
    }
  }


  /*
  ===========================================
  RETORNO
  ===========================================
  */

  if (stage === "retorno") {

    if (!attrs.ia_nome) {

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
        "Olá novamente! 👋 Para retomarmos seu atendimento, por favor, informe seu nome completo."
      );


      return {
        stage: "nome",
        return_flow: true,
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
        )}, que bom falar com você novamente. Me informe a cidade relacionada ao atendimento, por favor.`
      );


      return {
        stage: "cidade",
        return_flow: true,
      };
    }


    const sector =
      await classifySector(
        text
      );


    if (sector) {

      await updateConversationAttributes(
        conversationId,
        {
          ...attrs,

          ia_setor:
            sector,

          ia_motivo_contato:
            "",

          ia_etapa:
            "motivo",
        }
      );


      await sendMessage(
        conversationId,
        `${firstName(
          attrs.ia_nome
        )}, entendi. Vou direcionar seu atendimento para o setor de ${sector}.

Antes de encaminhar, me conte brevemente sobre o que você gostaria de falar. Você pode escrever ou enviar um áudio.`
      );


      return {
        stage: "motivo",
        sector,
      };
    }


    await updateConversationAttributes(
      conversationId,
      {
        ...attrs,

        ia_etapa:
          "setor",
      }
    );


    await sendMessage(
      conversationId,
      menuText(
        attrs.ia_nome
      )
    );


    return {
      stage: "setor",
    };
  }


  /*
  ===========================================
  PRIMEIRO CONTATO
  ===========================================
  */

  if (stage === "inicio") {

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
      "Olá! 👋 Sou o assistente virtual da Integral Soluções em Engenharia. Para iniciarmos seu atendimento, por favor, informe seu nome completo."
    );


    return {
      stage: "nome",
    };
  }


  /*
  ===========================================
  NOME
  ===========================================
  */

  if (stage === "nome") {

    if (
      !validFullName(text)
    ) {

      await sendMessage(
        conversationId,
        "Para registrar seu atendimento corretamente, preciso do seu nome completo. Por favor, informe seu nome e sobrenome."
      );


      return {
        stage: "nome",
        retry: true,
        reason:
          "invalid_name",
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
      )}. Agora me informe a cidade relacionada ao seu atendimento.`
    );


    return {
      stage: "cidade",
    };
  }


  /*
  ===========================================
  CIDADE
  ===========================================
  */

  if (stage === "cidade") {

    if (
      isCityRefusal(text)
    ) {

      await sendMessage(
        conversationId,
        `${firstName(
          attrs.ia_nome
        )}, entendo. 😊 A cidade é necessária para que eu consiga direcionar seu atendimento corretamente para a equipe responsável.

Por favor, me informe apenas o nome da cidade relacionada ao atendimento.`
      );


      return {
        stage: "cidade",
        retry: true,
        reason:
          "city_refused",
      };
    }


    if (!validCity(text)) {

      await sendMessage(
        conversationId,
        `${firstName(
          attrs.ia_nome
        )}, não consegui identificar uma cidade nessa resposta.

Por favor, informe apenas o nome da cidade relacionada ao atendimento, por exemplo: Ibirama, Rio do Sul, Blumenau ou Florianópolis.`
      );


      return {
        stage: "cidade",
        retry: true,
        reason:
          "invalid_city",
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
          "setor",
      }
    );


    await sendMessage(
      conversationId,
      menuText(
        attrs.ia_nome
      )
    );


    return {
      stage: "setor",
      city,
    };
  }


  /*
  ===========================================
  SETOR
  ===========================================
  */

  if (stage === "setor") {

    const sector =
      await classifySector(
        text
      );


    if (!sector) {

      await sendMessage(
        conversationId,
        `Não consegui identificar o setor com segurança.

${menuText(
  attrs.ia_nome
)}`
      );


      return {
        stage: "setor",
        retry: true,
      };
    }


    await updateConversationAttributes(
      conversationId,
      {
        ...attrs,

        ia_setor:
          sector,

        ia_motivo_contato:
          "",

        ia_etapa:
          "motivo",
      }
    );


    await sendMessage(
      conversationId,
      `${firstName(
        attrs.ia_nome
      )}, certo. Vou direcionar seu atendimento para o setor de ${sector}.

Antes de encaminhar, me conte brevemente sobre o que você gostaria de falar. Você pode escrever ou enviar um áudio.`
    );


    return {
      stage: "motivo",
      sector,
    };
  }


  /*
  ===========================================
  MOTIVO DO CONTATO
  ===========================================
  */

  if (stage === "motivo") {

    if (
      !validContactReason(
        text
      )
    ) {

      await sendMessage(
        conversationId,
        `${firstName(
          attrs.ia_nome
        )}, preciso de uma breve descrição para que o atendente já receba seu atendimento com o contexto correto.

Por exemplo:
“Preciso da segunda via do boleto”
ou
“Gostaria de saber quando será realizada a topografia”.

Pode escrever ou enviar um áudio.`
      );


      return {
        stage: "motivo",
        retry: true,
        reason:
          "invalid_contact_reason",
      };
    }


    /*
    Tenta novamente consultar andamento
    pelo motivo informado.
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

      await updateConversationAttributes(
        conversationId,
        {
          ...attrs,

          ia_setor:
            "Atendimento",

          ia_motivo_contato:
            text,

          ia_etapa:
            "setor",

          ia_atendimento_concluido:
            false,
        }
      );


      return {
        stage:
          "setor",

        progressAnswered:
          true,
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
        text
      );
    }


    /*
    ===========================================
    SEGUNDA CLASSIFICAÇÃO INTELIGENTE
    ===========================================
    */

    const detectedSector =
      await classifySector(
        text
      );


    const selectedSector =
      attrs.ia_setor;


    let finalSector =
      selectedSector;


    if (detectedSector) {
      finalSector =
        detectedSector;
    }


    if (
      detectedSector &&
      detectedSector !==
        selectedSector
    ) {

      console.log(
        "Setor corrigido pelo motivo do contato",
        {
          selectedSector,
          detectedSector,
          reason: text,
        }
      );
    }


    return handoffToSector(
      conversationId,
      attrs,
      finalSector,
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
        "nome",

      ia_atendimento_concluido:
        false,
    }
  );


  await sendMessage(
    conversationId,
    "Vamos reiniciar seu atendimento. Por favor, informe seu nome completo."
  );


  return {
    stage: "nome",
    reset: true,
  };
}
