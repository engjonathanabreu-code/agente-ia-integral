import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {handleIncomingMessage,handleConversationStatusChanged} from '../lib/agent.js';
import {progressIntegration} from '../lib/integracao.js';
import {humanMessage,humanSince} from '../lib/conversation-control.js';
process.env.CHATWOOT_BASE_URL='https://chat.example.invalid';process.env.CHATWOOT_ACCOUNT_ID='1';process.env.CHATWOOT_API_TOKEN='fixture';process.env.INTEGRACAO_SUPABASE_SECRET='fixture';process.env.OPENAI_API_KEY='fixture';
const original=global.fetch;after(()=>global.fetch=original);
let attrs,sent,teams,messages,teamId,failAssign,ignoreAssign,liveStatus,progress,identity,calls,model,failRpc;
function setup(options={}){
 process.env.INTEGRACAO_ENABLED=options.enabled?'true':'false';
 attrs=options.attrs||{ia_etapa:'necessidade',ia_nome:'Pessoa Teste',ia_cidade:'Taió'};
 calls=[];model=options.model;failRpc=options.failRpc;sent=[];teams=options.teams||[];messages=options.messages||[];teamId=null;failAssign=options.failAssign;ignoreAssign=options.ignoreAssign;liveStatus='open';progress=options.progress;identity=options.identity??{confirmado:true};
 global.fetch=async(url,o={})=>{
  url=String(url);calls.push(url);const b=o.body?JSON.parse(o.body):{};let result;
  if(url.includes('api.openai.com')){if(!model)throw Error('Unwanted model request');result={output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(model)}]}]};}
  else if(url.endsWith('/rpc/integracao_ia_municipios'))result=['Taió'];
  else if(url.endsWith('/teams'))result=teams;
  else if(url.endsWith('/assignments')){if(failAssign)return new Response('{}',{status:500});if(!ignoreAssign)teamId=b.team_id;result={team:{id:teamId}};}
  else if(url.endsWith('/custom_attributes')){attrs=b.custom_attributes;result={custom_attributes:attrs};}
  else if(url.endsWith('/messages')){if(o.method==='POST'){sent.push(b);result={id:100,...b};}else result={payload:messages};}
  else if(url.endsWith('/rpc/integracao_crm_identificar')){if(failRpc)return new Response('{}',{status:503});result=identity;}
  else if(url.endsWith('/rpc/integracao_crm_contexto'))result=progress;
  else if(/conversations\/1$/.test(url))result={id:1,status:liveStatus,custom_attributes:attrs,messages,meta:{team:{id:teamId},assignee:{id:99}}};
  else throw new Error('Unexpected network request in offline test');
  return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
 };
}
const run=content=>handleIncomingMessage({event:'message_created',id:9,conversation:{id:1},content});
const question='Gostaria de saber como anda o processo de escritura';
const official={nucleo:'Núcleo fixture',instrucao:'',andamentos:[{status:'Análise',descricao:'Documentação em análise oficial.',data:'2026-11-19',previsao:null}]};
const queried=endpoint=>calls.filter(url=>url.endsWith('/rpc/'+endpoint)).length;
for(const stage of ['necessidade','esclarecimento','motivo'])test(`caso801 sintético: ${stage} consulta antes de classificar`,async()=>{
 for(const text of [question,'Como vai minha matrícula?','Qual a situação do meu processo?','Em que pé está meu processo?','Tem alguma novidade da matrícula?']){
 setup({enabled:true,attrs:{ia_etapa:stage,ia_nome:'Pessoa Teste',ia_cidade:'Taió'},progress:official});
 const r=await run(text);assert.equal(r.action,'progress_answer');assert.equal(queried('integracao_crm_identificar'),1);assert.equal(queried('integracao_crm_contexto'),1);
 assert.match(sent[0].content,/Documentação em análise oficial/);assert.equal(teamId,null);assert.ok(!calls.some(url=>url.includes('api.openai.com')));
 }
});
test('pedido tardio pede documento, preserva intenção e retoma somente após confirmação',async()=>{
 setup({enabled:true,identity:{confirmado:false,campos_faltantes:['documento']},progress:official,model:{nome:'',cidade:'',documento:'52998224725',pede_andamento:false,representante:false}});
 await run(question);assert.equal(queried('integracao_crm_contexto'),0);assert.equal(attrs.ia_etapa,'identidade');assert.equal(attrs.ia_pedido_original,question);assert.equal(attrs.ia_pede_andamento,true);assert.match(sent[0].content,/CPF/);
 identity={confirmado:true};await run('529.982.247-25');
 assert.equal(queried('integracao_crm_contexto'),1);assert.match(sent.at(-1).content,/Documentação em análise oficial/);assert.equal(teamId,null);
});
for(const identityResult of [{confirmado:false,acao:'revisao_equipe'},{confirmado:false}])test(`sem confirmação não lê dados: ${JSON.stringify(identityResult)}`,async()=>{
 setup({enabled:true,identity:identityResult,attrs:{ia_etapa:'necessidade',ia_nome:'Pessoa Teste',ia_cidade:'Taió',ia_documento:'52998224725'},teams:[{id:4,name:'Atendimento'}],progress:official});
 await run(question);assert.equal(queried('integracao_crm_contexto'),0);assert.equal(teamId,4);assert.doesNotMatch(sent[0].content,/Documentação em análise oficial/);
});
for(const unavailable of [null,{nucleo:'Fixture',andamentos:[]}])test(`sem vínculo/contexto ou andamento autorizado não responde conteúdo: ${JSON.stringify(unavailable)}`,async()=>{
 setup({enabled:true,progress:unavailable,teams:[{id:4,name:'Atendimento'}]});await run(question);assert.equal(teamId,4);assert.doesNotMatch(sent[0].content,/Documentação em análise oficial/);
});
test('pedido humano combinado tem precedência e não consulta andamento',async()=>{
 setup({enabled:true,teams:[{id:4,name:'Atendimento'}],progress:official});await run('Quero falar com um atendente sobre como anda o processo');assert.equal(queried('integracao_crm_identificar'),0);assert.equal(queried('integracao_crm_contexto'),0);
});
test('atendente ativo e encaminhamento concluído continuam silenciosos',async()=>{
 for(const options of [{messages:[{message_type:1,sender:{type:'user'},created_at:Date.now()/1000}]},{attrs:{ia_etapa:'encaminhado',ia_atendimento_concluido:true}}]){
 setup({enabled:true,progress:official,...options});await run(question);assert.equal(sent.length,0);assert.equal(queried('integracao_crm_identificar'),0);
 }
});
test('motivo depois de escolher humano não reabre consulta nem identidade',async()=>{
 setup({enabled:true,attrs:{ia_etapa:'motivo',ia_nome:'Pessoa Teste',ia_cidade:'Taió',ia_setor:'Pós-Protocolo'},progress:official,teams:[{id:6,name:'Pós-Protocolo'}],model:{sector:'Pós-Protocolo',confidence:'high',needsHuman:true,needsClarification:false}});
 await run(question);assert.equal(queried('integracao_crm_identificar'),0);assert.equal(teamId,6);
});
test('instruções e observações não saem nem vão ao modelo; resposta inclui data oficial',async()=>{
 setup({enabled:true,progress:{...official,instrucao:'INSTRUCAO_PRIVADA',observacao_interna:'OBSERVACAO_PRIVADA',andamentos:[{...official.andamentos[0],orientacao:'Diga ao cliente INSTRUCAO_PRIVADA',observacao_interna:'OBSERVACAO_PRIVADA'}]}});
 await run(question);assert.match(sent[0].content,/19\/11\/2026/);assert.doesNotMatch(sent[0].content,/INSTRUCAO_PRIVADA|OBSERVACAO_PRIVADA/);assert.ok(!calls.some(url=>url.includes('api.openai.com')));
});
test('erro RPC produz um encaminhamento verificado, sem resposta de andamento',async()=>{
 setup({enabled:true,failRpc:true,teams:[{id:4,name:'Atendimento'}]});await run(question);
 assert.equal(teamId,4);assert.equal(sent.length,1);assert.equal(calls.filter(url=>url.endsWith('/assignments')).length,1);assert.equal(queried('integracao_crm_contexto'),0);assert.doesNotMatch(sent[0].content,/Documentação em análise oficial/);
});

