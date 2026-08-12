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
    "pós protocolo e atualizações",
    "pos protocolo e atualizacoes",
  ],
};


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


function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}


function firstName(fullName) {
  return (
    String(fullName || "")
      .trim()
      .split(/\s+/)[0] ||
    ""
  );
}


/*
============================================
VALIDAÇÃO DE NOME
============================================
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


  if (
    words.length < 2
  ) {
    return false;
  }


  if (
    /\d/.test(clean)
  ) {
    return false;
  }


  if (
    !/^[A-Za-zÀ-ÿ'’\-\s]+$/.test(
      clean
    )
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
  ].map(
    normalizeText
  );


  if (
    invalidNames.includes(
      normalized
    )
  ) {
    return false;
  }


  return true;
}


/*
============================================
DETECÇÃO DE RECUSA DE CIDADE
============================================
*/

function isCityRefusal(value) {
  const text =
    normalizeText(value);


  const exactRefusals = [
    "nao",
    "não",
    "nao quero",
    "não quero",
    "nao quero informar",
    "não quero informar",
    "nao vou informar",
    "não vou informar",
    "prefiro nao",
    "prefiro não",
    "prefiro nao dizer",
    "prefiro não dizer",
    "prefiro nao informar",
    "prefiro não informar",
    "nao posso falar",
    "não posso falar",
    "nao vou falar",
    "não vou falar",
    "nao desejo informar",
    "não desejo informar",
    "nao desejo responder",
    "não desejo responder",
    "nao quero responder",
    "não quero responder",
    "nao sei",
    "não sei",
    "sei nao",
    "sei não",
    "nao lembro",
    "não lembro",
    "nao tenho",
    "não tenho",
    "nenhuma",
    "nenhum",
    "qualquer",
    "tanto faz",
    "nao importa",
    "não importa",
    "isso nao importa",
    "isso não importa",
    "isso importa",
    "pra que",
    "para que",
    "por que",
    "porque",
    "por quê",
    "por que precisa",
    "por que voce precisa",
    "por que você precisa",
    "pra que precisa",
    "para que precisa",
    "nao precisa",
    "não precisa",
    "nao interessa",
    "não interessa",
    "isso e pessoal",
    "isso é pessoal",
    "informacao pessoal",
    "informação pessoal",
    "nao te interessa",
    "não te interessa",
    "nao quero passar",
    "não quero passar",
    "nao vou passar",
    "não vou passar",
    "nao quero fornecer",
    "não quero fornecer",
    "sem cidade",
    "nao tenho cidade",
    "não tenho cidade",
  ];


  if (
    exactRefusals.some(
      (item) =>
        text ===
        normalizeText(item)
    )
  ) {
    return true;
  }


  const refusalPrefixes = [
    "nao quero ",
    "não quero ",
    "prefiro nao ",
    "prefiro não ",
    "nao vou ",
    "não vou ",
    "nao posso ",
    "não posso ",
    "nao desejo ",
    "não desejo ",
    "por que ",
    "porque ",
    "pra que ",
    "para que ",
  ];


  if (
    refusalPrefixes.some(
      (prefix) =>
        text.startsWith(
          normalizeText(prefix)
        )
    )
  ) {
    return true;
  }


  return false;
}


/*
============================================
RESPOSTAS QUE NÃO SÃO CIDADE
============================================
*/

