-- Internal worker storage: no browser/client privileges and no SECURITY DEFINER.
create table public.integracao_ia_sessoes (
 chave text primary key, token uuid, lease_until timestamptz,
 human_at bigint not null default 0, resolved_at bigint not null default 0
);
create table public.integracao_ia_eventos (
 chave text not null references public.integracao_ia_sessoes(chave), event_key text not null,
 payload jsonb not null, occurred_at bigint not null, received_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','processing','done','review')),
 token uuid, effects boolean not null default false, erro text,
 primary key(chave,event_key)
);
create index integracao_ia_eventos_fila on public.integracao_ia_eventos(chave,status,occurred_at);
alter table public.integracao_ia_sessoes enable row level security;
alter table public.integracao_ia_eventos enable row level security;
revoke all on public.integracao_ia_sessoes,public.integracao_ia_eventos from public,anon,authenticated;
grant all on public.integracao_ia_sessoes,public.integracao_ia_eventos to service_role;
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
 if s.token is distinct from (dados->>'token')::uuid or s.lease_until<=clock_timestamp() then
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
revoke all on function public.integracao_ia_controle(text,jsonb) from public,anon,authenticated;
grant execute on function public.integracao_ia_controle(text,jsonb) to service_role;

-- Enable only the eight audited nuclei; do not invent a progress entry or expose
-- drafts. Existing explicit disabled configurations are preserved.
insert into public.integracao_nucleo_ia(id,instrucao,habilitado)
select id,'',true from public.processos_kanban where id in (
 '02fe539e-0ea8-5026-98e5-5348ba1d7275','13ccf896-09ba-5089-acba-58a37c918169',
 '1c66b363-4072-5d66-913c-9a833f297021','32659905-6376-5ee1-ad63-fb6bc13c6d84',
 '60797327-57a8-5c07-a346-6908275331ec','b5624146-54e4-5e22-b2d1-da96c70df6c2',
 'c8e8962a-4c31-556e-ba63-2ddd9c9abb15','fc8d0052-40d3-5584-abb7-b8168bb9bc16')
on conflict(id) do nothing;