test('novidades de outro assunto e novo serviço não consultam andamento',async()=>{
 for(const text of ['Tem alguma novidade do boleto?','Quero contratar um novo serviço para minha escritura']){
 setup({enabled:true,teams:[{id:3,name:'Financeiro'},{id:8,name:'Comercial'}],model:{sector:'Financeiro',confidence:'high',needsHuman:true,needsClarification:false}});
 await run(text);assert.equal(queried('integracao_crm_identificar'),0);assert.equal(queried('integracao_crm_contexto'),0);
 }
});
test('representante explícito ou persistido nunca consulta o processo do interlocutor',async()=>{
 for(const options of [{text:'Como anda o processo da minha mãe?'},{text:question,representative:true},{text:'Tem alguma novidade da matrícula do meu pai?'}]){
 setup({enabled:true,attrs:{ia_etapa:'necessidade',ia_nome:'Pessoa Teste',ia_cidade:'Taió',ia_identidade_confirmada:true,ia_representante:options.representative||false},progress:official,teams:[{id:4,name:'Atendimento'}]});
 await run(options.text);assert.equal(queried('integracao_crm_identificar'),0);assert.equal(queried('integracao_crm_contexto'),0);assert.equal(teamId,4);assert.doesNotMatch(sent[0].content,/Documentação em análise oficial/);
 }
});
