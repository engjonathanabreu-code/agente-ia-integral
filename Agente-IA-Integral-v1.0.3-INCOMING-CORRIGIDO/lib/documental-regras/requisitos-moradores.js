import {cpfDispensado} from './pessoa-menor.js';
import {requisitosDoMunicipio,configuracaoMunicipio} from './regras-municipio.js';
import { confrontantesFaltando, campoConfrontante } from './confrontantes.js';
// Shared rules: the dashboard summary and the resident detail use the same checks.
const ETAPAS = [
  { id: "mobilizacao", nome: "Mobilização", completo: "Apresentação da REURB e mobilização", grupo: 0 },
  { id: "contrato", nome: "Contrato", completo: "Assinatura do contrato", grupo: 0 },
  { id: "documental", nome: "Análise documental", completo: "Análise documental e de viabilidade", grupo: 0 },
  { id: "topografia", nome: "Topografia", completo: "Topografia e medições do terreno", grupo: 1 },
  { id: "projeto", nome: "Projeto", completo: "Projeto de REURB da unidade", grupo: 2 },
  { id: "prefeitura", nome: "Prefeitura", completo: "Acompanhamento na prefeitura", grupo: 3 },
];

const TOTAL = ETAPAS.length;

const ativo = (p) => p.situacao === "Ativo";

const DOC_TIPOS = {
  identidade: "RG ou CNH do requerente",
  identidade_conjuge: "RG ou CNH do cônjuge",
  comp_residencia: "Comprovante de residência",
  estado_civil: "Certidão de nascimento ou casamento",
  comp_renda: "Comprovante de renda",
  comp_posse: "Comprovante de posse",
  matricula_origem: "Matrícula ou transcrição de origem",
  outro: "Outro documento",
};

const COM_CONJUGE = ["Casado(a)", "União estável"];

const so = (s) => String(s ?? "").replace(/\D/g, "");

const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const preenchido = (v) => v !== null && v !== undefined && String(v).trim() !== "";

function cpfValido(v) {
  const c = so(v);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += +c[i] * (10 - i);
  let d = (s * 10) % 11; if (d === 10) d = 0;
  if (d !== +c[9]) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += +c[i] * (11 - i);
  d = (s * 10) % 11; if (d === 10) d = 0;
  return d === +c[10];
}

function parseNum(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).trim();
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? n : null;
}

const ehPJ = (x) => x?.tipoPessoa === "juridica";

const temConjuge = (p) => !ehPJ(p.requerente) && COM_CONJUGE.includes(p.requerente.estadoCivil);

