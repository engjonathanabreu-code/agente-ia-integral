const base=()=>{const value=process.env.CHATWOOT_BASE_URL;if(!value)throw new Error("CHATWOOT_BASE_URL não configurada.");return value.replace(/\/+$/,"")};
const accountId=()=>{const value=process.env.CHATWOOT_ACCOUNT_ID;if(!value)throw new Error("CHATWOOT_ACCOUNT_ID não configurada.");return value};
const token=()=>{const value=process.env.CHATWOOT_API_TOKEN;if(!value)throw new Error("CHATWOOT_API_TOKEN não configurado.");return value};

async function cwFetch(path,options={}){
  const response=await fetch(`${base()}${path}`,{...options,headers:{"Content-Type":"application/json",api_access_token:token(),...(options.headers||{})}});
  const text=await response.text();let data=null;
  try{data=text?JSON.parse(text):null}catch{data=text}
  if(!response.ok){const error=new Error(`Chatwoot ${response.status}: ${typeof data==="string"?data:JSON.stringify(data)}`);error.status=response.status;error.data=data;throw error}
  return data;
}

export async function getConversation(conversationId){return cwFetch(`/api/v1/accounts/${accountId()}/conversations/${conversationId}`)}
export async function getConversationMessages(conversationId){return cwFetch(`/api/v1/accounts/${accountId()}/conversations/${conversationId}/messages`)}
export async function listConversations({status="open",page=1}={}){const params=new URLSearchParams({status,page:String(page)});return cwFetch(`/api/v1/accounts/${accountId()}/conversations?${params.toString()}`)}

function customerFacingMessage(content){
  const text=String(content||"");
  if(text.includes("ainda não está vinculado a um Projeto/Núcleo")||text.includes("precisa verificar essa vinculação para consultar o andamento correto")){
    const name=text.split(",")[0]?.trim();
    return `${name||"Olá"}, não encontrei um registro de andamento do seu processo disponível para consulta automática neste momento. Vou repassar seu atendimento para a equipe de Atendimento, que vai verificar a situação e continuar com você por aqui.`;
  }
  if(text.includes("localizei seu cadastro e o Projeto/Núcleo relacionado, mas não há uma atualização liberada")){
    const name=text.split(",")[0]?.trim();
    return `${name||"Olá"}, não encontrei um registro de andamento do seu processo disponível para consulta automática neste momento. Vou repassar seu atendimento para a equipe de Atendimento, que vai verificar a situação e continuar com você por aqui.`;
  }
  return text;
}

export async function sendMessage(conversationId,content){
  return cwFetch(`/api/v1/accounts/${accountId()}/conversations/${conversationId}/messages`,{method:"POST",body:JSON.stringify({content:customerFacingMessage(content),message_type:"outgoing",private:false,content_type:"text",content_attributes:{integral_ai:true}})});
}

export async function updateConversationAttributes(conversationId,attributes){return cwFetch(`/api/v1/accounts/${accountId()}/conversations/${conversationId}/custom_attributes`,{method:"POST",body:JSON.stringify({custom_attributes:attributes})})}
export async function listTeams(){return cwFetch(`/api/v1/accounts/${accountId()}/teams`)}
export async function createTeam(name,description){return cwFetch(`/api/v1/accounts/${accountId()}/teams`,{method:"POST",body:JSON.stringify({name,description,allow_auto_assign:true})})}
export async function assignConversationToTeam(conversationId,teamId){return cwFetch(`/api/v1/accounts/${accountId()}/conversations/${conversationId}/assignments`,{method:"POST",body:JSON.stringify({team_id:Number(teamId)})})}
export async function assignConversationToAgent(conversationId,assigneeId){return cwFetch(`/api/v1/accounts/${accountId()}/conversations/${conversationId}/assignments`,{method:"POST",body:JSON.stringify({assignee_id:Number(assigneeId)})})}
export async function listCustomAttributeDefinitions(){return cwFetch(`/api/v1/accounts/${accountId()}/custom_attribute_definitions`)}
export async function createConversationAttribute(definition){return cwFetch(`/api/v1/accounts/${accountId()}/custom_attribute_definitions`,{method:"POST",body:JSON.stringify({attribute_display_name:definition.name,attribute_display_type:definition.type??0,attribute_description:definition.description||"",attribute_key:definition.key,attribute_values:definition.values||[],attribute_model:0})})}
export async function listWebhooks(){return cwFetch(`/api/v1/accounts/${accountId()}/webhooks`)}
export async function createWebhook(url){return cwFetch(`/api/v1/accounts/${accountId()}/webhooks`,{method:"POST",body:JSON.stringify({name:"Agente IA Integral",url,subscriptions:["message_created","conversation_status_changed","conversation_updated","conversation_created"]})})}
export async function updateWebhook(webhookId,url){return cwFetch(`/api/v1/accounts/${accountId()}/webhooks/${webhookId}`,{method:"PATCH",body:JSON.stringify({name:"Agente IA Integral",url,subscriptions:["message_created","conversation_status_changed","conversation_updated","conversation_created"]})})}
