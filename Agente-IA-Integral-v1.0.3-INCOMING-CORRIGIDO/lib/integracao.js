// Server-only bridge. Uses the existing ERP credential; never changes client records.
export const integrationEnabled = () => process.env.INTEGRACAO_ENABLED === 'true';
export const installation = () => new URL(process.env.CHATWOOT_BASE_URL).host;
export const account = () => String(process.env.CHATWOOT_ACCOUNT_ID || '');
const externalId = v => /^\d{1,18}$/.test(String(v ?? '')) ? String(v) : null;
export async function integrationDB(path, body, method) {
  const key = process.env.ERP_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('integration_credential_missing');
  const r = await fetch(`https://ycdsyilyvaxslkwbkxyo.supabase.co/rest/v1/${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json', Prefer:'return=representation'},
    body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error(`integration_database_${r.status}`);
  return r.status === 204 ? null : r.json();
}
export function integrationEvent(p) {
  if (!['message_created','conversation_created','conversation_updated','conversation_status_changed'].includes(p?.event)) return null;
  const c=p.conversation||p, contact=c.meta?.sender||p.contact||(p.sender?.type!=='user'?p.sender:null);
  const conta=externalId(p.account?.id||c.account_id), conversa=externalId(c.id), contato=externalId(c.contact_inbox?.contact_id||contact?.id);
  if (!conta || conta!==account()) throw new Error('integration_account_mismatch');
  if (!conversa || !contato) throw new Error('integration_identity_missing');
  const mensagem=p.event==='message_created'?externalId(p.id):null;
  if (p.event==='message_created'&&!mensagem) throw new Error('integration_message_missing');
  const date=typeof p.created_at==='number'?new Date(p.created_at*1000):new Date(p.created_at||Date.now());
  if (Number.isNaN(date.getTime())) throw new Error('integration_date_invalid');
  return {instalacao:installation(),conta_id:conta,conversa_id:conversa,contato_id:contato,mensagem_id:mensagem,
    agente_id:externalId(c.meta?.assignee?.id||c.assignee_id),nome:contact?.name||'Contato Chatwoot',telefone:contact?.phone_number||'',
    conteudo:typeof p.content==='string'?p.content:'',privada:p.private===true,autor:p.sender?.name||'',direcao:String(p.message_type??''),
    anexos:(p.attachments||[]).map(a=>({id:a.id,nome:a.file_name||a.file_type,url:a.data_url,file_type:a.file_type})),data:date.toISOString()};
}
export async function syncIntegration(payload) {
  if (!integrationEnabled()) return null;
  const evento=integrationEvent(payload);
  if (!evento) return null;
  const id=await integrationDB('rpc/integracao_crm_receber',{evento});
  const attrs=(payload.conversation||payload).custom_attributes||{};
  if (attrs.ia_nome&&attrs.ia_cidade) await identifyIntegration(evento.conversa_id,attrs);
  return id;
}
export async function identifyIntegration(conversationId, attrs) {
  return integrationDB('rpc/integracao_crm_identificar', {instalacao:installation(),conta:account(),conversa:String(conversationId),
    nome:String(attrs.ia_nome||'').slice(0,150),cidade:String(attrs.ia_cidade||'').slice(0,100),documento:String(attrs.ia_documento||'').replace(/\D/g,'').slice(0,14)});
}
export async function progressIntegration(conversationId, attrs={}) {
  const identity=await identifyIntegration(conversationId,attrs);
  if (!identity?.confirmado) return {ok:true,found:false,identity_pending:true,pergunta:identity?.pergunta};
  const c=await integrationDB('rpc/integracao_crm_contexto',{instalacao:installation(),conta:account(),conversa:String(conversationId)});
  if (!c) return {ok:true,found:true,andamento_available:false};
  const p=c.andamentos?.[0];
  return {ok:true,found:true,andamento_available:!!p,projeto:{nome:c.nucleo},instrucao_nucleo:c.instrucao||'',
    andamento_atual:p?{etapa:p.status,status_operacional:p.status_operacional,descricao_cliente:p.descricao,previsao:p.previsao,atualizado_em:p.data,orientacao_ia:p.orientacao}:null};
}
