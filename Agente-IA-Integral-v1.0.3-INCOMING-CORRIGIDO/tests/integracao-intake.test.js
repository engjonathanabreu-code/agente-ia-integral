import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractIdentity,formatNucleusProgress} from '../lib/integracao-intake.js';
test('extração aceita cidade antes do nome, usa schema e não envia cadastro ao modelo',async()=>{
 let input;
 const client={responses:{create:async x=>{input=x;return {output_text:JSON.stringify({nome:'José da Silva',cidade:'Taió',documento:'',pede_andamento:true})};}}};
 const r=await extractIdentity('Sou de Taió, José da Silva. Como está meu processo?',{},client);
 assert.equal(r.cidade,'Taió');assert.equal(r.nome,'José da Silva');assert.equal(input.store,false);assert.equal(input.text.format.strict,true);
 assert.equal(JSON.parse(input.input).anteriores.nome,'');
});
test('instrução do núcleo acompanha somente fatos autorizados; falha do modelo usa descrição factual',async()=>{
 let request;
 const data={projeto:{nome:'Núcleo teste'},instrucao_nucleo:'Explicar com palavras simples.',andamento_atual:{descricao_cliente:'Em análise',previsao:null}};
 const client={responses:{create:async x=>{request=x;return{output_text:'O processo está em análise.'};}}};
 assert.equal(await formatNucleusProgress(data,'Em análise',client),'O processo está em análise.');
 assert.equal(JSON.parse(request.input).instrucao_nucleo,data.instrucao_nucleo);
 assert.equal(await formatNucleusProgress(data,'Em análise',{responses:{create:async()=>{throw Error('offline');}}}),'Em análise');
});