function cnpjValido(v) {
  const c = so(v);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (base) => { const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = base.split("").reduce((a, d, i) => a + Number(d) * pesos[i], 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = calc(c.slice(0, 12)); const d2 = calc(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}

const documentoValido = (x) => (ehPJ(x) ? cnpjValido(x.cnpj) : (cpfDispensado(x) || cpfValido(x.cpf)));

const docBloqueado = (d) => !!d?.regras?.some((r) => r.gravidade === "bloqueia" && r.resultado === "nao_atende");

const docOk = (p, tipo) => (p.docs || []).some((d) => d.tipo === tipo && d.status === "validado" && (!d.pessoaId || d.pessoaId === (tipo === "identidade_conjuge" ? "conjuge" : "requerente")));

function docStatusTexto(p, tipo) {
  const d = [...(p.docs || [])].reverse().find((x) => x.tipo === tipo);
  if (!d) return "Não enviado";
  if (d.status === "validado") return "";
  if (d.status === "rejeitado") return "Rejeitado, envie outro arquivo";
  if (docBloqueado(d)) return "Regra obrigatória não atendida";
  return "Analisado, aguardando validação";
}

function faltantesPessoa(x, ehRequerente) {
  const f = [];
  if (ehPJ(x)) {
    if (!x.nome) f.push("razão social");
    if (!cnpjValido(x.cnpj)) f.push(x.cnpj ? "CNPJ válido" : "CNPJ");
    if (!x.representante) f.push("representante legal");
    return f;
  }
  if (!x.nome) f.push("nome");
  if (!cpfDispensado(x) && !cpfValido(x.cpf)) f.push(x.cpf ? "CPF válido" : "CPF");
  if (!x.rg) f.push("RG");
  if (!x.nascimento) f.push("nascimento");
  if (!x.mae) f.push("nome da mãe");
  if (ehRequerente && !x.estadoCivil) f.push("estado civil");
  if (ehRequerente && !x.profissao) f.push("profissão");
  return f;
}

function faltantesQualificacao(x) {
  if (!x) return ["nome"];
  if (ehPJ(x)) return faltantesPessoa(x, true);
  const f = [];
  if (!x.nome) f.push("nome");
  if (!cpfDispensado(x) && !cpfValido(x.cpf)) f.push(x.cpf ? "CPF válido" : "CPF");
  if (!x.rg) f.push("RG");
  if (!x.nascimento) f.push("nascimento");
  if (!x.mae) f.push("nome da mãe");
  if (!x.estadoCivil) f.push("estado civil");
  if (!x.profissao) f.push("profissão");
  return f;
}

function campoPreenchido(def, v) {
  if (def.tipo === "grupo") {
    if (def.repetir) return Array.isArray(v) && v.length > 0 && v.every((l) => def.subcampos.every((s) => preenchido(l?.[s.id])));
    return def.subcampos.every((s) => preenchido(v?.[s.id]));
  }
  return preenchido(v);
}

const duplicadosIndex=new WeakMap();
function acharDuplicado(db, p) {
  let index=duplicadosIndex.get(db.processos);
  if(!index){
    index={cpf:new Map(),nome:new Map(),ordem:new Map()};
    db.processos.forEach((o,i)=>{index.ordem.set(o.id,i);if(!ativo(o)||o._resumo)return;
      for(const [tipo,valor] of [['cpf',so(o.requerente.cpf)],['nome',normalizar(o.requerente.nome)]]){
        if(!valor||(tipo==='cpf'&&valor.length!==11))continue;
        const key=JSON.stringify([o.remessaId,valor]),list=index[tipo].get(key)||[];
        list.push(o);index[tipo].set(key,list);
      }
    });duplicadosIndex.set(db.processos,index);
  }
  const cpf=so(p.requerente.cpf),nome=normalizar(p.requerente.nome);
  const c=cpf.length===11?index.cpf.get(JSON.stringify([p.remessaId,cpf]))?.find(o=>o.id!==p.id):null;
  const n=nome?index.nome.get(JSON.stringify([p.remessaId,nome]))?.find(o=>o.id!==p.id):null;
  const o=c&&(!n||index.ordem.get(c.id)<=index.ordem.get(n.id))?c:n;
  return o?{codigo:o.codigo,motivo:o===c?'CPF':'nome',id:o.id}:null;
}

const contexto = (db, p) => ({ nucleo: (() => { const n = db.nucleos.find(n => n.id === p.nucleoId); return n ? {...n, criterio: db.ajustesMunicipio?.[p.municipioId]?.criterioREURB ?? n.criterio} : null; })(), duplicado: acharDuplicado(db, p), campos: configuracaoMunicipio(db,p.municipioId,"campos")?.lista || [], checklist: checklistDoMunicipio(db,p.municipioId), ajustesReq: requisitosDoMunicipio(db,p.municipioId) });

function aplicarAjustesRequisitos(lista, etapaId, ajustes, p) {
  const a = (ajustes || {})[etapaId] || {};
  const desligados = new Set(a.desativados || []);
  const opcionais = new Set(a.opcionais || []);
  const obrigatorios = new Set(a.obrigatorios || []);
  const base = lista.filter((r) => (r.fixo && !ajustes?._municipal) || !desligados.has(r.id)).map((r) => {
    const rotulo = (a.rotulos || {})[r.id];
    const item = { ...r, label: rotulo || r.label };
    if ((!r.fixo || ajustes?._municipal) && opcionais.has(r.id)) { item.opcional = true; item.tipo = item.tipo === "auto" ? "auto" : "marcador"; item.marcado = !!(p.checks || {})[r.id]; item.ok = true; }
    if (obrigatorios.has(r.id) && item.tipo === "marcador") { item.opcional = false; item.tipo = "manual"; item.ok = !!(p.checks || {})[r.id]; }
    return item;
  });
  (a.extras || []).forEach((e) => {
    if (e.tipo === "campo") base.push({ id: e.id, label: e.label, ok: preenchido((p.campos || {})[e.id]), tipo: "campo", valor: (p.campos || {})[e.id] || "", placeholder: e.ajuda || "" });
    else if (e.opcional) base.push({ id: e.id, label: e.label, ok: true, tipo: "marcador", marcado: !!(p.checks || {})[e.id], opcional: true, ajuda: e.ajuda || "" });
    else base.push({ id: e.id, label: e.label, ok: !!(p.checks || {})[e.id], tipo: "manual", ajuda: e.ajuda || "" });
  });
  return base;
}

function criterioNucleo(n, db) {
  const criterio = db?.ajustesMunicipio?.[n?.municipioId]?.criterioREURB ?? n?.criterio;
  const teto = parseNum(criterio?.rendaMaxima);
  const sm = parseNum(criterio?.salarioMinimo);
  return { teto: teto && teto > 0 ? teto : null, sm: sm && sm > 0 ? sm : null };
}

function requisitosEtapa(etapaId, p, ctx) {
  return aplicarAjustesRequisitos(requisitosPadrao(etapaId, p, ctx), etapaId, ctx?.ajustesReq, p);
}

function requisitosPadrao(etapaId, p, ctx) {
  const R = [];
  const auto = (id, label, ok, detalhe = "", extra = {}) => R.push({ id, label, ok: !!ok, tipo: "auto", detalhe: ok ? "" : detalhe, ...extra });
  const manual = (id, label, extra = {}) => R.push({ id, label, ok: !!(p.checks || {})[id], tipo: "manual", ...extra });
  const campo = (id, label, placeholder) => R.push({ id, label, ok: preenchido((p.campos || {})[id]), tipo: "campo", valor: (p.campos || {})[id] || "", placeholder });
  const marcador = (id, label, ajuda) => R.push({ id, label, ok: true, tipo: "marcador", marcado: !!(p.checks || {})[id], opcional: true, ajuda });
  switch (etapaId) {
    case "mobilizacao": {
      const temTelefone = so(p.requerente.telefone).length >= 10;
      manual("apresentacao", "Participou da apresentação da REURB");
      manual("docsEntregues", "Entregou documentos");
      manual("contatoValido", "Entregou contato válido e testado", temTelefone ? {} : { bloqueado: "Cadastre o telefone antes de marcar" });
      manual("interesse", "Interesse em aderir confirmado");
      marcador("liderLocal", "Potencial líder local", "Marcação opcional, não trava a etapa");
      break;
    }
    case "contrato":
      auto("cpf_contrato", ehPJ(p.requerente) ? "CNPJ válido do contratante" : "CPF válido do contratante", documentoValido(p.requerente), ehPJ(p.requerente) ? "Informe um CNPJ válido no cadastro" : "Informe um CPF válido no cadastro");
      manual("contrato", "Contrato assinado");
      manual("procuracao", "Procuração assinada");
      manual("requerimento", "Requerimento de REURB assinado");
      break;
    case "documental": {
      const fr = faltantesPessoa(p.requerente, true);
      auto("dados_req", "Dados pessoais do requerente", fr.length === 0, `Falta ${fr.join(", ")}`);
      if (temConjuge(p)) { const fc = faltantesPessoa(p.conjuge, false); auto("dados_conj", "Dados pessoais do cônjuge", fc.length === 0, `Falta ${fc.join(", ")}`); }
      (p.corequerentes || []).forEach((cr, i) => { const fx = faltantesPessoa(cr.pessoa, true); auto(`dados_coreq_${cr.id}`, `Dados de ${cr.pessoa.nome || `requerente ${i + 2}`}`, fx.length === 0, `Falta ${fx.join(", ")}`); });
      { const fo = (p.ocupantes || []).filter((o) => faltantesQualificacao(o.pessoa).length).map((o) => o.pessoa.nome || "ocupante sem nome"); if ((p.ocupantes || []).length) auto("dados_ocup", "Qualificação dos ocupantes", fo.length === 0, `Falta completar ${fo.slice(0, 3).join(", ")}${fo.length > 3 ? ` e mais ${fo.length - 3}` : ""}`); }
      const e = p.endereco || {}; const fe = [];
      if (!e.logradouro) fe.push("logradouro"); if (!e.numero) fe.push("número"); if (!e.bairro) fe.push("bairro");
      if (!e.municipio) fe.push("município"); if (!e.uf) fe.push("UF"); if (so(e.cep).length !== 8) fe.push("CEP");
      auto("endereco", "Endereço de residência", fe.length === 0, `Falta ${fe.join(", ")}`);
      const tipos = ["identidade", "comp_residencia", "estado_civil", "comp_posse"];
      if (temConjuge(p)) tipos.splice(1, 0, "identidade_conjuge");
      tipos.forEach((t) => auto(`doc_${t}`, `${DOC_TIPOS[t]} validado`, docOk(p, t), docStatusTexto(p, t)));
      auto("sem_duplicidade", "Sem cadastro duplicado na remessa", !ctx.duplicado, ctx.duplicado ? `Mesmo ${ctx.duplicado.motivo} do ${ctx.duplicado.codigo}` : "");
      auto("renda", "Composição familiar e renda", (parseNum(p.social?.ocupantes) || 0) > 0 && parseNum(p.social?.rendaFamiliar) !== null, "Informe pessoas no imóvel e renda familiar");
      auto("declaracao", "Declaração sobre outro imóvel", (p.social?.possuiImovel ?? "") !== "", "Registre se a família possui outro imóvel");
      auto("doc_comp_renda", "Comprovante de renda validado", docOk(p, "comp_renda"), docStatusTexto(p, "comp_renda"));
      auto("teto_nucleo", "Teto de renda do núcleo definido", !!criterioNucleo(ctx.nucleo).teto, ctx.nucleo ? `Defina o teto no cadastro do ${ctx.nucleo.codigo}` : "Defina o núcleo no cadastro do imóvel");
      auto("modalidade", "Modalidade definida", ["REURB-S", "REURB-E"].includes(p.social?.modalidade), "Escolha REURB-S ou REURB-E no cadastro");
      break;
    }
    case "topografia": {
      const temFachada = (p.campo?.fotos || []).some((f) => f.tipo === "fachada");
      const faltamCampo = itensCampoFaltando(p, ctx.checklist || []);
      const faltamConfrontantes = confrontantesFaltando(p);
      auto("confrontantes", "Confrontantes preenchidos", !faltamConfrontantes.length, `Preencha ${faltamConfrontantes.join(", ")} no cadastro ou no Top. Campo`, { aba: "cadastro", fixo: true });
      auto("nucleo", "Vinculado a um núcleo", !!ctx.nucleo, "Defina o núcleo no cadastro do imóvel");
      auto("foto_fachada", "Foto de fachada", temFachada, "Registre no Top. Campo do núcleo");
      auto("info_campo", "Informações de campo coletadas", faltamCampo.length === 0, faltamCampo.length ? `Falta no Top. Campo: ${faltamCampo.slice(0, 3).join(", ")}${faltamCampo.length > 3 ? ` e mais ${faltamCampo.length - 3}` : ""}` : "");
      manual("medicao", "Medição em campo realizada");
      manual("lepac", "LEPAC realizado");
      manual("conferencia", "Conferência topográfica");
      const uns = unidadesDe(p);
      const varias = uns.length > 1;
      const semArea = uns.map((u, i) => ((parseNum(u.area) || 0) > 0 ? null : codigoUnidade(p, i))).filter(Boolean);
      const semMemorial = uns.map((u, i) => ((u.memorial || "").trim().length >= MIN_MEMORIAL ? null : codigoUnidade(p, i))).filter(Boolean);
      auto("area", varias ? "Área medida de todas as unidades" : "Área medida da unidade", !semArea.length, `Falta em ${semArea.join(", ")}`, { aba: "unidades" });
      auto("memorial", varias ? "Memorial descritivo de todas as unidades" : "Memorial descritivo da unidade", !semMemorial.length, `Cole o memorial de ${semMemorial.join(", ")}`, { aba: "unidades" });
      break;
    }
    case "projeto": {
      const semLote = unidadesDe(p).map((u, i) => (preenchido(u.loteQuadra) ? null : codigoUnidade(p, i))).filter(Boolean);
      auto("loteQuadra", unidadesDe(p).length > 1 ? "Lote e quadra de todas as unidades" : "Lote e quadra no projeto", !semLote.length, `Falta em ${semLote.join(", ")}`, { aba: "unidades" });
      manual("confrontacoes", "Confrontações conferidas no projeto");
      auto("termo_gerado", "Termo de compromisso gerado", (p.documentosGerados || []).some((g) => g.tipo === "termo_compromisso"), "Gere o termo pelo botão abaixo");
      manual("termoAssinado", "Termo de compromisso assinado");
      break;
    }
    case "prefeitura":
      manual("parecer", "Parecer social emitido");
      manual("semExigencias", "Unidade sem exigências pendentes da prefeitura");
      break;
    default:
  }
  (ctx.campos || []).filter((c) => c.ativo && c.id !== "cp_familia" && !campoConfrontante(c.id) && c.obrigatorioEtapa === etapaId)
    .forEach((c) => auto(`extra_${c.id}`, `${c.rotulo} preenchido`, campoPreenchido(c, p.extras?.[c.id]), "Preencha no cadastro"));
  return R;
}

function itemRespondido(item, v) {
  if (item.tipo === "check") return v === true;
  if (item.tipo === "simnao") return v === "sim" || v === "nao";
  return preenchido(v);
}

function itensCampoFaltando(p, checklist) {
  const resp = p.campo?.respostas || {};
  return checklist.filter((i) => i.ativo && i.obrigatorio && !itemRespondido(i, resp[i.id])).map((i) => i.rotulo);
}

function pendencias(db, p) {
  if(p._resumo)return Array.from({length:p._pendencias||0},()=>({ok:false}));
  if (!ativo(p) || p.etapa >= TOTAL) return [];
  return requisitosEtapa(ETAPAS[p.etapa].id, p, contexto(db, p)).filter((r) => !r.ok);
}

const MIN_MEMORIAL = 40;

function unidadesDe(p) {
  if (p && Array.isArray(p.unidades) && p.unidades.length) return p.unidades;
  return [{ id: `${p?.id || "p"}_u1`, area: "", memorial: "", loteQuadra: p?.campos?.loteQuadra || "" }];
}

function letraUnidade(p, i) { return unidadesDe(p).length > 1 ? String.fromCharCode(65 + i) : ""; }

function codigoUnidade(p, i) { return `${p.codigo}${letraUnidade(p, i)}`; }

const campoCompleto = (db, p) => p._resumo ? !!p._campoCompleto : (p.campo?.fotos || []).some((f) => f.tipo === "fachada") && itensCampoFaltando(p, checklistDoMunicipio(db, p.municipioId)).length === 0 && !confrontantesFaltando(p).length;

const ajustesDoMunicipio = (db, municipioId) => (db.ajustesMunicipio || {})[municipioId] || null;

const checklistDoMunicipio = (db, municipioId) => ajustesDoMunicipio(db, municipioId)?.checklistCampo || db.checklistCampo || [];
export { pendencias, campoCompleto, ativo, TOTAL, requisitosEtapa, ETAPAS, contexto, itensCampoFaltando, checklistDoMunicipio, aplicarAjustesRequisitos, requisitosPadrao, acharDuplicado, itemRespondido, ajustesDoMunicipio, preenchido, so, ehPJ, documentoValido, faltantesPessoa, temConjuge, faltantesQualificacao, DOC_TIPOS, docOk, docStatusTexto, parseNum, criterioNucleo, unidadesDe, codigoUnidade, MIN_MEMORIAL, campoPreenchido, normalizar, cnpjValido, cpfValido, COM_CONJUGE, docBloqueado, letraUnidade };
