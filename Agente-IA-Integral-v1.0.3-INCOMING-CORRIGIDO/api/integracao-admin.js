import crypto from 'node:crypto';
import {integrationDB,installation,account,integrationEnabled,syncIntegration} from '../lib/integracao.js';
import {listWebhooks,updateWebhook,getConversation,getConversationMessages,listConversations} from '../lib/chatwoot.js';
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  const expected=Buffer.from(process.env.INTEGRACAO_ADMIN_SECRET||''), actual=Buffer.from(String(req.headers.authorization||'').replace(/^Bearer /,''));
  if (!expected.length||expected.length!==actual.length||!crypto.timingSafeEqual(expected,actual)) return res.status(401).json({error:'Não autorizado'});
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Método não permitido'});
  try {
    const url=`${process.env.CHATWOOT_BASE_URL.replace(/\/+$/,'')}/api/v1/accounts/${account()}/agents`;
    const r=await fetch(url,{headers:{api_access_token:process.env.CHATWOOT_API_TOKEN},signal:AbortSignal.timeout(15000)});
    if (!r.ok) throw new Error(`chatwoot_agents_${r.status}`);
    const agents=await r.json();let profiles=[],databaseError=null;
    try {profiles=await integrationDB('profiles?select=id,nome,email,tipo&ativo=eq.true');}catch(e){databaseError=e.message;}
    const mappings=(Array.isArray(agents)?agents:agents.payload||[]).map(a=>{
      const matches=profiles.filter(p=>p.tipo==='Comercial'&&((a.email&&normalize(a.email)===normalize(p.email))||normalize(a.name)===normalize(p.nome)));
      return {agente_id:a.id,nome:a.name,usuario_id:matches.length===1?matches[0].id:null};
    });
    const hooks=await listWebhooks(), list=Array.isArray(hooks)?hooks:hooks.payload||[];
    // Never output webhook URLs: the existing agent URL contains an access token.
    const own=list.filter(h=>{try {const u=new URL(h.url), app=new URL(process.env.APP_URL);return u.origin===app.origin&&(u.pathname===`/api/webhook/${process.env.WEBHOOK_TOKEN}`||u.searchParams.get('token')===process.env.WEBHOOK_TOKEN);}catch{return false;}});
    if (req.method==='POST') {
      if (databaseError) return res.status(503).json({error:'Credencial do Integração indisponível',code:databaseError});
      if (req.body?.action==='configure') {
        if (own.length!==1) return res.status(409).json({error:'Revisar webhook do agente',webhooks_agente:own.length});
        for (const m of mappings.filter(m=>m.usuario_id)) {
          const existing=await integrationDB(`integracao_crm_agentes?instalacao=eq.${encodeURIComponent(installation())}&conta_id=eq.${account()}&agente_id=eq.${m.agente_id}`);
          if (!existing.length) await integrationDB('integracao_crm_agentes',{instalacao:installation(),conta_id:account(),agente_id:m.agente_id,usuario_id:m.usuario_id});
        }
        await updateWebhook(own[0].id,own[0].url);
      } else if (req.body?.action==='reconcile'&&/^\d{1,18}$/.test(String(req.body.conversation_id||''))) {
        const c=await getConversation(req.body.conversation_id);
        await syncIntegration({...c,account:{id:account()},event:'conversation_updated'});
        const h=await getConversationMessages(req.body.conversation_id), messages=Array.isArray(h)?h:h.payload||[];
        for (const m of messages) await syncIntegration({...m,conversation:c,account:{id:account()},event:'message_created'});
        return res.status(200).json({ok:true,mensagens:messages.length});
      } else return res.status(400).json({error:'Ação inválida'});
    }
    const counts=databaseError?[]:await integrationDB('integracao_crm_conversas?select=id&limit=1');
    const recent=await listConversations({status:'open',page:1});
    return res.status(200).json({ok:!databaseError,enabled:integrationEnabled(),chatwoot:installation(),conta:account(),mapeamentos:mappings,webhooks_agente:own.length,subscriptions:own.map(h=>h.subscriptions),banco_conectado:!databaseError,banco_erro:databaseError,conversa_recebida:!!counts.length,conversas_recentes:(recent?.data?.payload||recent?.payload||[]).slice(0,3).map(c=>({id:c.id,status:c.status}))});
  } catch(e) {console.error('integracao-admin',{tipo:e.name});return res.status(503).json({error:'Integração indisponível',code:/^(integration_|chatwoot_agents_)/.test(e.message)?e.message:'upstream_error'});}
}
