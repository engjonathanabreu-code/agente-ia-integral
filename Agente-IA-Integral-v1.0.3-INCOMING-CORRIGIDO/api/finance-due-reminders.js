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
function authorized(req){
  const expected=process.env.FINANCE_CRON_TOKEN||process.env.NUDGE_CRON_TOKEN||process.env.CRON_SECRET||'';
  if(!expected)return false;
  const queryToken=String(req.query?.token||'');
  const auth=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  return queryToken===expected||auth===expected;
}
function stateMap(rows){return new Map((rows||[]).map(r=>[String(r.chave),r.dados]));}

export default async function handler(req,res){
  try{
    if(!authorized(req))return res.status(401).json({ok:false,error:'unauthorized'});
    const due=localDate(),phone=DESTINATION();

    // Fonte oficial do Financeiro: mesma persistência que a interface utiliza.
    const state=await sb('financeiro_estado_modulos?chave=in.(accountPayments,accountMasters)&select=chave,dados');
    const map=stateMap(state);
    const payments=Array.isArray(map.get('accountPayments'))?map.get('accountPayments'):[];
    const accounts=Array.isArray(map.get('accountMasters'))?map.get('accountMasters'):[];
    const byId=new Map(accounts.map(a=>[String(a.id),a]));

    const todayPayments=payments.filter(p=>
      String(p?.due||'').slice(0,10)===due &&
      !/paga|pago|cancelad/i.test(String(p?.status||''))
    );

    if(!todayPayments.length)return res.status(200).json({ok:true,date:due,due:0,sent:0,source:'financeiro_estado_modulos'});

    const results=[];
    for(const p of todayPayments){
      const paymentId=String(p.id??`${p.accountId}-${p.due}-${p.value}`);
      if(await alreadySent(paymentId,phone)){results.push({id:paymentId,status:'already_sent'});continue;}
      const a=byId.get(String(p.accountId))||{};
      const accountName=a.name||a.supplier||'Conta cadastrada';
      const method=a.method||p.method||'Não informada';
      const code=String(p.barcode||p.paymentCode||'').trim();
      const paymentInstruction=code?`${method} • ${code}`:method;
      try{
        const sent=await sendDuePaymentWhatsApp({
          phone,
          accountName,
          value:Number(p.value||0),
          paymentCode:paymentInstruction,
          dueDate:p.due,
          supplier:a.supplier||'',
          method,
          notes:p.notes||''
        });
        await logSend({paymentId,phone,due:p.due,status:'enviado'});
        results.push({id:paymentId,status:'sent',messageId:sent?.id||null,accountName});
      }catch(e){
        await logSend({paymentId,phone,due:p.due,status:'erro',error:String(e.message||e).slice(0,800)}).catch(()=>{});
        results.push({id:paymentId,status:'error',error:e.message||String(e),accountName});
      }
    }
    return res.status(200).json({ok:true,date:due,due:todayPayments.length,sent:results.filter(x=>x.status==='sent').length,source:'financeiro_estado_modulos',results});
  }catch(e){
    console.error('finance-due-reminders',e);
    return res.status(500).json({ok:false,error:e.message||String(e)});
  }
}
