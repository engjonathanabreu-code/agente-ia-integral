import OpenAI from "openai";
import { readFileSync } from "node:fs";

import {
  assignConversationToTeam,
  getConversation,
  listTeams,
  sendMessage,
  updateConversationAttributes,
} from "./chatwoot.js";

const GUIDELINES = readFileSync(
  new URL("../promts.md", import.meta.url),
  "utf-8"
);

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

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function firstName(fullName) {
  return String(fullName || "")
    .trim()
    .split(/\s+/)[0] || "";
}

function validFullName(value) {
  const clean = String(value || "")
    .trim()
    .replace(/\s+/g, " ");

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
  const text = normalize(message);

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
        "segunda via",
        "comprovante",
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
        "levantamento topografico",
        "lepac",
        "le pac",
        "equipe de campo",
      ],
    ],

    [
      "Pós-Protocolo",
      [
        "prefeitura",
        "protocolo na prefeitura",
        "protocolo municipal",
        "exigencia da prefeitura",
        "exigencia municipal",
        "correcao para prefeitura",
        "analise da prefeitura",
        "aprovacao da prefeitura",
        "edital",
        "crf",
        "registro de imoveis",
        "cartorio",
        "registro imobiliario",
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
        "projeto tecnico",
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
        "quero contratar",
        "quanto custa",
        "parceria",
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
        "andamento do trabalho",
        "andamento do servico",
        "status do trabalho",
        "status do servico",
        "como esta meu processo",
        "como esta meu trabalho",
        "como esta meu servico",
        "em que etapa esta",
        "qual etapa esta",
        "como esta a regularizacao",
        "qual o andamento",
      ],
    ],
  ];

  for (const [sector, terms] of patterns) {
    if (
      terms.some((term) =>
        text.includes(normalize(term))
      )
    ) {
      return sector;
    }
  }

  const numeric =
    text.match(/^\s*([1-6])\s*$/)?.[1];

  if (numeric) {
    return SECTORS[
      Number(numeric) - 1
    ];
  }

  return null;
}

async function aiSectorMatch(message) {
  const apiKey =
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY não configurada."
    );
  }

  const client =
    new OpenAI({ apiKey });

  const model =
    process.env.OPENAI_MODEL ||
    "gpt-5-mini";

  const response =
    await client.responses.create({
      model,

      instructions: `
${GUIDELINES}

TAREFA ATUAL

Você está executando apenas a etapa de CLASSIFICAÇÃO DE SETOR.

Escolha exatamente UM destes valores:

Atendimento
Comercial
Financeiro
Projetos
Topografia
Pós-Protocolo
INDEFINIDO

REGRAS DE CLASSIFICAÇÃO

- Financeiro:
  pagamentos, boletos, parcelas,
  cobranças, PIX, segunda via,
  comprovantes, notas fiscais
  ou negociação financeira.

- Comercial:
  orçamento, contratação,
  proposta, novos serviços,
  interesse em REURB,
  projetos, topografia
  ou parceria.

- Projetos:
  projeto técnico, planta,
  memorial, elaboração técnica
  ou correção de projeto.

- Topografia:
  medição,
  levantamento topográfico,
  equipe de campo,
  agendamento
  ou atividade topográfica.

- Pós-Protocolo:
  usar SOMENTE quando o assunto
  envolver tramitação externa
  junto à Prefeitura
  ou ao Registro de Imóveis.

  Exemplos:
  análise da Prefeitura,
  exigências municipais,
  correções solicitadas pela Prefeitura,
  edital,
  aprovação municipal,
  CRF,
  cartório,
  Registro de Imóveis,
  registro imobiliário.

  IMPORTANTE:
  não classifique como Pós-Protocolo
  apenas porque o cliente está
  perguntando pelo andamento do trabalho.

- Atendimento:
  dúvidas gerais,
  atendimento humano,
  questões documentais,
  atualização cadastral
  e perguntas sobre andamento,
  status ou etapa dos trabalhos
  executados pela Integral.

  Exemplos:
  "Como está meu processo?"
  "Em que etapa está meu serviço?"
  "Qual o andamento?"
  "Como está a regularização?"
  "Já fizeram meu trabalho?"

  Se o cliente perguntar
  apenas pelo andamento do trabalho,
  sem mencionar Prefeitura,
  exigência municipal,
  cartório
  ou Registro de Imóveis,
  classifique como Atendimento.

- Se não houver informação suficiente:
  responda INDEFINIDO.

IMPORTANTE:
Responda SOMENTE com um dos nomes acima.
Não explique sua decisão.
Não use pontuação.
`,

      input: String(message || ""),
    });

  const answer =
    String(
      response.output_text || ""
    ).trim();

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
    (teams || []).find((team) => {
      const name =
        normalize(team.name);

      return normalizedAliases.some(
        (alias) =>
          name === alias ||
          name.includes(alias)
      );
    });

  return found?.id || null;
}

