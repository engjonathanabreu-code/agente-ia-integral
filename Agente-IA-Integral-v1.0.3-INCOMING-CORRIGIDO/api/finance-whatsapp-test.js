import {sendDuePaymentWhatsApp} from '../lib/finance-whatsapp.js';

const ONE_TIME_TOKEN='test-20260824-9h-47-996757213';

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'method_not_allowed'});
  if(String(req.query?.token||'')!==ONE_TIME_TOKEN)return res.status(401).json({ok:false,error:'unauthorized'});
  try{
    const phone=process.env.FINANCE_WHATSAPP_DESTINATION||'5547996757213';
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const data=await sendDuePaymentWhatsApp({
      phone,
      accountName:'TESTE COMPLETO - Integral Financeiro',
      value:123.45,
      paymentCode:'TESTE-NAO-PAGAR-001',
      dueDate:today
    });
    return res.status(200).json({ok:true,sent:true,providerResponse:data});
  }catch(e){
    console.error('finance-whatsapp-test',e);
    return res.status(500).json({ok:false,error:e.message||String(e)});
  }
}
