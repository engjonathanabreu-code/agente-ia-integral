// Keep the identifiers used by the existing customer section: no data migration
// or duplicate source of truth is needed when these fields become built-in.
export const SECAO_CONFRONTANTES = { id: 'e5a35bd4-7ad4-467f-be51-22f31e612709', nome: 'Confrontantes', setor: 'topografia' };
export const CONFRONTANTES = [
  { lado: 'frente', rotulo: 'Frente', id: '2be328c2-7ccd-4448-a942-cfc6f62631fc' },
  { lado: 'fundo', rotulo: 'Fundo', id: 'bbb40008-d693-4be1-8021-613da327e8ce' },
  { lado: 'direito', rotulo: 'Lado Direito', id: 'd7d5ae44-f5af-4970-9d21-081840964ece' },
  { lado: 'esquerdo', rotulo: 'Lado Esquerdo', id: '0ca10151-b790-409b-a056-c9f8a963f3dc' },
];
export const campoConfrontante = (id) => CONFRONTANTES.some((c) => c.id === id);
export function confrontantesDe(p) {
  return Object.fromEntries(CONFRONTANTES.map(({ lado, id }) => [lado,
    Object.hasOwn(p?.extras || {}, id) ? String(p.extras[id] ?? '') : String(p?.campo?.confrontantes?.[lado] ?? ''),
  ]));
}
export const confrontantesFaltando = (p) => {
  const valores = confrontantesDe(p);
  return CONFRONTANTES.filter((c) => !valores[c.lado].trim()).map((c) => c.rotulo);
};
export const versaoConfrontantes = (p) => JSON.stringify(confrontantesDe(p));
export function campoComConfrontantes(p) {
  return { ...structuredClone(p.campo || { respostas: {}, fotos: [] }), confrontantes: confrontantesDe(p) };
}
export function aplicarLevantamento(p, campo) {
  p.campo = structuredClone(campo);
  // Old offline packages have no confrontantes: never clear existing entries.
  if (campo.confrontantes) {
    p.extras = { ...p.extras };
    for (const { lado, id } of CONFRONTANTES)
      if (Object.hasOwn(campo.confrontantes, lado)) p.extras[id] = String(campo.confrontantes[lado] ?? '');
  }
  return p;
}
export function conflitoConfrontantes(p, un) {
  if (!un.campo?.confrontantes) return false;
  const atual = versaoConfrontantes(p);
  const proposto = versaoConfrontantes({ campo: un.campo });
  // Legacy packages did not record a baseline. Only merge if the destination is
  // empty or already identical; otherwise require the existing conflict review.
  const base = un.versaoConfrontantesBase;
  return atual !== proposto && (base !== undefined ? atual !== base : CONFRONTANTES.some((c) => confrontantesDe(p)[c.lado].trim()));
}
