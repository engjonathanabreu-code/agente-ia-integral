import {sendDuePaymentWhatsApp} from '../lib/finance-whatsapp.js';

const SUPABASE_URL=process.env.ERP_SUPABASE_URL||'https://ycdsyilyvaxslkwbkxyo.supabase.co';
const SERVICE_KEY=()=>process.env.ERP_SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const DESTINATION=()=>process.env.FINANCE_WHATSAPP_DESTINATION||'5547996757213';

function localDate(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const g=t=>parts.find(p=>p.type===t)?.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
async function sb(path,options={}){
  const key=SERVICE_KEY();if(!key)throw new Error('ERP_SUPABASE_SERVICE_ROLE_KEY não configurada no agente.');
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...options,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'return=representation',...(options.headers||{})}});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw new Error(`Supabase ${r.status}: ${typeof data==='string'?data:JSON.stringify(data)}`);
  return data;
}
async function alreadySent(paymentId,phone){
  const q=`financeiro_whatsapp_envios?pagamento_id=eq.${encodeURIComponent(paymentId)}&destinatario=eq.${encodeURIComponent(phone)}&status=eq.enviado&select=id&limit=1`;
  const rows=await sb(q);return Array.isArray(rows)&&rows.length>0;
}
async function logSend({paymentId,phone,due,status,error=''}){
  return sb('financeiro_whatsapp_envios?on_conflict=pagamento_id,destinatario',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({pagamento_id:String(paymentId),destinatario:String(phone),vencimento:due,status,erro:error||null,enviado_em:new Date().toISOString()})});
}

export default async function handler(req,res){
  try{
    if(process.env.CRON_SECRET){
      const auth=req.headers.authorization||'';
      if(auth!==`Bearer ${process.env.CRON_SECRET}`)return res.status(401).json({ok:false,error:'unauthorized'});
    }
    const due=localDate(),phone=DESTINATION();
    const payments=await sb(`financeiro_pagamentos?vencimento=eq.${due}&status=neq.Paga&codigo_pagamento=not.is.null&codigo_pagamento=neq.&select=id,conta_id,vencimento,valor,status,forma_pagamento,codigo_pagamento`);
    if(!payments?.length)return res.status(200).json({ok:true,date:due,due:0,sent:0});
    const ids=[...new Set(payments.map(p=>p.conta_id).filter(Boolean))];
    let accounts=[];
    if(ids.length)accounts=await sb(`financeiro_contas?id=in.(${ids.map(x=>`"${String(x).replace(/"/g,'')}"`).join(',')})&select=id,nome,fornecedor`);
    const byId=new Map((accounts||[]).map(a=>[String(a.id),a]));
    const results=[];
    for(const p of payments){
      if(await alreadySent(p.id,phone)){results.push({id:p.id,status:'already_sent'});continue;}
      const a=byId.get(String(p.conta_id));
      const accountName=a?.nome||a?.fornecedor||'Conta';
      try{
        await sendDuePaymentWhatsApp({phone,accountName,value:p.valor,paymentCode:p.codigo_pagamento,dueDate:p.vencimento});
        await logSend({paymentId:p.id,phone,due:p.vencimento,status:'enviado'});
        results.push({id:p.id,status:'sent'});
      }catch(e){
        await logSend({paymentId:p.id,phone,due:p.vencimento,status:'erro',error:String(e.message||e).slice(0,800)}).catch(()=>{});
        results.push({id:p.id,status:'error',error:e.message||String(e)});
      }
    }
    return res.status(200).json({ok:true,date:due,due:payments.length,sent:results.filter(x=>x.status==='sent').length,results});
  }catch(e){
    console.error('finance-due-reminders',e);
    return res.status(500).json({ok:false,error:e.message||String(e)});
  }
}