function menuText(name) {
  const greeting =
    name
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

function hoursBetween(
  start,
  end = new Date()
) {
  if (!start) return 0;

  const startDate =
    start instanceof Date
      ? start
      : new Date(start);

  if (
    Number.isNaN(
      startDate.getTime()
    )
  ) {
    return 0;
  }

  return (
    end.getTime() -
    startDate.getTime()
  ) / (1000 * 60 * 60);
}

async function restartConversation(
  conversationId,
  attrs
) {
  await updateConversationAttributes(
    conversationId,
    {
      ...attrs,

      ia_etapa: "nome",
      ia_setor: null,
      ia_nome: null,
      ia_cidade: null,

      ia_atendimento_concluido: false,
      ia_encaminhado_em: null,
    }
  );

  await sendMessage(
    conversationId,
    "Olá novamente! 👋 Sou a Assistente Virtual da Integral Soluções em Engenharia. Vamos iniciar um novo atendimento. Por favor, informe seu nome completo."
  );

  return {
    stage: "nome",
    restarted: true,
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
    String(
      payload.content || ""
    ).trim();

  if (!text) {
    return {
      ignored: true,
      reason: "empty_message",
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

  const conversationStatus =
    conversation?.status;

  const alreadyHandedOff =
    attrs.ia_atendimento_concluido === true ||
    stage === "encaminhado";

  if (alreadyHandedOff) {
    const lastAssignedAt =
      attrs.ia_encaminhado_em
        ? new Date(
            attrs.ia_encaminhado_em
          )
        : null;

    const hoursSinceHandoff =
      hoursBetween(lastAssignedAt);

    const canRestart =
      conversationStatus ===
        "resolved" ||
      hoursSinceHandoff >= 12;

    if (canRestart) {
      return restartConversation(
        conversationId,
        attrs
      );
    }

    return {
      ignored: true,
      reason:
        "already_handed_off",
    };
  }

  if (stage === "inicio") {
    await updateConversationAttributes(
      conversationId,
      {
        ...attrs,

        ia_etapa: "nome",
        ia_atendimento_concluido:
          false,
      }
    );

    await sendMessage(
      conversationId,
      "Olá! 👋 Sou a Assistente Virtual da Integral Soluções em Engenharia. Vou realizar seu atendimento inicial e direcioná-lo para a equipe responsável. Para começarmos, por favor, informe seu nome completo."
    );

    return {
      stage: "nome",
    };
  }

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
      menuText(
        attrs.ia_nome
      )
    );

    return {
      stage: "setor",
    };
  }

  if (stage === "setor") {
    const sector =
      await classifySector(text);

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

    const handoffTime =
      new Date().toISOString();

    await updateConversationAttributes(
      conversationId,
      {
        ...attrs,

        ia_setor: sector,
        ia_etapa: "encaminhado",

        ia_atendimento_concluido:
          true,

        ia_encaminhado_em:
          handoffTime,
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
      handedOffAt:
        handoffTime,
    };
  }

  await updateConversationAttributes(
    conversationId,
    {
      ...attrs,

      ia_etapa: "nome",
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
