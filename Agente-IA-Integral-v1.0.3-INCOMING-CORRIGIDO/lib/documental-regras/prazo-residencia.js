export const INSTRUCAO_RESIDENCIA_ANTIGA = 'A data de emissão ou de vencimento deve estar dentro dos últimos 90 dias.';
export const INSTRUCAO_RESIDENCIA_SEIS_MESES = 'A data de emissão ou de vencimento deve estar dentro dos últimos seis meses calendários, incluindo a data limite. Não aceite datas futuras. Se a data estiver ausente ou ilegível, marque como não verificada para revisão humana.';
export const diaReferenciaResidencia = () => new Date().toLocaleDateString('sv-SE',{timeZone:'America/Sao_Paulo'});
function dataCivil(texto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(texto || ''))) return null;
  const data = new Date(`${texto}T12:00:00Z`);
  return Number.isFinite(data.getTime()) && data.toISOString().slice(0,10) === texto ? data : null;
}
export function limiteResidencia(referencia = diaReferenciaResidencia()) {
  const hoje = dataCivil(referencia);
  if (!hoje) throw new Error('Data de referência inválida.');
  const limite = new Date(Date.UTC(hoje.getUTCFullYear(),hoje.getUTCMonth()-6,1,12));
  const ultimo = new Date(Date.UTC(limite.getUTCFullYear(),limite.getUTCMonth()+1,0,12)).getUTCDate();
  limite.setUTCDate(Math.min(hoje.getUTCDate(),ultimo));
  return limite.toISOString().slice(0,10);
}
export function avaliarPrazoResidencia(campos, referencia = diaReferenciaResidencia()) {
  const limite = limiteResidencia(referencia);
  const datas = [campos?.emissao,campos?.vencimento].filter(Boolean);
  if (!datas.length || datas.some(d => !dataCivil(d))) return {resultado:'nao_verificada',observacao:'Data ausente ou inválida; conferir documento.'};
  if (datas.some(d => d >= limite && d <= referencia)) return {resultado:'atende',observacao:`Data dentro do período de ${limite} a ${referencia}.`};
  return {resultado:'nao_atende',observacao:datas.every(d => d > referencia) ? 'Data futura; conferir documento.' : `Data anterior ao limite de ${limite}.`};
}
export function regrasResidenciaPadrao(regras) {
  return (regras || []).map(r => r.id === 'rg_residencia_90' && r.instrucao === INSTRUCAO_RESIDENCIA_ANTIGA && r.tipos?.length === 1 && r.tipos[0] === 'comp_residencia' && !r.personalizada
    ? {...r,instrucao:INSTRUCAO_RESIDENCIA_SEIS_MESES} : r);
}
