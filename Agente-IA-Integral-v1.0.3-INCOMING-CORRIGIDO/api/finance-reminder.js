import crypto from 'node:crypto';

const AUTH_HASH='e02432e34b4e89bb334a97f438bd19b09fb59c175a0ed78c804ca22e0e404061';
const DEFAULT_TEMPLATE='financeiro_avisos_internos';
const TZ='America/Sao_Paulo';
const base=()=>{const v=process.env.CHATWOOT_BASE_URL;if(!v)throw new Error('CHATWOOT_BASE_URL não configurada.');return v.replace(/\/+$/,'')};
const accountId=()=>{const v=process.env.CHATWOOT_ACCOUNT_ID;if(!v)throw new Error('CHATWOOT_ACCOUNT_ID não configurada.');return v};
const token=()=>{const v=process.env.CHATWOOT_API_TOKEN;if(!v)throw new Error('CHATWOOT_API_TOKEN não configurado.');return v};
const arr=v=>Array.isArray(v)?v:Array.isArray(v?.payload)?v.payload:Array.isArray(v?.data)?v.data:[];
const digits=v=>String(v||'').replace(/\D/g,'');
const amount=v=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const brDate=v=>{const[y,m,d]=String(v||'').slice(0,10).split('-');return y&&m&&d?`${d}/${m}/${y}`:String(v||'—')};
function auth(req){const raw=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();if(!raw)return false;const digest=crypto.createHash('sha256').update(raw).digest('hex');try{return crypto.timingSafeEqual(Buffer.from(digest),Buffer.from(AUTH_HASH));}catch{return false}}
async function cw(path,options={}){const r=await fetch(`${base()}${path}`,{...options,headers:{'Content-Type':'application/json',api_access_token:token(),...(options.headers||{})}});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok){const e=new Error(`Chatwoot ${r.status}: ${typeof data==='string'?data:JSON.stringify(data)}`);e.status=r.status;throw e}return data}
async function inbox(){const d=await cw(`/api/v1/accounts/${accountId()}/inboxes`);return arr(d).find(i=>/whatsapp/i.test(String(i?.channel_type||'')))||arr(d).find(i=>/whatsapp/i.test(String(i?.name||'')))||null}
async function templates(inboxId){try{return arr(await cw(`/api/v1/accounts/${accountId()}/inboxes/${inboxId}/message_templates`))}catch{return[]}}
async function findContact(phone){const n=digits(phone),vars=[`+${n}`,n,n.startsWith('55')?n.slice(2):n];for(const q of vars){try{const d=await cw(`/api/v1/accounts/${accountId()}/contacts/search?q=${encodeURIComponent(q)}`);const c=arr(d).find(x=>digits(x.phone_number)===n||digits(x.phone_number).endsWith(n.slice(-11)));if(c)return c}catch{}}return null}
async function conversation(contactId,inboxId){const d=await cw(`/api/v1/accounts/${accountId()}/contacts/${contactId}/conversations`);return arr(d).filter(c=>String(c.inbox_id||c.inbox?.id)===String(inboxId)).sort((a,b)=>Number(b.id||0)-Number(a.id||0))[0]||null}
function approved(list,name){return list.find(t=>String(t.name||t.template_name||'').toLowerCase()===String(name||'').toLowerCase()&&/approved/i.test(String(t.status||'')))}
function templateBody(t,p,contact){
 const name=t.name||t.template_name||DEFAULT_TEMPLATE,language=t.language||t.language_code||'pt_BR',category=t.category||'UTILITY';
 const clientName=String(p.clientName||contact?.name||'Cliente').trim().split(/\s+/)[0]||'Cliente';
 const description=String(p.accountName||p.description||'Pagamento').trim();
 const due=brDate(p.due);
 const value=amount(p.value);
 const paymentMethod=String(p.paymentMethod||p.formaPagamento||p.payment_method||'Conforme dados cadastrados').trim();
 const paymentData=String(p.paymentData||p.dadosEfetivos||p.payment_data||p.pix||p.barcode||'Consulte o Financeiro Integral').trim();
 const body={'1':clientName,'2':description,'3':due,'4':value,'5':paymentMethod,'6':paymentData};
 const content=`Olá, ${clientName}. Informamos que há um pagamento referente a ${description} com vencimento em ${due}. Valor: R$ ${value}. Forma de pagamento: ${paymentMethod}. Dados para pagamento: ${paymentData}.`;
 return{content,message_type:'outgoing',private:false,content_type:'text',template_params:{name,category,language,processed_params:{body}},content_attributes:{integral_ai:true,finance_due_reminder:true,finance_template:DEFAULT_TEMPLATE}};
}
async function send(convId,body){return cw(`/api/v1/accounts/${accountId()}/conversations/${convId}/messages`,{method:'POST',body:JSON.stringify(body)})}

export default async function handler(req,res){
 if(!auth(req))return res.status(401).json({ok:false,error:'unauthorized'});
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'method_not_allowed'});
 try{
  const ib=await inbox();if(!ib)throw new Error('Inbox WhatsApp não encontrado.');
  const list=await templates(ib.id);const configured=process.env.FINANCE_WHATSAPP_TEMPLATE_NAME||DEFAULT_TEMPLATE;
  if(req.body?.mode==='status')return res.status(200).json({ok:true,inbox:{id:ib.id,name:ib.name},configuredTemplate:configured,templates:list.map(t=>({name:t.name||t.template_name,status:t.status,category:t.category,language:t.language||t.language_code,parameterFormat:t.parameter_format||null}))});
  const phone=digits(req.body?.phone);if(!phone)throw new Error('Telefone não informado.');
  const c=await findContact(phone);if(!c)throw new Error('Contato não encontrado no Chatwoot.');
  const conv=await conversation(c.id,ib.id);if(!conv)throw new Error('Conversa WhatsApp não encontrada para o contato.');
  const p=req.body?.payment||{};const preferred=approved(list,configured)||approved(list,DEFAULT_TEMPLATE);
  if(!preferred)throw new Error(`Template aprovado ${configured} não encontrado no inbox WhatsApp.`);
  const sent=await send(conv.id,templateBody(preferred,p,c));
  res.status(200).json({ok:true,mode:'template',template:preferred.name||preferred.template_name,conversationId:conv.id,messageId:sent?.id||null});
 }catch(e){console.error('finance-reminder',e);res.status(500).json({ok:false,error:e.message||String(e)})}
}
