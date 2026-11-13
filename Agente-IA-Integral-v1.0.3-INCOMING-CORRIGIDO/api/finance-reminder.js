import crypto from 'node:crypto';

const DEFAULT_TEMPLATE='financeiro_avisos_internos';
const base=()=>{const v=process.env.CHATWOOT_BASE_URL;if(!v)throw new Error('CHATWOOT_BASE_URL não configurada.');return v.replace(/\/+$/,'')};
const accountId=()=>{const v=process.env.CHATWOOT_ACCOUNT_ID;if(!v)throw new Error('CHATWOOT_ACCOUNT_ID não configurada.');return v};
const token=()=>{const v=process.env.CHATWOOT_API_TOKEN;if(!v)throw new Error('CHATWOOT_API_TOKEN não configurado.');return v};
const arr=v=>Array.isArray(v)?v:Array.isArray(v?.payload)?v.payload:Array.isArray(v?.data)?v.data:[];
const digits=v=>String(v||'').replace(/\D/g,'');
const amount=v=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const brDate=v=>{const[y,m,d]=String(v||'').slice(0,10).split('-');return y&&m&&d?`${d}/${m}/${y}`:String(v||'—')};
function auth(req, secret) {
  const raw = /^Bearer ([^\s]+)$/i.exec(String(req.headers?.authorization || ''))?.[1];
  if (!raw || !secret) return false;
  const digest = (value) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(raw), digest(secret));
}
async function cw(path, options = {}) {
  const r = await fetch(`${base()}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', api_access_token: token(), ...options.headers },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  if (!r.ok) {
    await r.body?.cancel();
    throw new Error('chatwoot_sem_confirmacao');
  }
  return r.json();
}
async function inbox(){const d=await cw(`/api/v1/accounts/${accountId()}/inboxes`);return arr(d).find(i=>/whatsapp/i.test(String(i?.channel_type||'')))||arr(d).find(i=>/whatsapp/i.test(String(i?.name||'')))||null}
async function templates(inboxId){try{return arr(await cw(`/api/v1/accounts/${accountId()}/inboxes/${inboxId}/message_templates`))}catch{return[]}}
async function findContact(phone) {
  const variants = [...new Set([`+${phone}`, phone, phone.startsWith('55') ? phone.slice(2) : phone])];
  const matches = new Map();
  for (const variant of variants) {
    const results = await cw(`/api/v1/accounts/${accountId()}/contacts/search?q=${encodeURIComponent(variant)}`);
    for (const contact of arr(results)) {
      const number = digits(contact.phone_number);
      if (contact.id != null && variants.includes(number)) matches.set(String(contact.id), contact);
    }
  }
  return matches.size === 1 ? matches.values().next().value : null;
}
async function conversation(contactId,inboxId){const d=await cw(`/api/v1/accounts/${accountId()}/contacts/${contactId}/conversations`);return arr(d).filter(c=>String(c.inbox_id||c.inbox?.id)===String(inboxId)).sort((a,b)=>Number(b.id||0)-Number(a.id||0))[0]||null}
function approved(list,name){return list.find(t=>String(t.name||t.template_name||'').toLowerCase()===String(name||'').toLowerCase()&&/approved/i.test(String(t.status||'')))}
function templateBody(t,p,contact){
 const name=t.name||t.template_name||DEFAULT_TEMPLATE,language=t.language||t.language_code||'pt_BR',category=t.category||'UTILITY';
 const clientName=String(p.clientName||contact?.name||'Cliente').trim().split(/\s+/)[0]||'Cliente';
 const description=String(p.accountName||p.description||'Pagamento').trim();
 const due=brDate(p.due);
 const value=amount(p.value);
 const paymentMethod=String(p.paymentMethod||p.method||p.formaPagamento||p.payment_method||'Conforme dados cadastrados').trim();
 const paymentData=String(p.paymentData||p.dadosEfetivos||p.payment_data||p.pix||p.barcode||'Consulte o Financeiro Integral').trim();
 const body={'1':clientName,'2':description,'3':due,'4':value,'5':paymentMethod,'6':paymentData};
 const content=`Olá, ${clientName}. Informamos que há um pagamento referente a ${description} com vencimento em ${due}. Valor: R$ ${value}. Forma de pagamento: ${paymentMethod}. Dados para pagamento: ${paymentData}.`;
 return{content,message_type:'outgoing',private:false,content_type:'text',template_params:{name,category,language,processed_params:{body}},content_attributes:{integral_ai:true,finance_due_reminder:true,finance_template:DEFAULT_TEMPLATE}};
}
async function send(convId,body){return cw(`/api/v1/accounts/${accountId()}/conversations/${convId}/messages`,{method:'POST',body:JSON.stringify(body)})}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const secret = process.env.FINANCE_AGENT_TOKEN;
  if (!auth(req, secret)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const statusOnly = req.body?.mode === 'status';
  const phone = digits(req.body?.phone);
  const recipient = process.env.FINANCE_REMINDER_PHONE ?? '';
  const key = String(req.headers['idempotency-key'] ?? '');
  if (!statusOnly && (!/^\d{10,15}$/.test(recipient) || phone !== recipient || !/^[a-f0-9]{64}$/.test(key))) {
    return res.status(400).json({ ok: false, error: 'invalid_reminder' });
  }

  try {
    const ib = await inbox();
    if (!ib) throw new Error('whatsapp_inbox_indisponivel');
    const list = await templates(ib.id);
    const configured = process.env.FINANCE_WHATSAPP_TEMPLATE_NAME || DEFAULT_TEMPLATE;
    if (statusOnly) {
      return res.status(200).json({ ok: true, templateApproved: Boolean(approved(list, configured) || approved(list, DEFAULT_TEMPLATE)) });
    }

    const contact = await findContact(phone);
    if (!contact) throw new Error('destinatario_nao_confirmado');
    const conv = await conversation(contact.id, ib.id);
    if (!conv) throw new Error('conversa_whatsapp_indisponivel');
    const preferred = approved(list, configured) || approved(list, DEFAULT_TEMPLATE);
    if (!preferred) throw new Error('template_whatsapp_indisponivel');

    const body = templateBody(preferred, req.body?.payment || {}, contact);
    body.content_attributes.finance_reminder_key = key;
    const sent = await send(conv.id, body);
    if (sent?.id == null) throw new Error('chatwoot_sem_confirmacao');
    return res.status(200).json({ ok: true });
  } catch {
    console.warn('finance-reminder', 'lembrete_sem_confirmacao');
    return res.status(502).json({ ok: false, error: 'reminder_not_confirmed' });
  }
}
