import {
  createConversationAttribute,
  createTeam,
  createWebhook,
  listCustomAttributeDefinitions,
  listTeams,
  listWebhooks,
  updateWebhook,
} from "../lib/chatwoot.js";


/*
============================================
ATRIBUTOS PERSONALIZADOS DA CONVERSA
============================================
*/

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

  {
    key: "ia_ultima_cutucada_em",
    name: "IA — Última cutucada",
    description:
      "Data/hora (ISO) do último aviso de paciência enviado por inatividade de atendente humano.",
  },

  {
    key: "ia_fim_expediente_avisado_em",
    name: "IA — Aviso de fim de expediente",
    description:
      "Data (YYYY-MM-DD) em que o aviso de fim de expediente já foi enviado, para não repetir no mesmo dia.",
  },
];


/*
============================================
EQUIPES DO CHATWOOT
============================================
*/

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


/*
============================================
RESPOSTA JSON
============================================
*/

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


/*
============================================
CONVERTE RESPOSTAS DA API EM ARRAY
============================================
*/

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


/*
============================================
NORMALIZA URL
============================================
*/

function normalizeUrl(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "");
}


/*
============================================
HANDLER PRINCIPAL
============================================
*/

export default async function handler(
  req,
  res
) {

  /*
  Somente POST
  */

  if (req.method !== "POST") {
    return json(
      res,
      405,
      {
        ok: false,
        error: "Method not allowed",
      }
    );
  }


  /*
  ============================================
  SEGURANÇA DO SETUP
  ============================================
  */

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
        ok: false,
        error: "Setup não autorizado.",
      }
    );
  }


  try {

    /*
    ============================================
    1. ATRIBUTOS PERSONALIZADOS
    ============================================
    */

    const existingAttrs =
      await listCustomAttributeDefinitions();


    const existingAttrList =
      asArray(existingAttrs);


    const existingKeys =
      new Set(
        existingAttrList.map(
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
        existingKeys.has(
          definition.key
        )
      ) {
        continue;
      }


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


    /*
    ============================================
    2. EQUIPES
    ============================================
    */

    const currentTeams =
      await listTeams();


    const currentTeamList =
      asArray(currentTeams);


    const normalizedTeams =
      new Map(
        currentTeamList.map(
          (team) => [
            String(
              team?.name || ""
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


      /*
      Cria equipe somente se
      ela realmente não existir.
      */

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
    3. CONFIGURAÇÕES DO WEBHOOK
    ============================================
    */

    const appUrl =
      String(
        process.env.APP_URL ||
        ""
      )
        .trim()
        .replace(
          /\/+$/,
          ""
        );


    const webhookToken =
      String(
        process.env.WEBHOOK_TOKEN ||
        ""
      ).trim();


    if (!appUrl) {
      throw new Error(
        "APP_URL não configurada."
      );
    }


    if (!webhookToken) {
      throw new Error(
        "WEBHOOK_TOKEN não configurado."
      );
    }


    const webhookUrl =
      `${appUrl}/api/webhook/${encodeURIComponent(
        webhookToken
      )}`;


    /*
    ============================================
    4. LISTA WEBHOOKS EXISTENTES
    ============================================
    */

    const existingWebhooks =
      await listWebhooks();


    const allWebhooks =
      asArray(
        existingWebhooks
      );


    console.log(
      "Webhooks encontrados no Chatwoot:",
      allWebhooks.map(
        (item) => ({
          id:
            item?.id,

          name:
            item?.name,

          url:
            item?.url,

          subscriptions:
            item?.subscriptions,
        })
      )
    );


    /*
    ============================================
    5. PROCURA WEBHOOK PELA URL EXATA
    ============================================
    */

    let webhook =
      allWebhooks.find(
        (item) =>
          normalizeUrl(
            item?.url
          ) ===
          normalizeUrl(
            webhookUrl
          )
      );


    let webhookMatchMethod =
      webhook
        ? "exact_url"
        : null;


    /*
    ============================================
    6. PROCURA PELO NOME
    ============================================
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


      if (webhook) {
        webhookMatchMethod =
          "name";
      }
    }


    /*
    ============================================
    7. PROCURA WEBHOOK DO MESMO APP
    ============================================
    */

    if (!webhook) {

      webhook =
        allWebhooks.find(
          (item) => {

            const currentUrl =
              normalizeUrl(
                item?.url
              );


            return (
              currentUrl.startsWith(
                normalizeUrl(
                  appUrl
                )
              ) &&
              currentUrl.includes(
                "/api/webhook"
              )
            );
          }
        );


      if (webhook) {
        webhookMatchMethod =
          "same_app";
      }
    }


    /*
    ============================================
    8. CASO EXISTA APENAS UM WEBHOOK
    ============================================

    Se a conta possuir somente um webhook,
    usamos esse webhook em vez de tentar
    criar outro.

    Isso evita o erro:

    Url has already been taken
    */

    if (
      !webhook &&
      allWebhooks.length === 1
    ) {

      webhook =
        allWebhooks[0];

      webhookMatchMethod =
        "single_webhook";
    }


    /*
    ============================================
    9. ATUALIZA WEBHOOK EXISTENTE
    ============================================
    */

    let webhookAction =
      null;


    if (webhook) {

      console.log(
        "Webhook existente encontrado.",
        {
          id:
            webhook.id,

          url:
            webhook.url,

          method:
            webhookMatchMethod,
        }
      );


      webhook =
        await updateWebhook(
          webhook.id,
          webhookUrl
        );


      webhookAction =
        "updated";
    }


    /*
    ============================================
    10. NÃO ENCONTROU WEBHOOK
    ============================================
    */

    else {

      console.log(
        "Nenhum webhook encontrado pela listagem. Tentando criar."
      );


      try {

        webhook =
          await createWebhook(
            webhookUrl
          );


        webhookAction =
          "created";

      } catch (createError) {

        /*
        ========================================
        CHATWOOT RETORNOU URL DUPLICADA
        ========================================
        */

        const duplicateUrl =
          createError?.status === 422 ||
          String(
            createError?.message ||
            ""
          ).includes(
            "Url has already been taken"
          );


        if (!duplicateUrl) {
          throw createError;
        }


        console.warn(
          "Chatwoot informou que a URL já existe. Refazendo a listagem."
        );


        /*
        Lista novamente depois do 422.
        */

        const refreshedWebhooks =
          await listWebhooks();


        const refreshedList =
          asArray(
            refreshedWebhooks
          );


        console.log(
          "Nova listagem de webhooks:",
          refreshedList.map(
            (item) => ({
              id:
                item?.id,

              name:
                item?.name,

              url:
                item?.url,

              subscriptions:
                item?.subscriptions,
            })
          )
        );


        /*
        Procura novamente pela URL.
        */

        let duplicateWebhook =
          refreshedList.find(
            (item) =>
              normalizeUrl(
                item?.url
              ) ===
              normalizeUrl(
                webhookUrl
              )
          );


        /*
        Se não encontrou pela URL,
        procura pelo nome.
        */

        if (!duplicateWebhook) {

          duplicateWebhook =
            refreshedList.find(
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
        Se houver apenas um,
        utiliza esse.
        */

        if (
          !duplicateWebhook &&
          refreshedList.length === 1
        ) {

          duplicateWebhook =
            refreshedList[0];
        }


        /*
        Se ainda assim não encontrou,
        NÃO tenta criar de novo (evitaria
        um segundo 422 em loop).

        O próprio erro 422 "Url has already
        been taken" já É a confirmação de que
        o Chatwoot tem, sim, um webhook
        cadastrado com essa URL exata — ele
        simplesmente não aparece na listagem
        (`GET /webhooks`) para o token atual,
        provavelmente por escopo/permissão do
        CHATWOOT_API_TOKEN. Em vez de falhar o
        setup inteiro por causa disso, seguimos
        como sucesso "não confirmado": a URL
        está registrada, mas não conseguimos
        checar por aqui se as subscriptions
        (message_created, conversation_status_changed
        etc.) estão corretas nesse webhook
        existente — isso precisa ser conferido
        manualmente uma vez em Chatwoot →
        Configurações → Integrações → Webhooks.
        */

        if (!duplicateWebhook) {

          console.warn(
            "Webhook não encontrado na listagem mesmo após 422, mas a URL já está registrada no Chatwoot. Seguindo como sucesso não confirmado.",
            {
              expected_webhook_url:
                webhookUrl,

              webhooks_found:
                refreshedList.length,
            }
          );


          webhookAction =
            "already_registered_unlistable";

          webhookMatchMethod =
            "duplicate_error_confirmed";

          webhook = null;
        } else {


        /*
        Encontrou o webhook depois
        da segunda listagem.

        Atualiza em vez de criar.
        */

        webhook =
          await updateWebhook(
            duplicateWebhook.id,
            webhookUrl
          );


        webhookAction =
          "updated_after_duplicate";
        }
      }
    }


    /*
    ============================================
    11. CONFIRMA WEBHOOK FINAL
    ============================================
    */

    const finalWebhooks =
      await listWebhooks();


    const finalWebhookList =
      asArray(
        finalWebhooks
      );


    const confirmedWebhook =
      finalWebhookList.find(
        (item) =>
          normalizeUrl(
            item?.url
          ) ===
          normalizeUrl(
            webhookUrl
          )
      ) ||
      webhook;


    /*
    ============================================
    12. RESPOSTA DE SUCESSO
    ============================================
    */

    const nextInstruction =
      webhookAction ===
      "already_registered_unlistable"
        ? "A URL do webhook já estava registrada no Chatwoot (confirmado pelo erro de duplicidade), mas o token atual não consegue listar webhooks para checar as subscriptions automaticamente. Confira manualmente uma vez em Chatwoot -> Configurações -> Integrações -> Webhooks se o webhook aponta para " +
          webhookUrl +
          " e se as subscriptions incluem message_created e conversation_status_changed. Depois resolva uma conversa encaminhada e envie uma nova mensagem do cliente para testar a retomada automática."
        : "Verifique se subscriptions contém message_created e conversation_status_changed. Depois resolva uma conversa encaminhada e envie uma nova mensagem do cliente para testar a retomada automática.";


    return json(
      res,
      200,
      {
        ok: true,

        service:
          "Agente IA Integral",

        version:
          "1.0.5-cutucada-inatividade",

        attributes: {
          existing:
            existingAttrList.length,

          created:
            attrsCreated,
        },

        teams:
          teamResults,

        webhook: {
          action:
            webhookAction,

          match_method:
            webhookMatchMethod,

          id:
            confirmedWebhook?.id,

          name:
            confirmedWebhook?.name,

          url:
            confirmedWebhook?.url ||
            webhookUrl,

          subscriptions:
            confirmedWebhook?.subscriptions ||
            webhook?.subscriptions ||
            [],
        },

        diagnostics: {
          webhook_url_expected:
            webhookUrl,

          webhooks_before:
            allWebhooks.length,

          webhooks_after:
            finalWebhookList.length,

          ai_enabled:
            process.env.AI_ENABLED !==
            "false",

          openai_configured:
            Boolean(
              process.env.OPENAI_API_KEY
            ),

          chatwoot_configured:
            Boolean(
              process.env.CHATWOOT_BASE_URL &&
              process.env.CHATWOOT_ACCOUNT_ID &&
              process.env.CHATWOOT_API_TOKEN
            ),
        },

        next:
          nextInstruction,
      }
    );

  } catch (error) {

    /*
    ============================================
    ERRO GERAL
    ============================================
    */

    console.error(
      "Erro no setup do Agente IA Integral:",
      error
    );


    return json(
      res,
      500,
      {
        ok: false,

        service:
          "Agente IA Integral",

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
