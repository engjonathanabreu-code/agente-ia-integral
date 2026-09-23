create or replace function public.integracao_ia_controle(operacao text,dados jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 k text:=dados->>'chave'; s public.integracao_ia_sessoes;
 e public.integracao_ia_eventos; t uuid; b jsonb; ids text[];
begin
 if k is null or length(k)>400 then raise exception 'invalid_key';end if;
 if operacao='enqueue' then
  insert into public.integracao_ia_sessoes(chave) values(k) on conflict do nothing;
 end if;
 select * into s from public.integracao_ia_sessoes where chave=k for update;
 if not found then raise exception 'session_missing';end if;
 if operacao='enqueue' then
  insert into public.integracao_ia_eventos(chave,event_key,payload,occurred_at)
   values(k,dados->>'event_key',dados->'payload',(dados->>'at')::bigint) on conflict do nothing;
  if coalesce((dados->>'human')::boolean,false) then
   update public.integracao_ia_sessoes set human_at=greatest(human_at,(dados->>'at')::bigint) where chave=k;
  end if;
  return jsonb_build_object('done',(select status in ('done','review') from public.integracao_ia_eventos where chave=k and event_key=dados->>'event_key'));
 elsif operacao='status' then
  return (select jsonb_build_object('status',status) from public.integracao_ia_eventos where chave=k and event_key=dados->>'event_key');
 elsif operacao='claim' then
  if s.lease_until>clock_timestamp() then return '{}'::jsonb;end if;
  -- After a crash with external effects, do not replay blindly. Retain for review.
  update public.integracao_ia_eventos set status=case when effects then 'review' else 'pending' end,erro='expired_worker' where chave=k and status='processing';
  select * into e from public.integracao_ia_eventos where chave=k and status='pending' order by occurred_at,case when payload->>'event'='message_created' then (payload->>'id')::bigint else 0 end,received_at limit 1;
  if not found then return '{}'::jsonb;end if;
  t:=gen_random_uuid();ids:=array[e.event_key];b:=e.payload;
  -- Only combine adjacent public incoming text, never audio/documents or events.
  if b->>'event'='message_created' and b->>'message_type' in ('incoming','0') and coalesce(b->>'private','false')='false' and coalesce(b->>'content','')<>'' and jsonb_array_length(coalesce(nullif(b->'attachments','null'::jsonb),'[]'::jsonb))=0 then
   select array_agg(event_key order by occurred_at,(payload->>'id')::bigint),
    jsonb_set(e.payload,'{content}',to_jsonb(string_agg(payload->>'content',E'\n' order by occurred_at,(payload->>'id')::bigint)))
   into ids,b from public.integracao_ia_eventos q where chave=k and status='pending'
    and occurred_at between e.occurred_at and e.occurred_at+3000
    and payload->>'event'='message_created' and payload->>'message_type' in ('incoming','0')
    and coalesce(payload->>'private','false')='false' and coalesce(payload->>'content','')<>'' and jsonb_array_length(coalesce(nullif(payload->'attachments','null'::jsonb),'[]'::jsonb))=0
    and not exists(select 1 from public.integracao_ia_eventos z where z.chave=k and z.status='pending' and z.occurred_at between e.occurred_at and q.occurred_at and (z.payload->>'event'<>'message_created' or z.payload->>'message_type' not in ('incoming','0')));
  end if;
  ids:=coalesce(ids,array[e.event_key]);b:=coalesce(b,e.payload);
  update public.integracao_ia_eventos set status='processing',token=t where chave=k and event_key=any(ids);
  update public.integracao_ia_sessoes set token=t,lease_until=clock_timestamp()+interval '120 seconds' where chave=k;
  return jsonb_build_object('token',t,'event_key',e.event_key,'payload',b,
   'originals',(select jsonb_agg(payload order by occurred_at) from public.integracao_ia_eventos where chave=k and token=t));
 end if;
 if s.token is null or dados->>'token' is null or s.lease_until is null or s.token is distinct from (dados->>'token')::uuid or s.lease_until<=clock_timestamp() then
  if operacao='guard' then return jsonb_build_object('valid',false);end if;
  raise exception 'conversation_lease_lost';
 end if;
 if operacao='guard' then
  return jsonb_build_object('valid',true,'human',s.human_at>s.resolved_at);
 elsif operacao='effect' then
  update public.integracao_ia_eventos set effects=true where chave=k and token=s.token;
 elsif operacao='resolved' then
  update public.integracao_ia_sessoes set resolved_at=greatest(resolved_at,(dados->>'at')::bigint) where chave=k;
 elsif operacao='finish' then
  update public.integracao_ia_eventos set status=case when dados->>'status'='pending' and effects then 'review' else dados->>'status' end,erro=left(dados->>'error',200) where chave=k and token=s.token;
  update public.integracao_ia_sessoes set token=null,lease_until=null where chave=k;
 else raise exception 'invalid_operation';end if;
 return '{}'::jsonb;
end $$;
