export default async function handler(req,res){
  const url=process.env.ERP_SUPABASE_URL||'https://ycdsyilyvaxslkwbkxyo.supabase.co';
  const key=process.env.ERP_SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  const out={
    ok:true,
    supabaseServiceConfigured:!!key,
    chatwootConfigured:!!(process.env.CHATWOOT_BASE_URL&&process.env.CHATWOOT_ACCOUNT_ID&&process.env.CHATWOOT_API_TOKEN),
    cronTokenConfigured:!!(process.env.FINANCE_CRON_TOKEN||process.env.NUDGE_CRON_TOKEN||process.env.CRON_SECRET),
    whatsappTemplate:process.env.FINANCE_WHATSAPP_TEMPLATE_NAME||'integral_conta_vencimento',
    destinationConfigured:!!(process.env.FINANCE_WHATSAPP_DESTINATION||'5547996757213'),
    tablesAvailable:false
  };
  if(key){
    try{
      const r=await fetch(`${url}/rest/v1/financeiro_contas?select=id&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`}});
      out.tablesAvailable=r.ok;
      if(!r.ok)out.tableStatus=r.status;
    }catch{out.tablesAvailable=false;}
  }
  res.status(200).json(out);
}
