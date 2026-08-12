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


function normalize(
  value
) {
  return String(
    value || ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
}


function normalizeText(
  value
) {
  return normalize(
    value
  ).replace(
    /\s+/g,
    " "
  );
}


function firstName(
  name
) {
  return (
    String(
      name || ""
    )
      .trim()
      .split(/\s+/)[0] ||
    ""
  );
}


/*
===========================================
NOME
===========================================
*/

function validFullName(
  value
) {
  const clean =
    String(
      value || ""
    )
      .trim()
      .replace(
        /\s+/g,
        " "
      );


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


  if (
    /\d/.test(
      clean
    )
  ) {
    return false;
  }


  return /^[A-Za-zÀ-ÿ'’\-\s]+$/.test(
    clean
  );
}


/*
===========================================
CIDADE
===========================================
*/

function isCityRefusal(
  value
) {
  const text =
    normalizeText(
      value
    );


  const invalid = [
    "nao",
    "nao quero",
    "prefiro nao",
    "nao vou informar",
    "nao quero informar",
    "nao sei",
    "nao lembro",
    "tanto faz",
    "qualquer",
    "nenhuma",
    "nenhum",
    "pra que",
    "para que",
    "por que",
    "porque",
    "nao interessa",
    "nao te interessa",
    "isso e pessoal",
    "nao quero responder",
    "nao quero fornecer",
    "nao quero passar",
  ];


  return invalid.some(
    (item) =>
      text ===
        normalizeText(
          item
        ) ||
      text.startsWith(
        `${normalizeText(
          item
        )} `
      )
  );
}


function validCity(
  value
) {
  const clean =
    String(
      value || ""
    )
      .trim()
      .replace(
        /\s+/g,
        " "
      );


  const text =
    normalizeText(
      clean
    );


  if (
    clean.length < 2 ||
    clean.length > 80
  ) {
    return false;
  }


  if (
    isCityRefusal(
      clean
    )
  ) {
    return false;
  }


  const invalid = [
    "sim",
    "ok",
    "beleza",
    "blz",
    "atendimento",
    "comercial",
    "financeiro",
    "projetos",
    "topografia",
    "pos protocolo",
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
  ];


  if (
    invalid
      .map(
        normalizeText
      )
      .includes(
        text
      )
  ) {
    return false;
  }


  if (
    clean.includes("?") ||
    /\d{4,}/.test(
      clean
    )
  ) {
    return false;
  }


  return /^[A-Za-zÀ-ÿ'’\-\s]+$/.test(
    clean
  );
}


/*
===========================================
ASSUNTO
===========================================
*/

function validSubject(
  value
) {
  const clean =
    String(
      value || ""
    )
      .trim()
      .replace(
        /\s+/g,
        " "
      );


  const text =
    normalizeText(
      clean
    );


  if (
    clean.length < 4
  ) {
    return false;
  }


  const invalid = [
    "nao sei",
    "nao quero falar",
    "nao quero dizer",
    "nada",
    "nenhum",
    "nenhuma",
    "qualquer coisa",
    "sei la",
    "tanto faz",
    "sim",
    "nao",
    "ok",
    "beleza",
    "bom dia",
    "boa tarde",
    "boa noite",
  ];


  if (
    invalid
      .map(
        normalizeText
      )
      .includes(
        text
      )
  ) {
    return false;
  }


  return true;
}


/*
===========================================
SETOR DIRETO
===========================================
*/

function directSectorMatch(
  message
) {
  const t =
    normalizeText(
      message
    );


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
        "nota fiscal",
        "segunda via",
      ],
    ],

    [
      "Topografia",
      [
        "topografia",
        "medicao",
        "levantamento",
        "topografo",
        "campo",
      ],
    ],

    [
      "Pós-Protocolo",
      [
        "pos protocolo",
        "processo protocolado",
        "prefeitura",
        "cartorio",
        "registro de imoveis",
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
        "andamento",
      ],
    ],
  ];


  for (
    const [
      sector,
      terms,
    ]
    of patterns
  ) {
    if (
      terms.some(
        (term) =>
          t.includes(
            normalizeText(
              term
            )
          )
      )
    ) {
      return sector;
    }
  }


  const numeric =
    t.match(
      /^([1-6])$/
    )?.[1];


  if (numeric) {
    return SECTORS[
      Number(
        numeric
      ) - 1
    ];
  }


  return null;
}


async function aiSectorMatch(
  message
) {
  const client =
    new OpenAI({
      apiKey:
        process.env.OPENAI_API_KEY,
    });


  const result =
    await client.responses.create({
      model:
        process.env.OPENAI_MODEL ||
        "gpt-5",

      reasoning: {
        effort:
          "low",
      },

      instructions: `
Classifique a solicitação do cliente da Integral Soluções em Engenharia.

Escolha apenas:

Atendimento
Comercial
Financeiro
Projetos
Topografia
Pós-Protocolo
INDEFINIDO

Financeiro:
boletos, parcelas, pagamento, cobrança, PIX, nota fiscal.

Comercial:
orçamento, proposta, preço, contratação e novos serviços.

Projetos:
plantas, memoriais e projetos técnicos.

Topografia:
levantamentos, medições, campo e topografia.

Pós-Protocolo:
somente processos já protocolados, prefeitura, cartório, Registro de Imóveis ou CRF.

Atendimento:
dúvidas gerais e andamento sem indicação clara de protocolo.

Responda somente o setor.
`,

      input:
        String(
          message || ""
        ),
    });


  const answer =
    String(
      result.output_text ||
      ""
    ).trim();


  return SECTORS.includes(
    answer
  )
    ? answer
    : null;
}