function isObviouslyInvalidCityAnswer(
  value
) {
  const text =
    normalizeText(value);


  const invalidAnswers = [
    "sim",
    "nao",
    "não",
    "ok",
    "okay",
    "okk",
    "okey",
    "certo",
    "beleza",
    "blz",
    "show",
    "entendi",
    "entendido",
    "obrigado",
    "obrigada",
    "valeu",
    "bom",
    "boa",
    "bom dia",
    "boa tarde",
    "boa noite",

    "quero",
    "quero ajuda",
    "preciso de ajuda",
    "ajuda",
    "me ajuda",
    "pode me ajudar",

    "atendimento",
    "atendente",
    "humano",
    "pessoa",
    "falar com atendente",
    "falar com humano",
    "quero atendente",
    "quero atendimento",
    "quero falar com alguem",
    "quero falar com alguém",
    "quero falar com uma pessoa",

    "comercial",
    "vendas",
    "financeiro",
    "boleto",
    "pagamento",
    "parcelas",
    "projetos",
    "projeto",
    "topografia",
    "pos protocolo",
    "pós protocolo",
    "prefeitura",
    "cartorio",
    "cartório",
    "registro de imoveis",
    "registro de imóveis",

    "qual setor",
    "setor",
    "menu",
    "opcoes",
    "opções",

    "1",
    "2",
    "3",
    "4",
    "5",
    "6",

    "primeiro",
    "segundo",
    "terceiro",
    "quarto",
    "quinto",
    "sexto",

    "agora",
    "depois",
    "amanha",
    "amanhã",
    "hoje",
    "ontem",

    "aqui",
    "ali",
    "la",
    "lá",
    "perto",
    "longe",

    "casa",
    "minha casa",
    "empresa",
    "trabalho",
    "escritorio",
    "escritório",

    "santa catarina",
    "sc",
    "parana",
    "paraná",
    "pr",
    "rio grande do sul",
    "rs",
    "sao paulo",
    "são paulo",
    "sp",
    "minas gerais",
    "mg",
    "rio de janeiro",
    "rj",
    "brasil",

    "nao lembro",
    "não lembro",
    "nao sei",
    "não sei",
    "sei nao",
    "sei não",

    "nenhuma",
    "nenhum",
    "qualquer",
    "tanto faz",

    "teste",
    "testando",
    "asdf",
    "asdfg",
    "abc",
    "abcde",
    "xxx",
    "xxxx",
    "aaaa",
    "bbbb",
    "cidade",
    "nome da cidade",
  ];


  return invalidAnswers
    .map(normalizeText)
    .includes(text);
}


/*
============================================
DETECTA FRASES QUE NÃO PARECEM CIDADE
============================================
*/

function looksLikeSentenceInsteadOfCity(
  value
) {
  const clean =
    String(value || "")
      .trim()
      .replace(/\s+/g, " ");


  const normalized =
    normalizeText(clean);


  /*
  Cidade brasileira normalmente não
  deve ter muitas palavras.
  Exceções existem, então o limite
  continua relativamente amplo.
  */

  const wordCount =
    clean
      .split(/\s+/)
      .filter(Boolean)
      .length;


  if (
    wordCount > 6
  ) {
    return true;
  }


  /*
  Pergunta explícita
  */

  if (
    clean.includes("?")
  ) {
    return true;
  }


  /*
  Frases comuns
  */

  const sentenceMarkers = [
    "eu quero",
    "eu nao",
    "eu não",
    "eu preciso",
    "eu moro",
    "quero falar",
    "quero saber",
    "preciso falar",
    "preciso saber",
    "gostaria de",
    "pode me",
    "voce pode",
    "você pode",
    "me passa",
    "me informe",
    "me ajuda",
    "me ajude",
    "nao quero",
    "não quero",
    "nao sei",
    "não sei",
    "nao vou",
    "não vou",
  ];


  return sentenceMarkers
    .map(normalizeText)
    .some(
      (marker) =>
        normalized.startsWith(
          marker
        )
    );
}


