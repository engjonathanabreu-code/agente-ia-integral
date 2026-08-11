export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: "Agente IA Integral",
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    chatwootConfigured: Boolean(
      process.env.CHATWOOT_BASE_URL &&
      process.env.CHATWOOT_ACCOUNT_ID &&
      process.env.CHATWOOT_API_TOKEN
    ),
    aiEnabled: process.env.AI_ENABLED !== "false",
  });
}