async function classifySector(
  message
) {
  return (
    directSectorMatch(
      message
    ) ||
    await aiSectorMatch(
      message
    )
  );
}


/*
===========================================
INTERPRETA TEXTO OU ÁUDIO
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
      console.log(
        "Áudio transcrito",
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
      "Erro na transcrição:",
      error
    );
  }


  return {
    text:
      "",

    source:
      "unknown",
  };
}


/*
===========================================
TIME
===========================================
*/

async function findTeamIdForSector(
  sector
) {
  const teams =
    await listTeams();


  const aliases =
    TEAM_ALIASES[
      sector
    ] || [
      sector,
    ];


  const found =
    (teams || []).find(
      (team) => {
        const teamName =
          normalize(
            team.name
          );


        return aliases.some(
          (alias) =>
            teamName.includes(
              normalize(
                alias
              )
            )
        );
      }
    );


  return (
    found?.id ||
    null
  );
}


/*
===========================================
MENU
===========================================
*/

function menuText(
  name
) {
  const prefix =
    name
      ? `${firstName(
          name
        )}, `
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
ENCAMINHA APÓS COLETAR ASSUNTO
===========================================
*/

async function handoffToSector(
  conversationId,
  attrs,
  sector,
  subject
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

    } catch (
      error
    ) {
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

      ia_assunto:
        subject,

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


  await sendMessage(
    conversationId,
    `${name ? `${name}, ` : ""}obrigado. Já registrei o motivo do seu contato e encaminhei seu atendimento para o setor de ${sector}.

A equipe responsável receberá sua solicitação com estas informações:

“${subject}”

Agora é só aguardar a continuidade do atendimento por aqui.`
  );


  return {
    stage:
      "encaminhado",

    sector,

    subject,

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
    payload?.id;


  if (!conversationId) {
    return {
      ignored:
        true,
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
    };
  }


  const conversation =
    await getConversation(
      conversationId
    );


  const attrs =
    conversation?.custom_attributes ||
    {};


  if (
    attrs.ia_atendimento_concluido !==
      true &&
    attrs.ia_etapa !==
      "encaminhado"
  ) {
    return {
      ignored:
        true,
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
    rearmed:
      true,
  };
}


/*
===========================================
ENTRADA PRINCIPAL
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


  /*
  HUMANO ATIVO
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
  RETORNO
  */

  if (
    stage ===
    "retorno"
  ) {

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

          ia_assunto:
            "",

          ia_etapa:
            "assunto",
        }
      );


      await sendMessage(
        conversationId,
        `${firstName(
          attrs.ia_nome
        )}, entendi. Vou direcionar seu atendimento para ${sector}.

Antes de encaminhar, me conte brevemente sobre o que você gostaria de falar. Você pode escrever ou enviar um áudio.`
      );


      return {
        stage:
          "assunto",

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
      stage:
        "setor",
    };
  }


  /*
  INÍCIO
  */

  if (
    stage ===
    "inicio"
  ) {

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
      stage:
        "nome",
    };
  }


  /*
  NOME
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
        "Para registrar seu atendimento corretamente, preciso do seu nome completo. Por favor, informe nome e sobrenome."
      );


      return {
        stage:
          "nome",

        retry:
          true,
      };
    }


    const cleanName =
      text
        .replace(
          /\s+/g,
          " "
        )
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
      stage:
        "cidade",
    };
  }


  /*
  CIDADE
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
        )}, preciso da cidade relacionada ao atendimento para conseguir direcioná-lo corretamente.

Por favor, informe apenas o nome da cidade.`
      );


      return {
        stage:
          "cidade",

        retry:
          true,
      };
    }


    const city =
      text.trim();


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
      stage:
        "setor",
    };
  }


  /*
  SETOR
  */

  if (
    stage ===
    "setor"
  ) {

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
        stage:
          "setor",

        retry:
          true,
      };
    }


    /*
    NOVA ETAPA:
    NÃO ENCAMINHA AINDA.
    */

    await updateConversationAttributes(
      conversationId,
      {
        ...attrs,

        ia_setor:
          sector,

        ia_assunto:
          "",

        ia_etapa:
          "assunto",
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
      stage:
        "assunto",

      sector,
    };
  }


  /*
  ============================================
  NOVA ETAPA: ASSUNTO
  ============================================
  */

  if (
    stage ===
    "assunto"
  ) {

    if (
      !validSubject(
        text
      )
    ) {

      await sendMessage(
        conversationId,
        `${firstName(
          attrs.ia_nome
        )}, preciso de uma breve descrição para que o atendente já receba seu atendimento com o contexto correto.

Por exemplo: “Preciso da segunda via do boleto” ou “Quero saber quando será realizada a topografia”.

Pode escrever ou enviar um áudio.`
      );


      return {
        stage:
          "assunto",

        retry:
          true,
      };
    }


    const sector =
      attrs.ia_setor ||
      await classifySector(
        text
      );


    if (!sector) {

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
        `Antes de encaminhar, preciso identificar o setor correto.

${menuText(
  attrs.ia_nome
)}`
      );


      return {
        stage:
          "setor",
      };
    }


    return handoffToSector(
      conversationId,
      attrs,
      sector,
      text
    );
  }


  /*
  FALLBACK
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
    stage:
      "nome",

    reset:
      true,
  };
}
