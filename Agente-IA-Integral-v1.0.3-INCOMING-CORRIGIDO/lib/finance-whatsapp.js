const base=()=>{const v=process.env.CHATWOOT_BASE_URL;if(!v)throw new Error('CHATWOOT_BASE_URL não configurada.');return v.replace(/\/+$/,'')};
const accountId=()=>{const v=process.env.CHATWOOT_ACCOUNT_ID;if(!v)throw new Error('CHATWOOT_ACCOUNT_ID não configurada.');return v};
const token=()=>{const v=process.env.CHATWOOT_API_TOKEN;if(!v)throw new Error('CHATWOOT_API_TOKEN não configurado.');return v};

async function cw(path,options={}){
  const r=await fetch(`${base()}${path}`,{...options,headers:{'Content-Type':'application/json',api_access_token:token(),...(options.headers||{})}});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw new Error(`Chatwoot ${r.status}: ${typeof data==='string'?data:JSON.stringify(data)}`);
  return data;
}

function normalizePhone(v){const d=String(v||'').replace(/\D/g,'');return d.startsWith('55')?`+${d}`:`+55${d}`}

async function findContact(phone){
  const normalized=normalizePhone(phone);
  const variants=[normalized,normalized.replace('+','')];
  for(const value of variants){
    try{
      const d=await cw(`/api/v1/accounts/${accountId()}/contacts/filter`,{method:'POST',body:JSON.stringify({payload:[{attribute_key:'phone_number',filter_operator:'equal_to',values:[value],query_operator:null}]})});
      const list=d?.payload||[];if(list.length)return list[0];
    }catch(e){console.warn('Busca de contato Chatwoot:',e.message)}
  }
  return null;
}

async function findWhatsAppInbox(){
  const d=await cw(`/api/v1/accounts/${accountId()}/inboxes`);
  const list=Array.isArray(d?.payload)?d.payload:Array.isArray(d)?d:[];
  return list.find(i=>/whatsapp/i.test(String(i?.channel_type||'')))||list.find(i=>/whatsapp/i.test(String(i?.name||'')))||null;
}

async function createContact(phone){
  const inbox=await findWhatsAppInbox();
  if(!inbox?.id)throw new Error('Inbox WhatsApp não encontrado no Chatwoot.');
  const normalized=normalizePhone(phone);
  const d=await cw(`/api/v1/accounts/${accountId()}/contacts`,{method:'POST',body:JSON.stringify({inbox_id:inbox.id,name:'Jonathan - Financeiro Integral',phone_number:normalized})});
  return d?.payload?.contact||d?.payload||d;
}

async function ensureConversation(phone){
  let contact=await findContact(phone);
  if(!contact)contact=await createContact(phone);
  if(!contact?.id)throw new Error(`Não foi possível localizar/criar o contato ${normalizePhone(phone)} no Chatwoot.`);
  const d=await cw(`/api/v1/accounts/${accountId()}/contacts/${contact.id}/conversations`);
  const list=d?.payload||[];
  if(list.length){return [...list].sort((a,b)=>(b.id||0)-(a.id||0))[0].id;}
  let ci=(contact.contact_inboxes||[])[0];
  if(!ci?.source_id||!ci?.inbox?.id){
    const refreshed=await findContact(phone);
    ci=(refreshed?.contact_inboxes||[])[0];
    contact=refreshed||contact;
  }
  if(!ci?.source_id||!ci?.inbox?.id)throw new Error('Contato criado, mas sem inbox WhatsApp associado.');
  const created=await cw(`/api/v1/accounts/${accountId()}/conversations`,{method:'POST',body:JSON.stringify({source_id:ci.source_id,inbox_id:ci.inbox.id,contact_id:contact.id,status:'open'})});
  return created?.id||created?.data?.id;
}

export async function sendDuePaymentWhatsApp({phone,accountName,value,paymentCode,dueDate}){
  const conversationId=await ensureConversation(phone);
  if(!conversationId)throw new Error('Não foi possível localizar/criar conversa do WhatsApp.');
  const templateName=process.env.FINANCE_WHATSAPP_TEMPLATE_NAME||'integral_conta_vencimento';
  const language=process.env.FINANCE_WHATSAPP_TEMPLATE_LANGUAGE||'pt_BR';
  const amount=Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const content=`Conta vencendo hoje: ${accountName} • ${amount}. Código de pagamento: ${paymentCode}`;
  return cw(`/api/v1/accounts/${accountId()}/conversations/${conversationId}/messages`,{
    method:'POST',
    body:JSON.stringify({
      content,
      message_type:'outgoing',
      private:false,
      content_type:'text',
      template_params:{
        name:templateName,
        category:'UTILITY',
        language,
        processed_params:{body:{'1':accountName,'2':amount,'3':String(paymentCode),'4':String(dueDate||'')}}
      },
      content_attributes:{integral_ai:true,finance_due_reminder:true}
    })
  });
}
