import crypto from 'node:crypto';
import {integrationDB,installation,account,integrationEnabled,syncIntegration} from '../lib/integracao.js';
import {listWebhooks,updateWebhook,getConversation,getConversationMessages,listConversations} from '../lib/chatwoot.js';
import {extractIdentity,formatNucleusProgress} from '../lib/integracao-intake.js';
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export const rows=v=>[v,v?.payload,v?.data,v?.webhooks,v?.agents,v?.data?.payload,v?.payload?.webhooks].find(Array.isArray)||[];
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  const expected=Buffer.from(process.env.INTEGRACAO_ADMIN_SECRET||''), actual=Buffer.from(String(req.headers.authorization||'').replace(/^Bearer /,''));
  if (!expected.length||expected.length!==actual.length||!crypto.timingSafeEqual(expected,actual)) return res.status(401).json({error:'Não autorizado'});
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Método não permitido'});
  let phase='agents';
  try {
    const url=`${process.env.CHATWOOT_BASE_URL.replace(/\/+$/,'')}/api/v1/accounts/${account()}/agents`;
    const r=await fetch(url,{headers:{api_access_token:process.env.CHATWOOT_API_TOKEN},signal:AbortSignal.timeout(15000)});
    if (!r.ok) throw new Error(`chatwoot_agents_${r.status}`);
    const agents=await r.json();let profiles=[],databaseError=null;phase='database';
    try {profiles=await integrationDB('profiles?select=id,nome,email,tipo&ativo=eq.true');}catch(e){databaseError=e.message;}
    const mappings=rows(agents).map(a=>{
      const matches=profiles.filter(p=>p.tipo==='Comercial'&&((a.email&&normalize(a.email)===normalize(p.email))||normalize(a.name)===normalize(p.nome)));
      return {agente_id:a.id,nome:a.name,usuario_id:matches.length===1?matches[0].id:null};
    });
    phase='webhooks';const hooks=await listWebhooks(), list=rows(hooks);
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
      } else if (req.body?.action==='verify_model') {
        phase='model';
        const identity=await extractIdentity('Sou de Taió, meu nome é José da Silva. Gostaria do andamento do meu processo.',{});
        const answer=await formatNucleusProgress({projeto:{nome:'Núcleo de teste'},instrucao_nucleo:'Responda de forma breve.',andamento_atual:{descricao_cliente:'Documentação em análise pela prefeitura.',previsao:null}},'Documentação em análise pela prefeitura.');
        return res.status(200).json({ok:!!identity.nome&&!!identity.cidade,identificacao:identity,resposta_sintetica:answer,mensagem_enviada:false});
      } else if (req.body?.action==='reconcile'&&/^\d{1,18}$/.test(String(req.body.conversation_id||''))) {
        const c=await getConversation(req.body.conversation_id);
        await syncIntegration({...c,account:{id:account()},event:'conversation_updated'});
        const h=await getConversationMessages(req.body.conversation_id), messages=rows(h);
        for (const m of messages) await syncIntegration({...m,conversation:c,account:{id:account()},event:'message_created'});
        return res.status(200).json({ok:true,mensagens:messages.length});
      } else return res.status(400).json({error:'Ação inválida'});
    }
    const counts=databaseError?[]:await integrationDB('integracao_crm_conversas?select=id&limit=1');
    const reviews=databaseError?[]:await integrationDB('integracao_ia_eventos?select=chave,event_key,erro,received_at&status=eq.review&order=received_at.desc&limit=50');
    phase='conversations';const recent=await listConversations({status:'open',page:1});
    return res.status(200).json({ok:!databaseError,enabled:integrationEnabled(),revisoes_ia:reviews,chatwoot:installation(),conta:account(),mapeamentos:mappings,webhooks_agente:own.length,webhooks_total:list.length,subscriptions:own.map(h=>h.subscriptions),banco_conectado:!databaseError,banco_erro:databaseError,conversa_recebida:!!counts.length,conversas_recentes:rows(recent).slice(0,3).map(c=>({id:c.id,status:c.status}))});
  } catch(e) {console.error('integracao-admin',{tipo:e.name,phase,status:e.status});return res.status(503).json({error:'Integração indisponível',phase,type:e.name,status:e.status,code:/^(integration_|chatwoot_agents_)/.test(e.message)?e.message:'upstream_error'});}
}
