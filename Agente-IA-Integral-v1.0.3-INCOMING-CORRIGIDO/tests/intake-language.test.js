import {test} from 'node:test';import assert from 'node:assert/strict';
import {validName,cleanMunicipality,validDocument,commercialIntent,missingQuestion} from '../lib/intake-language.js';
import {extractIdentity} from '../lib/integracao-intake.js';
import {waitingNotice} from '../lib/wait-notices.js';
test('nome aceita acentos e sobrenome composto, rejeita conversa, cargo e terceiro',()=>{
 for(const n of ['João da Silva','Ana-Maria D’Ávila','José Boiteux','José Silva Filho','João da Silva Neto'])assert.equal(validName(n),true,n);
 for(const n of ['Bom dia','Da onde','Nossa mudou','Financeiro aqui','Sou neto da Ana','123 Maria','Ana'])assert.equal(validName(n),false,n);
});
test('município normaliza UF sem alterar o nome nem transformar bairro em cidade',()=>{
 for(const c of ['Taió/SC','Taió - SC','Taió, SC','Taió SC','Taió Santa Catarina'])assert.equal(cleanMunicipality(c),'Taió');
 assert.equal(cleanMunicipality('Braço do Trombudo/SC'),'Braço do Trombudo');
 assert.equal(cleanMunicipality('Planta Carvoeiro'),'Planta Carvoeiro');
});
test('documento exige dígitos verificadores válidos',()=>{
 assert.equal(validDocument('529.982.247-25'),true);assert.equal(validDocument('11.222.333/0001-81'),true);
 for(const d of ['11111111111','52998224720','1234'])assert.equal(validDocument(d),false);
});
test('contexto comercial tem prioridade sobre prefeitura, topografia e projeto',()=>{
 for(const s of ['Quero começar a regularizar meu terreno junto à prefeitura','Gostaria de uma parceria comercial','Somos fornecedores e queremos apresentar nossa empresa','Preciso de orçamento para topografia'])assert.equal(commercialIntent(s),true,s);
 for(const s of ['Já sou cliente e quero saber como está minha regularização','Meu processo foi protocolado na prefeitura','Não quero regularizar agora'])assert.equal(commercialIntent(s),false,s);
});
test('não inventa nome extraído, não usa nome de familiar e rejeita CPF inválido',async()=>{
 const client={responses:{create:async()=>({output_text:JSON.stringify({nome:'Ana Maria',cidade:'Taió',documento:'11111111111',pede_andamento:true,representante:true})})}};
 const r=await extractIdentity('Sou neto de Ana Maria, moro em Taió',{},client);assert.equal(r.representante,true);assert.equal(r.documento,'');assert.equal(r.documento_invalido,true);
 client.responses.create=async()=>({output_text:JSON.stringify({nome:'Pessoa Inventada',cidade:'Taió',documento:''})});
 assert.equal((await extractIdentity('Bom dia',{},client)).nome,'');
});
test('pergunta pelo campo pendente, sem pedir novamente os outros',()=>{
 assert.match(missingQuestion({ia_nome:'João Silva'},'cidade'),/município/);
 assert.doesNotMatch(missingQuestion({ia_nome:'João Silva'},'cidade'),/nome completo|CPF/);
 assert.match(missingQuestion({ia_nome:'João Silva',ia_cidade:'Taió'},'documento'),/apenas o CPF/);
});
const base={status:'open',meta:{team:{id:1}},custom_attributes:{ia_etapa:'encaminhado',ia_encaminhado_em:'2026-09-25T14:00:00Z'}};
const incoming={message_type:'incoming',created_at:Date.parse('2026-09-25T13:59:00Z')/1000};
test('aviso da própria IA não impede os próximos; intervalo permanece duas horas',()=>{
 const messages=[incoming,{message_type:1,content_attributes:{integral_ai:true},created_at:Date.parse('2026-09-25T14:30:00Z')/1000}];
 const c={...base,custom_attributes:{...base.custom_attributes,ia_ultima_cutucada_em:'2026-09-25T14:30:00Z'}};
 assert.equal(waitingNotice(c,messages,new Date('2026-09-25T15:30:00Z')),null);
 assert.equal(waitingNotice(c,messages,new Date('2026-09-25T16:31:00Z')).action,'nudge');
});
test('sexta-feira ao fechar não promete sábado, prazo nem demanda inexistente',()=>{
 const r=waitingNotice(base,[incoming],new Date('2026-09-25T21:10:00Z'));assert.equal(r.action,'end_of_day');
 assert.doesNotMatch(r.text,/amanhã|em instantes|já já|grande|alto volume/);
 assert.equal(waitingNotice(base,[incoming],new Date('2026-09-26T12:00:00Z')),null);
});
test('humano cancela todos os avisos mesmo com nova mensagem do cliente depois',()=>{
 const messages=[incoming,{message_type:1,created_at:Date.parse('2026-09-25T14:05:00Z')/1000},{...incoming,created_at:Date.parse('2026-09-25T15:00:00Z')/1000}];
 assert.equal(waitingNotice(base,messages,new Date('2026-09-25T16:30:00Z')),null);
});

import {timestamp} from '../lib/conversation-control.js';
test('horário decimal do Chatwoot sempre produz milissegundos inteiros',()=>{assert.equal(timestamp(1790172548.772),1790172548772);assert.equal(Number.isInteger(timestamp(1790172548.772)),true);});
