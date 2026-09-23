import {assignConversationToTeam,getConversation} from './chatwoot.js';
export async function verifiedTeamAssignment(conversationId,teamId) {
  if(!teamId) return false;
  try {
    await assignConversationToTeam(conversationId,teamId);
    const live=await getConversation(conversationId);
    return Number(live?.meta?.team?.id||live?.team?.id||live?.team_id)===Number(teamId);
  } catch(e) {
    if(['human_takeover','conversation_lease_lost'].includes(e.message)) throw e;
    console.error('handoff_assignment_failed',{conversationId,status:e.status});
    return false;
  }
}
export const transferFailure='Não consegui concluir a transferência para a equipe agora. Seu pedido continua registrado nesta conversa. Você pode tentar novamente por aqui.';
