-- Coleta documental aditiva, isolada por município e desligada até a conexão estar pronta.
create table public.integracao_documental_config (
 municipio_id uuid primary key references public.fin_receb_municipios(id),
 ativo boolean not null default false, versao bigint not null default 1,
 pasta_raiz text not null, instalacao text not null, conta_id bigint not null,
 pronto boolean not null default false, motivo text not null default 'drive_nao_conectado',
 checado_em timestamptz, alterado_por uuid references public.profiles(id), alterado_em timestamptz not null default now()
);
create table public.integracao_documental_pastas (
 cliente_id uuid primary key references public.fin_receb_clientes(id), pasta_id text not null,
 alterado_por uuid references public.profiles(id), alterado_em timestamptz not null default now()
);
create table public.integracao_documental_arquivos (
 id uuid primary key default gen_random_uuid(), cliente_id uuid not null references public.fin_receb_clientes(id),
 instalacao text not null, conta_id bigint not null, conversa_id bigint not null, mensagem_id bigint not null, anexo_id bigint not null,
 hash text, drive_id text, pasta_id text, nome text, mime text,
 status text not null default 'recebido' check(status in ('recebido','arquivado','conforme','correcao','revisao')),
 analise jsonb, tentativas integer not null default 0, erro text,
 criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
 unique(instalacao,conta_id,conversa_id,mensagem_id,anexo_id)
);
create table public.integracao_documental_auditoria (
 id bigint generated always as identity primary key, municipio_id uuid not null,
 ator_id uuid references public.profiles(id), acao text not null, versao bigint, criado_em timestamptz not null default now()
);
alter table public.integracao_documental_config enable row level security;
alter table public.integracao_documental_pastas enable row level security;
alter table public.integracao_documental_arquivos enable row level security;
alter table public.integracao_documental_auditoria enable row level security;
revoke all on public.integracao_documental_config,public.integracao_documental_pastas,public.integracao_documental_arquivos,public.integracao_documental_auditoria from public,anon,authenticated;
grant select on public.integracao_documental_config,public.integracao_documental_pastas,public.integracao_documental_auditoria to authenticated;
grant all on public.integracao_documental_config,public.integracao_documental_pastas,public.integracao_documental_arquivos,public.integracao_documental_auditoria to service_role;
grant usage,select on sequence public.integracao_documental_auditoria_id_seq to service_role;
create policy documental_config_admin on public.integracao_documental_config for select to authenticated using(public.is_erp_admin());
create policy documental_pastas_admin on public.integracao_documental_pastas for select to authenticated using(public.is_erp_admin());
create policy documental_auditoria_admin on public.integracao_documental_auditoria for select to authenticated using(public.is_erp_admin());

insert into public.integracao_documental_config(municipio_id,pasta_raiz,instalacao,conta_id)
select id,'1ZgjCZPG5Xl1ZyZofu1EmSDCzWqneVsnE','chatwoot-cxbqw-u77386.vm.elestio.app',1
from public.fin_receb_municipios where id='b62f14cb-b2ee-55df-aa2f-3154b6fe7d1d' and lower(nome)='guaratuba';

create function public.integracao_documental_ler() returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.integracao_documental_config;
begin
 if auth.uid() is null or not public.is_erp_admin() then raise exception 'Apenas administradores podem configurar o fluxo documental.' using errcode='42501'; end if;
 select * into c from public.integracao_documental_config where municipio_id='b62f14cb-b2ee-55df-aa2f-3154b6fe7d1d';
 if not found then raise exception 'Configuração de Guaratuba indisponível.'; end if;
 return to_jsonb(c)||jsonb_build_object('pastas',(select count(*) from public.integracao_documental_pastas p join public.fin_receb_clientes f on f.id=p.cliente_id where f.municipio_id=c.municipio_id),'clientes',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'codigo',f.codigo,'nome',f.nome,'pasta_id',p.pasta_id) order by f.nome) from public.fin_receb_clientes f left join public.integracao_documental_pastas p on p.cliente_id=f.id where f.municipio_id=c.municipio_id and f.ativo),'[]'::jsonb));
