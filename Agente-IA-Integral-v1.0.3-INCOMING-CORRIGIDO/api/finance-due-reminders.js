// A reserva da obrigação no Financeiro é o único caminho de envio.
export default function handler(_req, res) {
  return res.status(410).json({ ok: false, error: 'ROTA_DESATIVADA' });
}
