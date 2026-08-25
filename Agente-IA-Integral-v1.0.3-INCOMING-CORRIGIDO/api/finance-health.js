function localDate(offsetDays=0){
  const now=new Date();now.setUTCDate(now.getUTCDate()+offsetDays);
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const g=t=>parts.find(p=>p.type===t)?.value;return `${g('year')}-${g('month')}-${g('day')}`;
}
async function jsonFetch(url,headers={}){const r=await fetch(url,{headers});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}return{ok:r.ok,status:r.status,data};}
const arr=v=>Array.isArray(v)?v:Array.isArray(v?.payload)?v.payload:Array.isArray(v?.data)?v.data:[];

export default async function handler(req,res){
  const url=process.env.ERP_SUPABASE_URL||'https://ycdsyilyvaxslkwbkxyo.supabase.co';
  const key=process.env.ERP_SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  const chatBase=String(process.env.CHATWOOT_BASE_URL||'').replace(/\/+$/,'');
  const account=process.env.CHATWOOT_ACCOUNT_ID||'';
  const chatToken=process.env.CHATWOOT_API_TOKEN||'';
  const templateName=process.env.FINANCE_WHATSAPP_TEMPLATE_NAME||'integral_conta_vencimento';
  const destination=process.env.FINANCE_WHATSAPP_DESTINATION||'5547996757213';
  const out={
    ok:true,
    source:'financeiro_estado_modulos',
    supabaseServiceConfigured:!!key,
    chatwootConfigured:!!(chatBase&&account&&chatToken),
    cronTokenConfigured:!!(process.env.FINANCE_CRON_TOKEN||process.env.NUDGE_CRON_TOKEN||process.env.CRON_SECRET),
    whatsappTemplate:templateName,
    destinationConfigured:!!destination,
    destinationMasked:destination?`${String(destination).slice(0,4)}••••${String(destination).slice(-4)}`:null,
    canonicalStateAvailable:false,
    dueTomorrow:0,
    whatsappInbox:null,
    templateFound:false,
    templateStatus:null
  };
  if(key){
    try{
      const r=await jsonFetch(`${url}/rest/v1/financeiro_estado_modulos?chave=in.(accountPayments,accountMasters)&select=chave,dados`,{apikey:key,Authorization:`Bearer ${key}`});
      out.canonicalStateAvailable=r.ok;
      if(r.ok){const rows=arr(r.data);const pay=rows.find(x=>x.chave==='accountPayments')?.dados||[];const tomorrow=localDate(1);out.dueTomorrow=(Array.isArray(pay)?pay:[]).filter(p=>String(p?.due||'').slice(0,10)===tomorrow&&!/paga|pago|cancelad/i.test(String(p?.status||''))).length;}
      else out.stateStatus=r.status;
    }catch{out.canonicalStateAvailable=false;}
  }
  if(chatBase&&account&&chatToken){
    try{
      const ih=await jsonFetch(`${chatBase}/api/v1/accounts/${account}/inboxes`,{api_access_token:chatToken});
      const inbox=arr(ih.data).find(i=>/whatsapp/i.test(String(i?.channel_type||'')))||arr(ih.data).find(i=>/whatsapp/i.test(String(i?.name||'')));
      if(inbox?.id){
        out.whatsappInbox={id:inbox.id,name:inbox.name,channel_type:inbox.channel_type};
        const th=await jsonFetch(`${chatBase}/api/v1/accounts/${account}/inboxes/${inbox.id}/message_templates`,{api_access_token:chatToken});
        if(th.ok){const list=arr(th.data);const t=list.find(x=>String(x.name||x.template_name||'')===templateName);out.templateFound=!!t;if(t)out.templateStatus=t.status||null;}
      }
    }catch(e){out.chatwootDiagnosticError=String(e?.message||e).slice(0,300);}
  }
  res.status(200).json(out);
}
