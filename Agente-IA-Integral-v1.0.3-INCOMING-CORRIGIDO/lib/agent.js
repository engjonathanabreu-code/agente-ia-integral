import OpenAI from "openai";
import {
  assignConversationToTeam,
  getConversation,
  listTeams,
  sendMessage,
  updateConversationAttributes,
} from "./chatwoot.js";

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
    "pós protocolo e atualizações",
    "pos protocolo e atualizacoes",
  ],
};

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function firstName(fullName) {
  return String(fullName || "").trim().split(/\s+/)[0] || "";
}

function validFullName(value) {
  const clean = String(value || "").trim().replace(/\s+/g, " ");

  return (
    clean.length >= 5 &&
    clean.split(" ").filter(Boolean).length >= 2 &&
    !/\d/.test(clean)
  );
}

function validCity(value) {
  const clean = String(value || "").trim();

  return (
    clean.length >= 2 &&
    clean.length <= 80 &&
    !/^[0-9]+$/.test(clean)
  );
}

function directSectorMatch(message) {
  const t = normalize(message);

  const patterns = [
    [
      "Financeiro",
      [
        "financeiro",
        "boleto",
        "parcela",
        "pagamento",
        "pagar",
        "cobranca",
        "divida",
        "pix",
        "nota fiscal",
      ],
    ],

    [
      "Topografia",
      [
        "topografia",
        "topografo",
        "medicao",
        "medir terreno",
        "levantamento de campo",
        "le pac",
        "lepac",
      ],
    ],

    [
      "Pós-Protocolo",
      [
        "pos protocolo",
        "protocolo na prefeitura",
        "prefeitura",
        "registro de imoveis",
        "cartorio",
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
      ],
    ],

    [
      "Comercial",
      [
        "comercial",
        "orcamento",
        "proposta",
        "contratar",
        "preco",
        "valor do servico",
        "novo servico",
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
        "duvida",
        "informacao geral",
        "andamento",
      ],
    ],
  ];

  for (const [sector, terms] of patterns) {
    if (terms.some((term) => t.includes(term))) {
      return sector;
    }
  }

  const numeric = t.match(/^\s*([1-6])\s*$/)?.[1];

  if (numeric) {
    return SECTORS[Number(numeric) - 1];
  }

  return null;
}

async function aiSectorMatch(message) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY não configurada.");
  }

  const client = new OpenAI({ apiKey });

  const model =
    process.env.OPENAI_MODEL ||
    "gpt-5.6-luna";

  const response = await client.responses.create({
    model,

    reasoning: {
      effort: "low",
    },

    instructions: `
Você classifica mensagens de clientes da Integral Soluções em Engenharia.

Escolha exatamente UM destes setores:

Atendimento
Comercial
Financeiro
Projetos
Topografia
Pós-Protocolo
INDEFINIDO

Regras:

- Financeiro: pagamentos, boletos, parcelas, cobranças e notas fiscais.

- Comercial: orçamento, contratação, proposta e novos serviços.

- Projetos: projeto técnico, planta, memorial e elaboração técnica.

- Topografia: medição de campo, levantamento topográfico e equipe em campo.

- Pós-Protocolo: SOMENTE quando existir indicação de que o processo já foi protocolado ou quando a mensagem tratar claramente de prefeitura, cartório, registro de imóveis ou CRF depois do protocolo.

- Atendimento: demandas gerais, pedido explícito de atendente e pedidos genéricos de andamento quando não houver indicação de que o processo já foi protocolado.

- Se não houver informação suficiente, responda INDEFINIDO.

Responda somente com o nome exato do setor.
Não explique.
Não use pontuação.
`,

    input: String(message || ""),
  });

  const answer = String(response.output_text || "").trim();

  return SECTORS.includes(answer)
    ? answer
    : null;
}

async function classifySector(message) {
  return (
    directSectorMatch(message) ||
    (await aiSectorMatch(message))
  );
}

async function findTeamIdForSector(sector) {
  const teams = await listTeams();

  const aliases =
    TEAM_ALIASES[sector] ||
    [sector];

  const normalizedAliases =
    aliases.map(normalize);

  const found = (teams || []).find((team) => {
    const name = normalize(team.name);

    return normalizedAliases.some(
      (alias) =>
        name === alias ||
        name.includes(alias)
    );
  });

  return found?.id || null;
}

function menuText(name) {
  const greeting = name
    ? `${firstName(name)}, `
    : "";

  return `${greeting}com qual setor você deseja falar?

1. Atendimento
2. Comercial
3. Financeiro
4. Projetos
5. Topografia
6. Pós-Protocolo

Você também pode escrever com suas palavras o que precisa.`;
}

async function handoffToSector(
  conversationId,
  attrs,
  sector
) {
  const teamId =
    await findTeamIdForSector(sector);

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

      ia_setor: sector,

      ia_etapa: "encaminhado",

      ia_atendimento_concluido: true,
    }
  );

  const name =
    firstName(attrs.ia_nome);

  const prefix =
    name ? `${name}, ` : "";

  const message = assigned
    ? `${prefix}obrigado. Identifiquei que seu atendimento é com o setor de ${sector}. Encaminhei sua conversa para a equipe responsável, que dará continuidade por aqui.`
    : `${prefix}obrigado. Identifiquei que seu atendimento é com o setor de ${sector}. Sua solicitação foi registrada e a equipe responsável dará continuidade por aqui.`;

  await sendMessage(
    conversationId,
    message
  );

  return {
    stage: "encaminhado",
    sector,
    assigned,
  };
}


