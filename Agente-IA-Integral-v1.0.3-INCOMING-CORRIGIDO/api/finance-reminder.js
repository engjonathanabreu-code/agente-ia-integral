import crypto from 'node:crypto';

const AUTH_HASH = 'e02432e34b4e89bb334a97f438bd19b09fb59c175a0ed78c804ca22e0e404061';

function base(){
  const v=process.env.CHATWOOT_BASE_URL;
  if(!v) throw new Error('CHATWOOT_BASE_URL não configurada.');
  return v.replace(/\/+$/,'');
}
function accountId(){
  const v=process.env.CHATWOOT_ACCOUNT_ID;
  if(!v) throw new Error('CHATWOOT_ACCOUNT_ID não configurada.');
  return v;
}
function apiToken(){
  const v=process.env.CHATWOOT_API_TOKEN;
  if(!v) throw new Error('CHATWOOT_API_TOKEN não configurado.');
  return v;
}
function authorized(req){
  const raw=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!raw) return false;
  const digest=crypto.createHash('sha256').update(raw).digest('hex');
  try{return crypto.timingSafeEqual(Buffer.from(digest),Buffer.from(AUTH_HASH));}catch{return false;}
}
async function cw(path, options={}){
  const response=await fetch(`${base()}${path}`,{
    ...options,
    headers:{'Content-Type':'application/json',api_access_token:apiToken(),...(options.headers||{})}
  });
  const text=await response.text();
  let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!response.ok){const e=new Error(`Chatwoot ${response.status}: ${typeof data==='string'?data:JSON.stringify(data)}`);e.status=response.status;e.data=data;throw e;}
  return data;
}
const arr=v=>Array.isArray(v)?v:Array.isArray(v?.payload)?v.payload:Array.isArray(v?.data)?v.data:[];
const digits=v=>String(v||'').replace(/\D/g,'');
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const brDate=v=>{if(!v)return'—';const [y,m,d]=String(v).slice(0,10).split('-');return y&&m&&d?`${d}/${m}/${y}`:String(v)};

async function whatsappInbox(){
  const data=await cw(`/api/v1/accounts/${accountId()}/inboxes`);
  const inboxes=arr(data);
  return inboxes.find(x=>/whatsapp/i.test(String(x.channel_type||x.channel?.type||'')))||inboxes.find(x=>/whatsapp/i.test(String(x.name||'')))||null;
}
async function templates(inboxId){
  if(!inboxId)return[];
  try{return arr(await cw(`/api/v1/accounts/${accountId()}/inboxes/${inboxId}/message_templates`));}catch{return[];}
}
function approvedTemplate(list){
  const ok=list.filter(t=>!/reject|disable|pause|pend/i.test(String(t.status||'')));
  const named=ok.find(t=>/finance|venc|pagamento|conta|lembrete/i.test(String(t.name||t.template_name||'')));
  return named||null;
}
async function contactByPhone(phone){
  const n=digits(phone);if(!n)return null;
  const tries=[`+${n}`,n,n.startsWith('55')?n.slice(2):n];
  for(const q of tries){
    try{
      const data=await cw(`/api/v1/accounts/${accountId()}/contacts/search?q=${encodeURIComponent(q)}`);
      const found=arr(data).find(c=>digits(c.phone_number)===n||digits(c.phone_number).endsWith(n.slice(-11)));
      if(found)return found;
    }catch{}
  }
  return null;
}
async function latestWhatsappConversation(contactId,inboxId){
  const data=await cw(`/api/v1/accounts/${accountId()}/contacts/${contactId}/conversations`);
  const list=arr(data).filter(c=>!inboxId||String(c.inbox_id||c.inbox?.id)===String(inboxId));
  return list.sort((a,b)=>Number(b.last_activity_at||b.updated_at||b.id||0)-Number(a.last_activity_at||a.updated_at||a.id||0))[0]||null;
}
function messageText(p){
  const lines=[
    '🔔 *Conta com vencimento hoje*',
    '',
    `*Conta:* ${p.accountName||'Conta cadastrada'}`,
    p.supplier?`*Fornecedor:* ${p.supplier}`:null,
    `*Valor:* ${money(p.value)}`,
    `*Vencimento:* ${brDate(p.due)}`,
    `*Forma de pagamento:* ${p.method||'Não informada'}`,
    p.barcode?`*Código de pagamento:* ${p.barcode}`:null,
    p.notes?`*Observação:* ${p.notes}`:null,
    '',
    'Integral Financeiro • lembrete automático'
  ];
  return lines.filter(Boolean).join('\n');
}
function templatePayload(template,p,content){
  const name=template?.name||template?.template_name;
  const language=template?.language||template?.language_code||'pt_BR';
  const category=template?.category||'UTILITY';
  return {
    content,
    message_type:'outgoing',private:false,content_type:'text',
    template_params:{
      name,category,language,
      processed_params:{body:{
        '1':p.accountName||'Conta cadastrada',
        '2':money(p.value),
        '3':brDate(p.due),
        '4':p.method||'Não informada',
        '5':p.barcode||'Não informado'
      }}
    },
    content_attributes:{integral_ai:true,integral_finance_reminder:true}
  };
}
async function sendConversationMessage(conversationId,body){
  return cw(`/api/v1/accounts/${accountId()}/conversations/${conversationId}/messages`,{method:'POST',body:JSON.stringify(body)});
}

export default async function handler(req,res){
  if(!authorized(req))return res.status(401).json({ok:false,error:'unauthorized'});
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'method_not_allowed'});
  try{
    const inbox=await whatsappInbox();
    if(!inbox)throw new Error('Nenhuma caixa WhatsApp encontrada no Chatwoot.');
    const list=await templates(inbox.id);
    const candidate=approvedTemplate(list);
    const body=req.body||{};
    if(body.mode==='status'){
      return res.status(200).json({ok:true,inbox:{id:inbox.id,name:inbox.name,channel_type:inbox.channel_type},templates:list.map(t=>({name:t.name||t.template_name,status:t.status,category:t.category,language:t.language||t.language_code})),preferredTemplate:candidate?{name:candidate.name||candidate.template_name,status:candidate.status,category:candidate.category,language:candidate.language||candidate.language_code}:null});
    }
    const phone=digits(body.phone);
    if(!phone)throw new Error('Telefone de destino não informado.');
    const contact=await contactByPhone(phone);
    if(!contact)throw new Error('Contato do WhatsApp não encontrado no Chatwoot. Envie uma mensagem para o WhatsApp da Integral uma vez para criar o contato.');
    const conversation=await latestWhatsappConversation(contact.id,inbox.id);
    if(!conversation)throw new Error('Conversa WhatsApp não encontrada para este contato.');
    const p=body.payment||{};
    const content=messageText(p);
    let sent=null,mode='text',textError=null;
    try{
      sent=await sendConversationMessage(conversation.id,{content,message_type:'outgoing',private:false,content_type:'text',content_attributes:{integral_ai:true,integral_finance_reminder:true}});
    }catch(e){textError=e.message;}
    if(!sent&&candidate){
      sent=await sendConversationMessage(conversation.id,templatePayload(candidate,p,content));
      mode='template';
    }
    if(!sent)throw new Error(`Não foi possível enviar. Mensagem comum: ${textError||'falhou'}${candidate?'':' • não há template financeiro aprovado disponível.'}`);
    return res.status(200).json({ok:true,mode,conversationId:conversation.id,contactId:contact.id,template:mode==='template'?(candidate.name||candidate.template_name):null,messageId:sent?.id||null});
  }catch(e){console.error('finance-reminder',e);return res.status(500).json({ok:false,error:e.message||String(e)});}
}