end $$;
create function public.integracao_documental_alternar(p_ativo boolean,p_versao bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.integracao_documental_config;
begin
 if auth.uid() is null or not public.is_erp_admin() then raise exception 'Apenas administradores podem alterar o fluxo documental.' using errcode='42501'; end if;
 if p_ativo is null then raise exception 'Informe ligar ou desligar.'; end if;
 select * into c from public.integracao_documental_config where municipio_id='b62f14cb-b2ee-55df-aa2f-3154b6fe7d1d' for update;
 if not found then raise exception 'Configuração indisponível.'; end if;
 if c.versao is distinct from p_versao then raise exception 'O fluxo foi alterado em outra sessão. Atualize antes de tentar novamente.' using errcode='40001'; end if;
 if p_ativo and (not c.pronto or c.checado_em is null or c.checado_em<now()-interval '20 minutes') then raise exception 'O Google Drive precisa estar conectado e verificado antes de ligar o fluxo.'; end if;
 if p_ativo and not exists(select 1 from public.integracao_documental_pastas p join public.fin_receb_clientes f on f.id=p.cliente_id where f.municipio_id=c.municipio_id and f.ativo) then raise exception 'Vincule a pasta de pelo menos um cliente antes de ligar.'; end if;
 update public.integracao_documental_config set ativo=p_ativo,versao=versao+1,alterado_por=auth.uid(),alterado_em=now() where municipio_id=c.municipio_id;
 insert into public.integracao_documental_auditoria(municipio_id,ator_id,acao,versao) values(c.municipio_id,auth.uid(),case when p_ativo then 'ligado' else 'desligado' end,c.versao+1);
 return public.integracao_documental_ler();
end $$;
create function public.integracao_documental_vincular(p_cliente uuid,p_pasta text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_erp_admin() then raise exception 'Apenas administradores podem vincular pastas.' using errcode='42501'; end if;
 if not exists(select 1 from public.fin_receb_clientes where id=p_cliente and municipio_id='b62f14cb-b2ee-55df-aa2f-3154b6fe7d1d' and ativo) then raise exception 'Selecione um cliente ativo de Guaratuba.'; end if;
 if p_pasta !~ '^[A-Za-z0-9_-]{10,200}$' or p_pasta='1ZgjCZPG5Xl1ZyZofu1EmSDCzWqneVsnE' then raise exception 'Informe uma subpasta específica do cliente.'; end if;
 insert into public.integracao_documental_pastas(cliente_id,pasta_id,alterado_por) values(p_cliente,p_pasta,auth.uid()) on conflict(cliente_id) do update set pasta_id=excluded.pasta_id,alterado_por=auth.uid(),alterado_em=now();
 insert into public.integracao_documental_auditoria(municipio_id,ator_id,acao) values('b62f14cb-b2ee-55df-aa2f-3154b6fe7d1d',auth.uid(),'pasta_vinculada');
 return public.integracao_documental_ler();
end $$;
revoke all on function public.integracao_documental_ler(),public.integracao_documental_alternar(boolean,bigint),public.integracao_documental_vincular(uuid,text) from public,anon;
grant execute on function public.integracao_documental_ler(),public.integracao_documental_alternar(boolean,bigint),public.integracao_documental_vincular(uuid,text) to authenticated;

-- Ponte exclusiva do servidor: nenhuma sessão do navegador pode ler cadastros pela conta do bot.
create function public.integracao_documental_contexto(p_instalacao text,p_conta bigint,p_conversa bigint) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('config',to_jsonb(cfg),'pasta_id',p.pasta_id,'cliente_id',f.id,'processo',coalesce(m.dados,'{}'::jsonb)||jsonb_build_object('id',coalesce(m.registro_id,f.id::text),'municipioId',f.municipio_id,'codigo',f.codigo,'requerente',coalesce(m.dados->'requerente','{}'::jsonb)||jsonb_build_object('nome',f.nome,'cpf',case when m.dados->'requerente'->>'tipoPessoa'='juridica' then '' else f.cpf_cnpj end,'cnpj',case when m.dados->'requerente'->>'tipoPessoa'='juridica' then f.cpf_cnpj else coalesce(m.dados->'requerente'->>'cnpj','') end)),'configuracoes',coalesce((select jsonb_object_agg(r.registro_id,r.dados->'valor') from public.integracao_configuracoes r where r.colecao='config'),'{}'::jsonb),'regras',coalesce((select jsonb_agg(r.dados) from public.integracao_configuracoes r where r.colecao='regrasIA'),'[]'::jsonb),'arquivos',coalesce((select jsonb_agg(to_jsonb(a)) from public.integracao_documental_arquivos a where a.cliente_id=f.id),'[]'::jsonb))
 from public.integracao_crm_conversas v join public.integracao_crm_cards c on c.id=v.card_id join public.fin_receb_clientes f on f.id=c.cliente_id join public.integracao_documental_config cfg on cfg.municipio_id=f.municipio_id join public.integracao_documental_pastas p on p.cliente_id=f.id left join public.integracao_moradores m on m.referencia_id=f.id and m.colecao='processos'
 where v.instalacao=p_instalacao and v.conta_id=p_conta and v.conversa_id=p_conversa and v.identidade_confirmada and f.ativo and cfg.instalacao=p_instalacao and cfg.conta_id=p_conta
$$;
revoke all on function public.integracao_documental_contexto(text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.integracao_documental_contexto(text,bigint,bigint) to service_role;

create function public.integracao_documental_registrar(p_instalacao text,p_conta bigint,p_conversa bigint,p_cliente uuid,p_documento jsonb) returns boolean language plpgsql set search_path='' as $$
declare c jsonb; m public.integracao_moradores; novo jsonb; campo text; valor jsonb; pessoa text;
begin
 c:=public.integracao_documental_contexto(p_instalacao,p_conta,p_conversa);
 if c is null or (c->>'cliente_id')::uuid<>p_cliente or c->'config'->>'ativo' is distinct from 'true' or c->'config'->>'pronto' is distinct from 'true' or c->'config'->>'versao' is distinct from p_documento->>'configVersao' then raise exception 'Fluxo desligado ou vínculo documental indisponível.' using errcode='42501'; end if;
 if jsonb_typeof(p_documento) is distinct from 'object' or p_documento->>'origem' is distinct from 'Chatwoot / Google Drive' or p_documento->>'status' is distinct from 'recebido' or coalesce(p_documento->>'driveId','')='' or coalesce(p_documento->>'id','')='' then raise exception 'Documento sem recibo de armazenamento.'; end if;
 select * into m from public.integracao_moradores where referencia_id=p_cliente and colecao='processos' for update;
 if not found then raise exception 'Cadastre a ficha documental antes de receber pelo agente.'; end if;
 if exists(select 1 from jsonb_array_elements(coalesce(m.dados->'docs','[]'::jsonb)) d where d->>'id'=p_documento->>'id') then return false; end if;
 novo:=m.dados;pessoa:=p_documento->>'pessoa';
 if p_documento->>'documentalConforme'='true' and pessoa in ('requerente','conjuge') and jsonb_typeof(p_documento->'camposExtraidos')='object' then
  novo:=jsonb_set(novo,array[pessoa],coalesce(novo->pessoa,'{}'::jsonb));
  for campo,valor in select key,value from jsonb_each(p_documento->'camposExtraidos') loop
   if campo in ('rg','rgOrgao','rgUf','mae','pai','naturalidade','nacionalidade','profissao','empregador','telefone','email','estadoCivil','regimeBens') and jsonb_typeof(valor)='string' and length(trim(valor#>>'{}')) between 1 and 300 and coalesce(trim(novo#>>array[pessoa,campo]),'')='' then
    novo:=jsonb_set(novo,array[pessoa,campo],valor);
   end if;
  end loop;
 end if;
 update public.integracao_moradores set dados=jsonb_set(novo,'{docs}',coalesce(novo->'docs','[]'::jsonb)||jsonb_build_array(p_documento)),updated_at=now() where colecao=m.colecao and registro_id=m.registro_id;
 return true;
end $$;
revoke all on function public.integracao_documental_registrar(text,bigint,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.integracao_documental_registrar(text,bigint,bigint,uuid,jsonb) to service_role;

create function public.integracao_documental_candidatos() returns table(conversa_id bigint) language sql stable set search_path='' as $$
 select v.conversa_id from public.integracao_crm_conversas v join public.integracao_crm_cards c on c.id=v.card_id join public.fin_receb_clientes f on f.id=c.cliente_id join public.integracao_documental_config cfg on cfg.municipio_id=f.municipio_id join public.integracao_documental_pastas p on p.cliente_id=f.id where cfg.ativo and cfg.pronto and f.ativo and v.identidade_confirmada and v.instalacao=cfg.instalacao and v.conta_id=cfg.conta_id order by v.conversa_id limit 100
$$;
revoke all on function public.integracao_documental_candidatos() from public,anon,authenticated;
grant execute on function public.integracao_documental_candidatos() to service_role;
