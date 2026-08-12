import {
  createConversationAttribute,
  createTeam,
  createWebhook,
  listCustomAttributeDefinitions,
  listTeams,
  listWebhooks,
  updateWebhook,
} from "../lib/chatwoot.js";


const attributes = [

  {
    key: "ia_etapa",

    name: "IA — Etapa",

    description:
      "Etapa atual do atendimento inicial da IA.",
  },

  {
    key: "ia_nome",

    name: "IA — Nome completo",

    description:
      "Nome informado pelo cliente durante a triagem.",
  },

  {
    key: "ia_cidade",

    name: "IA — Cidade",

    description:
      "Cidade informada pelo cliente durante a triagem.",
  },

  {
    key: "ia_setor",

    name: "IA — Setor",

    description:
      "Setor classificado pelo agente de IA.",
  },

  {
    key:
      "ia_atendimento_concluido",

    name:
      "IA — Triagem concluída",

    description:
      "Indica se o atendimento inicial já foi encaminhado.",

    type: 7,
  },
];


const teams = [

  [
    "Atendimento",
    "Atendimento geral e triagem humana.",
  ],

  [
    "Comercial",
    "Novos serviços, propostas e oportunidades comerciais.",
  ],

  [
    "Financeiro",
    "Pagamentos, boletos, parcelas e assuntos financeiros.",
  ],

  [
    "Projetos",
    "Elaboração e dúvidas relacionadas a projetos técnicos.",
  ],

  [
    "Topografia",
    "Levantamentos, medições e atividades de campo.",
  ],

  [
    "Pós-Protocolo",
    "Andamentos após protocolo, prefeitura, cartório e registro.",
  ],
];


function json(
  res,
  status,
  body
) {

  res.statusCode =
    status;

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.end(
    JSON.stringify(
      body,
      null,
      2
    )
  );
}


function asArray(value) {

  if (Array.isArray(value)) {
    return value;
  }

  if (
    Array.isArray(value?.payload)
  ) {
    return value.payload;
  }

  if (
    Array.isArray(value?.data)
  ) {
    return value.data;
  }

  if (
    Array.isArray(value?.webhooks)
  ) {
    return value.webhooks;
  }

  if (
    Array.isArray(value?.teams)
  ) {
    return value.teams;
  }

  if (
    Array.isArray(
      value?.custom_attribute_definitions
    )
  ) {
    return value
      .custom_attribute_definitions;
  }

  return [];
}


export default async function handler(
  req,
  res
) {

  if (
    req.method !== "POST"
  ) {

    return json(
      res,
      405,
      {
        error:
          "Method not allowed",
      }
    );
  }


  const auth =
    req.headers.authorization ||
    "";


  if (
    !process.env.SETUP_SECRET ||
    auth !==
      `Bearer ${process.env.SETUP_SECRET}`
  ) {

    return json(
      res,
      401,
      {
        error:
          "Setup não autorizado.",
      }
    );
  }


  try {

    /*
    ATRIBUTOS
    */

    const existingAttrs =
      await listCustomAttributeDefinitions();


    const existingKeys =
      new Set(
        asArray(
          existingAttrs
        ).map(
          (item) =>
            item.attribute_key
        )
      );


    const attrsCreated = [];


    for (
      const definition
      of attributes
    ) {

      if (
        !existingKeys.has(
          definition.key
        )
      ) {

        const created =
          await createConversationAttribute(
            definition
          );

        attrsCreated.push({
          key:
            definition.key,

          id:
            created?.id,
        });
      }
    }


    /*
    EQUIPES
    */

    const currentTeams =
      await listTeams();


    const normalized =
      new Map(
        asArray(
          currentTeams
        ).map(
          (team) => [
            String(
              team.name
            ).toLowerCase(),

            team,
          ]
        )
      );


    const teamResults = [];


    for (
      const [
        name,
        description,
      ] of teams
    ) {

      let team =
        normalized.get(
          name.toLowerCase()
        );


      if (!team) {

        team =
          await createTeam(
            name,
            description
          );
      }


      teamResults.push({
        id: team.id,
        name: team.name,
      });
    }


    /*
    WEBHOOK
    */

    const appUrl =
      String(
        process.env.APP_URL ||
        ""
      ).replace(
        /\/+$/,
        ""
      );


    const webhookToken =
      process.env.WEBHOOK_TOKEN;


    if (
      !appUrl ||
      !webhookToken
    ) {

      throw new Error(
        "APP_URL e WEBHOOK_TOKEN são obrigatórios para o setup."
      );
    }


    const webhookUrl =
      `${appUrl}/api/webhook/${encodeURIComponent(
        webhookToken
      )}`;


    const existingWebhooks =
      await listWebhooks();


    let webhook =
      asArray(
        existingWebhooks
      ).find(
        (item) =>
          item.url ===
          webhookUrl
      );


    /*
    SE NÃO EXISTIR,
    CRIA.
    */

    if (!webhook) {

      webhook =
        await createWebhook(
          webhookUrl
        );

    } else {

      /*
      SE JÁ EXISTIR,
      CONFERE AS ASSINATURAS.
      */

      const subscriptions =
        new Set(
          webhook.subscriptions ||
          []
        );


      if (
        !subscriptions.has(
          "message_created"
        ) ||
        !subscriptions.has(
          "conversation_status_changed"
        )
      ) {

        webhook =
          await updateWebhook(
            webhook.id,
            webhookUrl
          );
      }
    }


    return json(
      res,
      200,
      {

        ok: true,

        attributes_created:
          attrsCreated,

        teams:
          teamResults,

        webhook: {

          id:
            webhook.id,

          url:
            webhook.url,

          subscriptions:
            webhook.subscriptions,
        },

        diagnostics: {

          custom_attributes_count:
            asArray(
              existingAttrs
            ).length +
            attrsCreated.length,

          teams_count:
            teamResults.length,

          existing_webhooks_count:
            asArray(
              existingWebhooks
            ).length,
        },

        next:
          "Resolva uma conversa já encaminhada e depois envie uma nova mensagem do cliente para testar a retomada automática.",
      }
    );

  } catch (error) {

    console.error(error);

    return json(
      res,
      500,
      {
        ok: false,
        error:
          error.message,
      }
    );
  }
}