/*
============================================
VALIDAÇÃO PRINCIPAL DE CIDADE
============================================
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


  if (
    isCityRefusal(clean)
  ) {
    return false;
  }


  if (
    isObviouslyInvalidCityAnswer(
      clean
    )
  ) {
    return false;
  }


  if (
    looksLikeSentenceInsteadOfCity(
      clean
    )
  ) {
    return false;
  }


  /*
  Apenas números
  */

  if (
    /^\d+$/.test(clean)
  ) {
    return false;
  }


  /*
  CPF, telefone, CEP etc.
  */

  if (
    /\d{5,}/.test(clean)
  ) {
    return false;
  }


  /*
  Cidade não deve conter
  e-mail ou URL.
  */

  if (
    clean.includes("@") ||
    clean.includes("http://") ||
    clean.includes("https://") ||
    clean.includes("www.")
  ) {
    return false;
  }


  /*
  Aceita letras, espaços,
  hífen e apóstrofo.

  Exemplos:
  Rio do Sul
  Presidente Getúlio
  São João d'Oeste
  Balneário Camboriú
  */
  if (
    !/^[A-Za-zÀ-ÿ'’\-\s]+$/.test(
      clean
    )
  ) {
    return false;
  }


  return true;
}


/*
============================================
CLASSIFICAÇÃO DIRETA DE SETOR
============================================
*/

function directSectorMatch(
  message
) {
  const t =
    normalize(message);


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
        "cobrança",
        "divida",
        "dívida",
        "pix",
        "nota fiscal",
        "segunda via",
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
        "medir terreno",
        "levantamento de campo",
        "levantamento topografico",
        "levantamento topográfico",
        "le pac",
        "lepac",
      ],
    ],

    [
      "Pós-Protocolo",
      [
        "pos protocolo",
        "pós protocolo",
        "protocolo na prefeitura",
        "processo protocolado",
        "ja foi protocolado",
        "já foi protocolado",
        "prefeitura",
        "registro de imoveis",
        "registro de imóveis",
        "cartorio",
        "cartório",
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
        "valor do servico",
        "valor do serviço",
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
        "informacao geral",
        "informação geral",
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
            normalize(term)
          )
      )
    ) {
      return sector;
    }
  }


  const numeric =
    t.match(
      /^\s*([1-6])\s*$/
    )?.[1];


  if (numeric) {
    return SECTORS[
      Number(numeric) - 1
    ];
  }


  return null;
}


/*
============================================
CLASSIFICAÇÃO POR IA
============================================
*/

