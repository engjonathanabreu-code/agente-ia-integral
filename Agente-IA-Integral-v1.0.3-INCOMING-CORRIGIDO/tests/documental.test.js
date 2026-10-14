import test from 'node:test';import assert from 'node:assert/strict';
import {documentaryIntent,pendingDocuments,validateAnalysis,GUARATUBA,handleDocumental} from '../lib/documental.js';
import {createHash} from 'node:crypto';
import {validAttachmentURL,documentMime,MAX_DOCUMENT_BYTES,limitedBytes,verifyFolder,archiveFile,listClientFiles} from '../lib/documental-drive.js';
import {cronAuthorized} from '../api/documental-check.js';
const context=()=>({processo:{municipioId:GUARATUBA,requerente:{nome:'Pessoa fictícia',estadoCivil:'Solteiro(a)'},conjuge:{},docs:[],endereco:{},social:{},checks:{},corequerentes:[],ocupantes:[]},configuracoes:{},regras:[{id:'regra',ativa:true,tipos:['identidade'],gravidade:'bloqueia',nome:'Documento inteiro',instrucao:'Envie o documento inteiro.'}],arquivos:[]});
const analysis=()=>({tipo:'identidade',pessoa:'requerente',legivel:true,completo:true,confianca:0.96,identidadeCompativel:true,campos:{},paginas:[1],regras:[{id:'regra',resultado:'atende'}]});
test('inventário confere subpastas do cliente e recusa árvore incompleta',async()=>{
 const original=global.fetch;let reads=0;
 global.fetch=async url=>{const q=new URL(url).searchParams.get('q');const folder=q.split("'")[1];return new Response(JSON.stringify({files:folder==='cliente'?[{id:'docs',parents:['cliente'],mimeType:'application/vnd.google-apps.folder'}]:[{id:'cpf.pdf',parents:['docs'],mimeType:'application/pdf'}]}),{headers:{'Content-Type':'application/json'}});};
 try{assert.deepEqual((await listClientFiles('cliente','token',async()=>reads++)).map(f=>f.id),['cpf.pdf']);assert.equal(reads,2);
 await assert.rejects(listClientFiles('cliente','token',async()=>{},['docs']),/pasta_de_outro_cliente/);
 global.fetch=async()=>new Response(JSON.stringify({files:[{id:'cliente',parents:['cliente'],mimeType:'application/vnd.google-apps.folder'}]}),{headers:{'Content-Type':'application/json'}});
 await assert.rejects(listClientFiles('cliente','token'),/inventario_incompleto/);
 }finally{global.fetch=original;}
});
test('financeiro, andamento, nova identificação e pedido humano seguem o agente existente',()=>{
 for(const text of ['Quero um boleto','Qual o andamento?','Quero falar com um atendente','Sou a Maria','Meu nome mudou'])assert.equal(documentaryIntent(text,[],{ia_documental_ativo:true}),false,text);
 assert.equal(documentaryIntent('Vou enviar os documentos',[],{}),true);
});
test('checklist municipal desativa item e não cobra documento recebido aguardando equipe',()=>{
 const c=context();c.configuracoes.ajustesMunicipio={[GUARATUBA]:{ajustesRequisitos:{documental:{desativados:['doc_comp_residencia']}}}};
 c.processo.docs=[{tipo:'identidade',status:'recebido'}];
 assert.ok(!pendingDocuments(c).some(r=>r.tipo==='identidade'||r.tipo==='comp_residencia'));
 assert.ok(pendingDocuments(c).some(r=>r.tipo==='comp_posse'));
});
test('análise completa gera conformidade técnica; identidade incerta fica em revisão',()=>{
 assert.equal(validateAnalysis(analysis(),context()).status,'conforme');
 assert.equal(validateAnalysis({...analysis(),identidadeCompativel:false},context()).status,'revisao');
 assert.equal(validateAnalysis({...analysis(),confianca:0.5},context()).status,'revisao');
 assert.throws(()=>validateAnalysis({...analysis(),regras:[]},context()),/regras_incompletas/);
 assert.throws(()=>validateAnalysis({...analysis(),paginas:[]},context()),/formato/);
 const invalid={...analysis(),legivel:false,regras:[{id:'regra',resultado:'nao_atende'}]};
 assert.equal(validateAnalysis(invalid,context()).status,'correcao');
});
test('anexo só sai de HTTPS em origem aprovada e MIME real limita extração',async()=>{
 assert.throws(()=>validAttachmentURL('https://127.0.0.1/a',['chatwoot.exemplo']),/origem/);
 assert.throws(()=>validAttachmentURL('http://chatwoot.exemplo/a',['chatwoot.exemplo']),/origem/);
 assert.throws(()=>validAttachmentURL('https://user:pass@chatwoot.exemplo/a',['chatwoot.exemplo']),/origem/);
 assert.equal(documentMime(Buffer.from('%PDF-1.4')),'application/pdf');
 assert.throws(()=>documentMime(Buffer.from('<script>')),/formato/);
 await assert.rejects(limitedBytes(new Response('x',{headers:{'content-length':String(MAX_DOCUMENT_BYTES+1)}})),/grande/);
});
test('pasta fora de Guaratuba é recusada antes de upload',async()=>{
 const original=global.fetch;global.fetch=async()=>new Response(JSON.stringify({id:'pasta',mimeType:'application/vnd.google-apps.folder',parents:[],capabilities:{canAddChildren:true}}),{headers:{'Content-Type':'application/json'}});
 try{await assert.rejects(verifyFolder('pasta','raiz','token-ficticio'),/fora_guaratuba/);}finally{global.fetch=original;}
});
test('reprocessar arquivo reconciliado não repete o upload',async()=>{
 const original=global.fetch;let effects=0;
 const bytes=Buffer.from('%PDF-fixture');
 global.fetch=async()=>new Response(JSON.stringify({files:[{id:'ja-salvo',md5Checksum:createHash('md5').update(bytes).digest('hex'),appProperties:{integral_client_id:'cliente',integral_origin:'origem'}}]}),{headers:{'Content-Type':'application/json'}});
 try{const r=await archiveFile({folder:'pasta',clientId:'cliente',origin:'origem',bytes,token:'token-ficticio',beforeEffect:async()=>effects++});assert.equal(r.id,'ja-salvo');assert.equal(effects,0);}finally{global.fetch=original;}
});
test('verificação automática exige segredo de cron',()=>{
 const before=process.env.CRON_SECRET;process.env.CRON_SECRET='segredo-ficticio';
 try{assert.equal(cronAuthorized({headers:{authorization:'Bearer segredo-ficticio'}}),true);assert.equal(cronAuthorized({headers:{authorization:'Bearer outro'}}),false);}finally{if(before===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=before;}
});

for(const mode of ['ligado','desligado_durante_upload','humano_durante_analise'])test('ciclo completo documental: '+mode,async()=>{
 const original=global.fetch,keys=['CHATWOOT_BASE_URL','CHATWOOT_ACCOUNT_ID','CHATWOOT_API_TOKEN','INTEGRACAO_SUPABASE_SECRET','GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_CLIENT_SECRET','GOOGLE_DRIVE_REFRESH_TOKEN','OPENAI_API_KEY','DOCUMENTAL_GUARATUBA_ENABLED'];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{CHATWOOT_BASE_URL:'https://chatwoot.exemplo',CHATWOOT_ACCOUNT_ID:'1',CHATWOOT_API_TOKEN:'token-ficticio',INTEGRACAO_SUPABASE_SECRET:'segredo-ficticio',GOOGLE_DRIVE_CLIENT_ID:'app-ficticio',GOOGLE_DRIVE_CLIENT_SECRET:'segredo-ficticio',GOOGLE_DRIVE_REFRESH_TOKEN:'refresh-ficticio',OPENAI_API_KEY:'chave-ficticia',DOCUMENTAL_GUARATUBA_ENABLED:'true'});
 const c=context();Object.assign(c,{cliente_id:'00000000-0000-4000-8000-000000000003',pasta_id:'pasta-cliente',config:{ativo:true,pronto:true,versao:1,pasta_raiz:'raiz'}});c.processo.requerente.cpf='52998224725';
 const attrs={ia_documento:'52998224725',ia_documental_ativo:true};
 const message={id:5,message_type:'incoming',private:false,created_at:Math.floor(Date.now()/1000),attachments:[{id:8,file_name:'teste.pdf',data_url:'https://chatwoot.exemplo/file'}]};
 let ativo=true,human=false,modelCalls=0;const writes=[],pdf=Buffer.from('%PDF-fixture'),md5=createHash('md5').update(pdf).digest('hex');
 const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 global.fetch=async(url,options={})=>{
  const u=String(url),method=options.method||'GET',body=typeof options.body==='string'?JSON.parse(options.body):null;
  if(u.includes('supabase.co/rest/v1/rpc/integracao_documental_contexto'))return json(c);
  if(u.includes('supabase.co/rest/v1/integracao_documental_config'))return json([{...c.config,ativo}]);
  if(u.includes('supabase.co/rest/v1/integracao_documental_pastas'))return json([{pasta_id:'pasta-outro-cliente'}]);
  if(u.includes('supabase.co/rest/v1/integracao_documental_arquivos')){writes.push({kind:'recibo',body});return json([{id:'arquivo-ficticio',...body}]);}
  if(u.includes('supabase.co/rest/v1/rpc/integracao_documental_registrar')){writes.push({kind:'cadastro',body});c.processo.docs.push(body.p_documento);return json(true);}
  if(u.endsWith('/conversations/9/messages')){if(method==='POST'){writes.push({kind:'mensagem',body});return json({id:20});}return json({payload:[message]});}
  if(u.endsWith('/conversations/9/custom_attributes'))return json({});
  if(u.endsWith('/conversations/9'))return json({id:9,status:'open',custom_attributes:{...attrs,...(human?{ia_atendimento_concluido:true}:{})},messages:[]});
  if(u==='https://chatwoot.exemplo/file')return new Response(pdf);
  if(u==='https://oauth2.googleapis.com/token')return json({access_token:'token-ficticio'});
  if(u.includes('/upload/drive/')){writes.push({kind:'upload'});if(mode==='desligado_durante_upload')ativo=false;return json({id:'drive-ficticio'});}
  if(u.includes('/drive/v3/files/pasta-cliente'))return json({id:'pasta-cliente',mimeType:'application/vnd.google-apps.folder',parents:['raiz'],capabilities:{canAddChildren:true}});
  if(u.includes('/drive/v3/files/raiz'))return json({id:'raiz',mimeType:'application/vnd.google-apps.folder',parents:[],capabilities:{canAddChildren:true}});
  if(u.includes('/drive/v3/files/drive-ficticio'))return json({id:'drive-ficticio',name:'teste.pdf',parents:['pasta-cliente'],md5Checksum:md5});
  if(u.includes('/drive/v3/files?'))return json({files:[]});
  if(u.includes('api.openai.com/v1/responses')){modelCalls++;if(mode==='humano_durante_analise')human=true;return json({id:'resp-ficticia',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(analysis())}]}]});}
  throw new Error('URL não prevista no teste: '+u);
 };
 try{
  const result=mode==='humano_durante_analise'?await assert.rejects(handleDocumental({...message,conversation:{id:9}}),/human_takeover/):await handleDocumental({...message,conversation:{id:9}});
  assert.equal(writes.filter(x=>x.kind==='upload').length,1);
  if(mode==='ligado'){
   const saved=writes.find(x=>x.kind==='cadastro').body.p_documento;
   assert.equal(saved.status,'recebido');assert.equal(saved.documentalConforme,true);assert.equal(saved.driveId,'drive-ficticio');assert.ok(writes.some(x=>x.kind==='mensagem'));
  }else{
   assert.equal(writes.filter(x=>x.kind==='mensagem'||x.kind==='cadastro').length,0);
   if(mode==='desligado_durante_upload'){assert.equal(result.stage,'documental_pausado');assert.equal(modelCalls,0);}
  }
 }finally{global.fetch=original;for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
});
