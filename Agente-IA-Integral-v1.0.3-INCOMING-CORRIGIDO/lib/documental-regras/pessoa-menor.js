// Datas civis: não use a diferença em milissegundos para decidir a maioridade.
const dataCivil = valor => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor || ''))) return null;
  const [ano, mes, dia] = valor.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return ano >= 1900 && data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia ? valor : null;
};
export function menorDeIdade(pessoa, referencia = new Date().toLocaleDateString('sv-SE', {timeZone: 'America/Sao_Paulo'})) {
  const nascimento = dataCivil(pessoa?.nascimento), hoje = dataCivil(referencia);
  if (!nascimento || !hoje || nascimento > hoje || pessoa?.tipoPessoa === 'juridica') return false;
  const aniversario18 = `${Number(nascimento.slice(0, 4)) + 18}${nascimento.slice(4)}`;
  return hoje < aniversario18;
}
export const cpfDispensado = (pessoa, referencia) => !String(pessoa?.cpf || '').trim() && menorDeIdade(pessoa, referencia);
