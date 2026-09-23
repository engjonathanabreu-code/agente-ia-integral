export const normalized=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const states='AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO';
export function cleanMunicipality(value){return String(value||'').trim().replace(new RegExp(`(?:\\s*[,/\\-]\\s*|\\s+)(${states})$`,'i'),'').replace(/\s*[-,/]?\s*Santa Catarina$/i,'').trim();}
export function validName(value){
 const n=String(value||'').trim(),t=normalized(n);
 return n.length>=5&&n.length<=150&&/^[\p{L}][\p{L}\s'’.-]+$/u.test(n)&&n.split(/\s+/).length>=2
  &&!/[.!?]$/.test(n)&&! /^(bom dia|boa tarde|boa noite)$/.test(t)&&! /\b(oi|ola|obrigad[oa]|quero|preciso|gostaria|atendimento|financeiro|comercial|projetos|prefeitura|sou|moro|tenho|meu|minha|municipio|bairro|mudou|onde|aqui|voce|sim|nao)\b/.test(t);
}
export function validDocument(value){
 const d=String(value||'').replace(/\D/g,'');if(![11,14].includes(d.length)||/^(\d)\1+$/.test(d))return false;
 const digit=(v,w)=>{const r=v.split('').reduce((sum,n,i)=>sum+Number(n)*w[i],0)%11;return r<2?0:11-r;};
 if(d.length===11)return Number(d[9])===digit(d.slice(0,9),[10,9,8,7,6,5,4,3,2])&&Number(d[10])===digit(d.slice(0,10),[11,10,9,8,7,6,5,4,3,2]);
 return Number(d[12])===digit(d.slice(0,12),[5,4,3,2,9,8,7,6,5,4,3,2])&&Number(d[13])===digit(d.slice(0,13),[6,5,4,3,2,9,8,7,6,5,4,3,2]);
}
export function commercialIntent(value){
 const t=normalized(value);
 if(/\b(nao quero|nao tenho interesse|nao procuro)\b/.test(t))return false;
 const existing=/\b(andamento|situacao|status|acompanhar|etapa|fase|como esta|ja (sou cliente|contratei|paguei|tenho|iniciei|comecei)|meu processo|minha (escritura|matricula)|nosso contrato|processo (ja )?protocolado)\b/.test(t);
 const partnership=/\b(parceria|parceiro|parceiros|fornecedor|fornecedores|oferecer (nossos |meus |os )?servicos|apresentar (nossa |minha )?empresa)\b/.test(t);
 const newService=/\b(orcamento|contratar|novo servico|nova contratacao)\b/.test(t)||/\b(quero|gostaria|preciso|quanto custa|qual (o )?valor|preco|como (faco|posso)|iniciar|comecar)\b.*\b(regularizar|legalizar|regularizacao|legalizacao)\b/.test(t);
 return partnership||(!existing&&newService);
}
export function hasNeed(value){return /\b(andamento|processo|escritura|matricula|boleto|parcela|pagar|pagamento|cobranca|contrato|area|medicao|projeto|regulariz\w*|legaliz\w*|parceria|orcamento|duvida|preciso|quero|gostaria)\b/.test(normalized(value));}
export function missingQuestion(attrs,field){
 if(field==='documento')return 'Já tenho seu nome e o município. Para conferir o vínculo com seu cadastro, informe apenas o CPF do titular, por favor.';
 if(field==='cidade')return 'Qual é o município onde fica o imóvel? Pode informar a cidade e a sigla do estado.';
 if(field==='nome')return 'Qual é o seu nome completo, com nome e sobrenome?';
 if(!attrs.ia_nome)return missingQuestion(attrs,'nome');
 if(!attrs.ia_cidade)return missingQuestion(attrs,'cidade');
 return 'Obrigado pelos dados. O que você precisa resolver hoje?';
}
