import {
  createConversationAttribute,
  createTeam,
  createWebhook,
  listCustomAttributeDefinitions,
  listTeams,
  listWebhooks,
} from "../lib/chatwoot.js";

const attributes = [
  {
    key: "ia_etapa",
    name: "IA — Etapa",
    description: "Etapa atual do atendimento inicial da IA.",
    type: 0,
  },
  {
    key: "ia_nome",
    name: "IA — Nome completo",
    description: "Nome informado pelo cliente durante a triagem.",
    type: 0,
  },
  {
    key: "ia_cidade",
    name: "IA — Cidade",
    description: "Cidade informada pelo cliente durante a triagem.",
    type: 0,
  },
  {
    key: "ia_setor",
    name: "IA — Setor",
    description: "Setor classificado pelo agente de IA.",
    type: 0,
  },
  {
    key: "ia_atendimento_concluido",
    name: "IA — Triagem concluída",
    description: "Indica se o atendimento inicial já foi encaminhado.",
    type: 7,
  },
  {
    key: "ia_encaminhado_em",
    name: "IA — Encaminhado em",
    description: "Data e hora em que a IA encaminhou a conversa para uma equipe humana.",
    type: 0,
  },
];

const teams = [
  [
    "Atendimento",
    "Atendimento geral, dúvidas, documentos e andamento dos trabalhos da Integral.",
  ],
  [
    "Comercial",
    "Novos serviços, propostas, orçamentos e oportunidades comerciais.",
  ],
  [
    "Financeiro",
    "Pagamentos, boletos, parcelas, cobranças e assuntos financeiros.",
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
    "Assuntos externos relacionados à Prefeitura, cartório e Registro de Imóveis.",
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
    // ========================================================
    // 1. CUSTOM ATTRIBUTES
    // ========================================================

    const existingAttrs =
      await listCustomAttributeDefinitions();

    const existingAttrsArray =
      asArray(existingAttrs);

    const existingKeys =
      new Set(
        existingAttrsArray.map(
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
          key: definition.key,
          id: created?.id,
        });
      }
    }

    // ========================================================
    // 2. EQUIPES
    // ========================================================

    const currentTeams =
      await listTeams();

    const teamsArray =
      asArray(currentTeams);

    const normalizedTeams =
      new Map(
        teamsArray.map(
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
      ]
      of teams
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
        id: team.id,
        name: team.name,
      });
    }

    // ========================================================
    // 3. WEBHOOK
    // ========================================================

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

    const webhooksArray =
      asArray(
        existingWebhooks
      );

    let webhook =
      webhooksArray.find(
        (item) =>
          item.url ===
          webhookUrl
      );

    /*
     * OBSERVAÇÃO:
     *
     * Como o AgentBot já pode usar essa URL diretamente,
     * o webhook genérico não é estritamente necessário.
     *
     * Mantemos esta lógica somente para compatibilidade
     * caso o setup seja usado em outra instalação.
     */

    if (!webhook) {
      try {
        webhook =
          await createWebhook(
            webhookUrl
          );
      } catch (error) {
        /*
         * Não derrubamos o setup inteiro se a instalação
         * recusar a criação do webhook genérico.
         *
         * O AgentBot pode continuar funcionando normalmente.
         */
        console.warn(
          "Webhook genérico não criado:",
          error.message
        );

        webhook = {
          id: null,
          url: webhookUrl,
          subscriptions: [],
          skipped: true,
        };
      }
    }

    // ========================================================
    // 4. RESPOSTA
    // ========================================================

    return json(
      res,
      200,
      {
        ok: true,

        attributes_created:
          attrsCreated,

        attributes_available:
          attributes.map(
            (item) =>
              item.key
          ),

        teams:
          teamResults,

        webhook: {
          id:
            webhook?.id ||
            null,

          url:
            webhook?.url ||
            webhookUrl,

          subscriptions:
            webhook?.subscriptions ||
            [],

          skipped:
            webhook?.skipped ||
            false,
        },

        diagnostics: {
          existing_custom_attributes:
            existingAttrsArray.length,

          attributes_created:
            attrsCreated.length,

          teams_available:
            teamResults.length,

          existing_webhooks:
            webhooksArray.length,
        },

        next:
          "Setup concluído. O atributo ia_encaminhado_em está disponível para o fluxo de reinício automático.",
      }
    );
  } catch (error) {
    console.error(
      "Erro no setup:",
      error
    );

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
