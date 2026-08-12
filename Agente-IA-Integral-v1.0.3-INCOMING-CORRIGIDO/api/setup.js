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
    key: "ia_atendimento_concluido",
    name: "IA — Triagem concluída",
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


function json(res, status, body) {
  res.statusCode = status;

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

  if (Array.isArray(value?.payload)) {
    return value.payload;
  }

  if (Array.isArray(value?.data)) {
    return value.data;
  }

  if (Array.isArray(value?.webhooks)) {
    return value.webhooks;
  }

  if (Array.isArray(value?.teams)) {
    return value.teams;
  }

  if (
    Array.isArray(
      value?.custom_attribute_definitions
    )
  ) {
    return value.custom_attribute_definitions;
  }

  return [];
}


function normalizeUrl(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "");
}


export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return json(
      res,
      405,
      {
        error: "Method not allowed",
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
        error: "Setup não autorizado.",
      }
    );
  }


  try {
    /*
    ============================================
    ATRIBUTOS PERSONALIZADOS
    ============================================
    */

    const existingAttrs =
      await listCustomAttributeDefinitions();


    const existingKeys =
      new Set(
        asArray(existingAttrs).map(
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
    ============================================
    EQUIPES
    ============================================
    */

    const currentTeams =
      await listTeams();


    const normalizedTeams =
      new Map(
        asArray(
          currentTeams
        ).map(
          (team) => [
            String(
              team.name || ""
            )
              .trim()
              .toLowerCase(),

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
        normalizedTeams.get(
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
        id:
          team?.id,

        name:
          team?.name ||
          name,
      });
    }


    /*
    ============================================
    CONFIGURAÇÃO DO WEBHOOK
    ============================================
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


    /*
    Busca todos os webhooks atuais
    */

    const existingWebhooks =
      await listWebhooks();


    const allWebhooks =
      asArray(
        existingWebhooks
      );


    /*
    Primeiro tenta localizar exatamente
    pela URL, ignorando barra final.
    */

    let webhook =
      allWebhooks.find(
        (item) =>
          normalizeUrl(item?.url) ===
          normalizeUrl(webhookUrl)
      );


    /*
    Caso não encontre pela URL,
    tenta localizar pelo nome do agente.
    Isso evita criar webhook duplicado.
    */

    if (!webhook) {
      webhook =
        allWebhooks.find(
          (item) =>
            String(
              item?.name || ""
            )
              .trim()
              .toLowerCase()
              .includes(
                "agente ia integral"
              )
        );
    }


    /*
    Caso ainda não tenha encontrado,
    tenta localizar qualquer webhook
    apontando para /api/webhook/
    do mesmo APP_URL.
    */

    if (!webhook) {
      webhook =
        allWebhooks.find(
          (item) => {
            const url =
              normalizeUrl(
                item?.url
              );

            return (
              url.startsWith(
                normalizeUrl(appUrl)
              ) &&
              url.includes(
                "/api/webhook/"
              )
            );
          }
        );
    }


    /*
    ============================================
    SE O WEBHOOK JÁ EXISTE:
    ATUALIZA URL E SUBSCRIPTIONS
    ============================================
    */

    if (webhook) {
      webhook =
        await updateWebhook(
          webhook.id,
          webhookUrl
        );
    } else {
      /*
      ============================================
      SÓ CRIA SE NÃO EXISTIR
      ============================================
      */

      try {
        webhook =
          await createWebhook(
            webhookUrl
          );
      } catch (error) {
        /*
        Fallback para o caso de o Chatwoot
        responder 422 "Url has already been taken".

        Nesse caso, lista novamente os webhooks
        e tenta localizar a URL existente.
        */

        const isDuplicateUrl =
          error?.status === 422 ||
          String(
            error?.message || ""
          ).includes(
            "Url has already been taken"
          );


        if (!isDuplicateUrl) {
          throw error;
        }


        const refreshedWebhooks =
          await listWebhooks();


        const refreshedList =
          asArray(
            refreshedWebhooks
          );


        const existingDuplicate =
          refreshedList.find(
            (item) =>
              normalizeUrl(
                item?.url
              ) ===
              normalizeUrl(
                webhookUrl
              )
          );


        if (!existingDuplicate) {
          throw error;
        }


        webhook =
          await updateWebhook(
            existingDuplicate.id,
            webhookUrl
          );
      }
    }


    /*
    ============================================
    RESPOSTA FINAL
    ============================================
    */

    return json(
      res,
      200,
      {
        ok: true,

        service:
          "Agente IA Integral",

        attributes_created:
          attrsCreated,

        teams:
          teamResults,

        webhook: {
          id:
            webhook?.id,

          name:
            webhook?.name,

          url:
            webhook?.url ||
            webhookUrl,

          subscriptions:
            webhook?.subscriptions ||
            [
              "message_created",
              "conversation_status_changed",
            ],
        },

        diagnostics: {
          custom_attributes_existing:
            asArray(
              existingAttrs
            ).length,

          custom_attributes_created:
            attrsCreated.length,

          teams_count:
            teamResults.length,

          existing_webhooks_count:
            allWebhooks.length,

          webhook_action:
            webhook
              ? "created_or_updated"
              : "unknown",
        },

        next:
          "Resolva uma conversa encaminhada pela IA e depois envie uma nova mensagem do cliente para validar a retomada automática.",
      }
    );

  } catch (error) {
    console.error(
      "Erro no setup do Agente IA Integral:",
      error
    );


    return json(
      res,
      500,
      {
        ok: false,

        error:
          error?.message ||
          "Erro desconhecido durante o setup.",

        status:
          error?.status,

        detail:
          error?.data,
      }
    );
  }
}