async function aiSectorMatch(
  message
) {
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


  const model =
    process.env.OPENAI_MODEL ||
    "gpt-5";


  const response =
    await client.responses.create({
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

- Financeiro:
pagamentos, boletos, parcelas, cobranças, notas fiscais, segunda via e dúvidas financeiras.

- Comercial:
orçamento, contratação, proposta, preço, novos serviços e vendas.

- Projetos:
projeto técnico, planta, memorial, correções técnicas e elaboração de projetos.

- Topografia:
medição de campo, levantamento topográfico, equipe de campo, marcação e atividades topográficas.

- Pós-Protocolo:
SOMENTE quando existir indicação de que o processo já foi protocolado OU quando tratar claramente de prefeitura, cartório, Registro de Imóveis ou CRF no contexto posterior ao protocolo.

- Atendimento:
demandas gerais, pedido explícito de atendente, dúvidas gerais e pedidos genéricos de andamento quando não houver indicação clara de que o processo já foi protocolado.

- Se não houver informação suficiente, responda INDEFINIDO.

Responda somente com o nome exato do setor.
Não explique.
Não use pontuação.
`,

      input:
        String(
          message || ""
        ),
    });


  const answer =
    String(
      response.output_text ||
      ""
    ).trim();


  return SECTORS.includes(
    answer
  )
    ? answer
    : null;
}


/*
============================================
CLASSIFICAÇÃO FINAL
============================================
*/

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
============================================
LOCALIZA TIME
============================================
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
    aliases.map(
      normalize
    );


  const found =
    (teams || []).find(
      (team) => {

        const name =
          normalize(
            team.name
          );


        return normalizedAliases.some(
          (alias) =>
            name === alias ||
            name.includes(
              alias
            )
        );
      }
    );


  return found?.id ||
    null;
}


/*
============================================
MENU
============================================
*/

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


/*
============================================
ENCAMINHAMENTO
============================================
*/

async function handoffToSector(
  conversationId,
  attrs,
  sector
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
      ? `${prefix}obrigado. Identifiquei que seu atendimento é com o setor de ${sector}. Encaminhei sua conversa para a equipe responsável, que dará continuidade por aqui.`
      : `${prefix}obrigado. Identifiquei que seu atendimento é com o setor de ${sector}. Sua solicitação foi registrada e a equipe responsável dará continuidade por aqui.`;


  await sendMessage(
    conversationId,
    message
  );


  return {
    stage:
      "encaminhado",

    sector,

    assigned,
  };
}


/*
============================================
CONVERSA RESOLVIDA
============================================
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
============================================
PROCESSAMENTO DE MENSAGEM
============================================
*/

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
      payload.content ||
      ""
    ).trim();


  if (!text) {
    return {
      ignored: true,
      reason:
        "empty_message",
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
  ============================================
  HUMANO ATENDENDO
  ============================================
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
  ============================================
  RETORNO DO CLIENTE
  ============================================
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

          ia_atendimento_concluido:
            false,
        }
      );


      await sendMessage(
        conversationId,
        "Olá novamente! 👋 Para retomarmos seu atendimento, por favor, informe seu nome completo."
      );


      return {
        stage:
          "nome",

        return_flow:
          true,
      };
    }


    if (!attrs.ia_cidade) {

      await updateConversationAttributes(
        conversationId,
        {
          ...attrs,

          ia_etapa:
            "cidade",

          ia_atendimento_concluido:
            false,
        }
      );


      await sendMessage(
        conversationId,
        `${firstName(
          attrs.ia_nome
        )}, que bom falar com você novamente. Me informe a cidade relacionada ao atendimento, por favor.`
      );


      return {
        stage:
          "cidade",

        return_flow:
          true,
      };
    }


    const sector =
      await classifySector(
        text
      );


    if (sector) {
      return handoffToSector(
        conversationId,
        attrs,
        sector
      );
    }


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
      `${firstName(
        attrs.ia_nome
      )}, que bom falar com você novamente. 👋

${menuText(
  attrs.ia_nome
)}`
    );


    return {
      stage:
        "setor",

      return_flow:
        true,
    };
  }


  /*
  ============================================
  PRIMEIRO CONTATO
  ============================================
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
  ============================================
  NOME
  ============================================
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
        "Para eu registrar seu atendimento corretamente, preciso do seu nome completo. Por favor, informe seu nome e sobrenome."
      );


      return {
        stage:
          "nome",

        retry:
          true,

        reason:
          "invalid_name",
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
  ============================================
  CIDADE
  ============================================
  */

  if (
    stage ===
    "cidade"
  ) {

    /*
    Cliente recusou
    */

    if (
      isCityRefusal(
        text
      )
    ) {

      const name =
        firstName(
          attrs.ia_nome
        );


      await sendMessage(
        conversationId,
        `${name ? `${name}, ` : ""}entendo. 😊 A cidade é necessária para que eu consiga direcionar seu atendimento corretamente para a equipe responsável.

Por favor, me informe apenas o nome da cidade relacionada ao atendimento.`
      );


      return {
        stage:
          "cidade",

        retry:
          true,

        reason:
          "city_refused",
      };
    }


    /*
    Resposta inválida
    */

    if (
      !validCity(
        text
      )
    ) {

      const name =
        firstName(
          attrs.ia_nome
        );


      await sendMessage(
        conversationId,
        `${name ? `${name}, ` : ""}não consegui identificar uma cidade nessa resposta.

Por favor, informe apenas o nome da cidade relacionada ao atendimento, por exemplo: Ibirama, Rio do Sul, Blumenau ou Florianópolis.`
      );


      return {
        stage:
          "cidade",

        retry:
          true,

        reason:
          "invalid_city",
      };
    }


    /*
    Cidade válida
    */

    const city =
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

      city,
    };
  }


  /*
  ============================================
  SETOR
  ============================================
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


    return handoffToSector(
      conversationId,
      attrs,
      sector
    );
  }


  /*
  ============================================
  FALLBACK
  ============================================
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