/*
Quando uma conversa encaminhada pela IA
é resolvida pelo funcionário,
a IA fica preparada para atender novamente
caso o cliente volte a escrever.
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
      reason: "conversation_id_missing",
    };
  }

  const status = String(
    payload?.conversation?.status ||
    payload?.status ||
    ""
  ).toLowerCase();

  if (status !== "resolved") {
    return {
      ignored: true,
      reason: "status_not_resolved",
      status,
    };
  }

  const conversation =
    await getConversation(conversationId);

  const attrs =
    conversation?.custom_attributes ||
    {};

  const wasHandedOff =
    attrs.ia_atendimento_concluido === true ||
    attrs.ia_etapa === "encaminhado";

  if (!wasHandedOff) {
    return {
      ignored: true,
      reason: "not_an_ai_handoff",
    };
  }

  await updateConversationAttributes(
    conversationId,
    {
      ...attrs,

      ia_etapa: "retorno",

      ia_atendimento_concluido: false,
    }
  );

  return {
    stage: "retorno",
    rearmed: true,
  };
}


export async function handleIncomingMessage(
  payload
) {
  const conversationId =
    payload?.conversation?.id ||
    payload?.conversation?.display_id;

  if (!conversationId) {
    throw new Error(
      "conversation.id não encontrado no webhook."
    );
  }

  const text =
    String(payload.content || "").trim();

  if (!text) {
    return {
      ignored: true,
      reason: "empty_message",
    };
  }

  const conversation =
    await getConversation(conversationId);

  const attrs =
    conversation?.custom_attributes ||
    {};

  const stage =
    attrs.ia_etapa ||
    "inicio";


  /*
  Enquanto um humano estiver cuidando
  daquela conversa, a IA fica silenciosa.
  */

  if (
    attrs.ia_atendimento_concluido === true ||
    stage === "encaminhado"
  ) {
    return {
      ignored: true,
      reason: "human_handoff_active",
    };
  }


  /*
  Cliente retornou após atendimento humano
  anteriormente resolvido.
  */

  if (stage === "retorno") {

    if (!attrs.ia_nome) {

      await updateConversationAttributes(
        conversationId,
        {
          ...attrs,
          ia_etapa: "nome",
          ia_atendimento_concluido: false,
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
          ia_etapa: "cidade",
          ia_atendimento_concluido: false,
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


    /*
    Primeiro tenta identificar imediatamente
    o assunto da nova mensagem.
    */

    const sector =
      await classifySector(text);


    /*
    Se identificou, já encaminha.
    */

    if (sector) {
      return handoffToSector(
        conversationId,
        attrs,
        sector
      );
    }


    /*
    Se não identificou,
    apresenta somente o menu.
    Não pergunta nome/cidade novamente.
    */

    await updateConversationAttributes(
      conversationId,
      {
        ...attrs,
        ia_etapa: "setor",
        ia_atendimento_concluido: false,
      }
    );

    await sendMessage(
      conversationId,
      `${firstName(
        attrs.ia_nome
      )}, que bom falar com você novamente. 👋

${menuText(attrs.ia_nome)}`
    );

    return {
      stage: "setor",
      return_flow: true,
    };
  }


  /*
  PRIMEIRO CONTATO
  */

  if (stage === "inicio") {

    await updateConversationAttributes(
      conversationId,
      {
        ...attrs,

        ia_etapa: "nome",

        ia_atendimento_concluido: false,
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
  COLETA NOME
  */

  if (stage === "nome") {

    if (!validFullName(text)) {

      await sendMessage(
        conversationId,
        "Para eu registrar seu atendimento corretamente, poderia informar seu nome completo, com nome e sobrenome?"
      );

      return {
        stage: "nome",
        retry: true,
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

        ia_nome: cleanName,

        ia_etapa: "cidade",
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
  COLETA CIDADE
  */

  if (stage === "cidade") {

    if (!validCity(text)) {

      await sendMessage(
        conversationId,
        "Não consegui identificar a cidade. Pode informar apenas o nome da cidade, por favor?"
      );

      return {
        stage: "cidade",
        retry: true,
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

        ia_cidade: city,

        ia_etapa: "setor",
      }
    );

    await sendMessage(
      conversationId,
      menuText(attrs.ia_nome)
    );

    return {
      stage: "setor",
    };
  }


  /*
  IDENTIFICAÇÃO DE SETOR
  */

  if (stage === "setor") {

    const sector =
      await classifySector(text);

    if (!sector) {

      await sendMessage(
        conversationId,
        `Não consegui identificar o setor com segurança.

${menuText(attrs.ia_nome)}`
      );

      return {
        stage: "setor",
        retry: true,
      };
    }

    return handoffToSector(
      conversationId,
      attrs,
      sector
    );
  }


  /*
  FALLBACK
  */

  await updateConversationAttributes(
    conversationId,
    {
      ...attrs,

      ia_etapa: "nome",

      ia_atendimento_concluido: false,
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
