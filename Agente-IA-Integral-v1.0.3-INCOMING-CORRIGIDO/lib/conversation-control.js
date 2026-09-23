import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {integrationDB, installation, account} from './integracao.js';
export const execution = new AsyncLocalStorage();
export const incoming = p => ['incoming',0,'0'].includes(p?.message_type);
export const humanMessage = p => ['outgoing',1,'1','template',3,'3'].includes(p?.message_type)
  && p?.content_attributes?.integral_ai !== true && !['agent_bot','AgentBot'].includes(p?.sender?.type);
export function timestamp(value) {
  const n=typeof value==='number'?value*1000:Date.parse(value);
  return Number.isFinite(n)?Math.round(n):0;
}
export function humanSince(messages, since=0) {
  return messages.some(m=>humanMessage(m) && (timestamp(m.created_at)>since || !m.created_at));
}
export function eventKey(p) {
  if(p.event==='message_created') return `message:${p.id}`;
  return createHash('sha256').update(JSON.stringify(p)).digest('hex');
}
export async function control(op, input={}, context=execution.getStore()) {
  if(!context) throw new Error('conversation_context_missing');
  return integrationDB('rpc/integracao_ia_controle', {operacao:op, dados:{...input,chave:context.key,token:context.token||null}});
}
export async function assertActive() {
  const c=execution.getStore();
  if(!c) return;
  const state=await control('guard');
  if(!state.valid) throw new Error('conversation_lease_lost');
  if(c.customerTurn && state.human) throw new Error('human_takeover');
}
export function conversationKey(id) {return `${installation()}/${account()}/${id}`;}
export async function markEffect() {
  const c=execution.getStore();
  if(c) {await assertActive();await control('effect');c.effects=true;}
}
export function actionKey(content) {
  const c=execution.getStore();
  if(!c) return null;
  return createHash('sha256').update(`${c.key}/${c.eventKey}/${content}`).digest('hex');
}
