-- Keep matching exact and phone-bound. Normalization does not perform fuzzy matching.
create or replace function integracao_crm_privado.municipio(valor text) returns text
language sql immutable security invoker set search_path='' as $$
 select trim(regexp_replace(regexp_replace(trim(coalesce(valor,'')),
 '(?:[[:space:]]*[,/-][[:space:]]*|[[:space:]]+)(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$','','i'),
 '[[:space:]]*[-,/]?[[:space:]]*Santa Catarina$','','i'))
$$;
create or replace function public.integracao_ia_municipios() returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(nome order by nome),'[]'::jsonb) from (select distinct nome from public.fin_receb_municipios where nullif(trim(nome),'') is not null) m
$$;
revoke all on function public.integracao_ia_municipios() from public,anon,authenticated;
grant execute on function public.integracao_ia_municipios() to service_role;

-- Enrich the CRM card from its confirmed canonical client, never the other way around.
create or replace function integracao_crm_privado.enriquecer_identificado(conversa uuid) returns void
language sql security invoker set search_path='' as $$
 update public.integracao_crm_cards k set lead_nome=c.nome,lead_cidade=m.nome,lead_municipio_id=c.municipio_id,
 origem_dados=coalesce(k.origem_dados,'{}'::jsonb)||jsonb_build_object('identificacao_chatwoot',jsonb_build_object('confirmada',true,'conversa_id',v.conversa_id,'cliente_id',c.id)),updated_at=now()
 from public.integracao_crm_conversas v join public.fin_receb_clientes c on true
 left join public.fin_receb_municipios m on m.id=c.municipio_id
 where v.id=$1 and v.identidade_confirmada and k.id=v.card_id and k.cliente_id=c.id
 and (k.lead_nome is distinct from c.nome or k.lead_cidade is distinct from m.nome or k.lead_municipio_id is distinct from c.municipio_id or k.origem_dados->'identificacao_chatwoot'->>'confirmada' is distinct from 'true')
$$;
revoke all on function integracao_crm_privado.municipio(text),integracao_crm_privado.enriquecer_identificado(uuid) from public,anon,authenticated;
grant execute on function integracao_crm_privado.municipio(text),integracao_crm_privado.enriquecer_identificado(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.integracao_crm_identificar(instalacao text, conta bigint, conversa bigint, nome text DEFAULT ''::text, cidade text DEFAULT ''::text, documento text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v public.integracao_crm_conversas; lead public.integracao_crm_cards; candidatos uuid[]; alvo uuid; existente uuid; tel text; doc text;
begin
 select * into v from public.integracao_crm_conversas x where x.instalacao=$1 and x.conta_id=$2 and x.conversa_id=$3;
 if v.id is null then return jsonb_build_object('confirmado',false,'acao','aguardar_conversa'); end if;
 perform pg_advisory_xact_lock(hashtextextended(concat($1,':',$2,':',v.contato_id),0));
 select * into v from public.integracao_crm_conversas x where x.id=v.id for update;
 if v.identidade_confirmada then perform integracao_crm_privado.enriquecer_identificado(v.id); return jsonb_build_object('confirmado',true); end if;
 select * into lead from public.integracao_crm_cards where id=v.card_id for update;
 cidade=integracao_crm_privado.municipio(cidade);
 tel=integracao_crm_privado.telefone(lead.lead_telefone); doc=regexp_replace(coalesce(documento,''),'\D','','g');
 if tel='' or (doc='' and (length(trim(nome))<5 or trim(cidade)='')) then
  return jsonb_build_object('confirmado',false,'acao',case when tel='' then 'revisao_equipe' else 'solicitar_dados' end,'campos_faltantes',case when length(trim(nome))<5 then jsonb_build_array('nome') when trim(cidade)='' then jsonb_build_array('cidade') else '[]'::jsonb end,'pergunta',case when tel='' then 'A equipe precisa conferir o telefone de contato do cadastro.' when length(trim(nome))<5 then 'Qual é seu nome completo?' else 'Qual é o município do imóvel?' end);
 end if;
 select array_agg(distinct c.id) into candidatos from public.fin_receb_clientes c
 left join public.fin_receb_municipios m on m.id=c.municipio_id
 left join public.integracao_moradores e on e.referencia_id=c.id and e.colecao='processos'
 where (integracao_crm_privado.telefone(e.dados->'requerente'->>'telefone')=tel or integracao_crm_privado.telefone(to_jsonb(c)->>'telefone')=tel)
 and (case when doc<>'' then length(doc) in (11,14) and regexp_replace(coalesce(c.cpf_cnpj,''),'\D','','g')=doc
 else integracao_crm_privado.nome(c.nome,c.codigo,to_jsonb(m)->>'prefixo')=integracao_crm_privado.normalizar($4)
 and integracao_crm_privado.normalizar(m.nome)=integracao_crm_privado.normalizar(integracao_crm_privado.municipio($5)) end);
 if coalesce(cardinality(candidatos),0)<>1 then return jsonb_build_object('confirmado',false,'acao',case when doc='' then 'solicitar_documento' else 'revisao_equipe' end,'campos_faltantes',case when doc='' then jsonb_build_array('documento') else '[]'::jsonb end,'pergunta',case when doc='' then 'Já tenho seu nome e o município. Informe apenas o CPF do titular para conferir o cadastro.' else 'Os dados informados precisam de conferência pela equipe; não é necessário repeti-los.' end); end if;
 alvo=candidatos[1];
 if lead.cliente_id is not null and lead.cliente_id<>alvo then return jsonb_build_object('confirmado',false,'acao','revisao_equipe'); end if;
 perform pg_advisory_xact_lock(hashtextextended(alvo::text,1));
 select id into existente from public.integracao_crm_cards where cliente_id=alvo for update;
 if existente is not null and existente<>lead.id then
  -- Move only this verified contact's conversations. Other contacts on the same
  -- canonical card must never inherit this identity confirmation.
  update public.integracao_crm_conversas set card_id=existente,identidade_confirmada=true where card_id=lead.id and integracao_crm_conversas.instalacao=$1 and conta_id=$2 and contato_id=v.contato_id;
  if lead.cliente_id is null and not exists(select 1 from public.integracao_crm_conversas where card_id=lead.id) then
   update public.integracao_crm_atendimentos set card_id=existente where card_id=lead.id;
   update public.integracao_crm_tarefas set card_id=existente where card_id=lead.id; perform integracao_crm_privado.unir_followups(lead.id,existente);
   update public.integracao_crm_cards set origem='vinculado',responsavel_id=null where id=lead.id;
  end if;
 else
  update public.integracao_crm_cards set cliente_id=alvo,updated_at=now() where id=lead.id;
  update public.integracao_crm_conversas set identidade_confirmada=true where card_id=lead.id and integracao_crm_conversas.instalacao=$1 and conta_id=$2 and contato_id=v.contato_id;
 end if;
 insert into public.integracao_crm_auditoria(tabela,registro_id,acao,atual) values('integracao_crm_conversas',v.id,'IDENTIDADE_CONFIRMADA',jsonb_build_object('cliente_id',alvo,'criterio',case when doc<>'' then 'telefone_documento' else 'telefone_nome_municipio' end));
 perform integracao_crm_privado.enriquecer_identificado(v.id);
 return jsonb_build_object('confirmado',true);
end $function$
;

-- Resume long scans across invocations instead of starving later pages.
create table public.integracao_ia_agenda_estado(id boolean primary key default true check(id),pagina integer not null default 1 check(pagina>=1),indice integer not null default 0 check(indice>=0));
insert into public.integracao_ia_agenda_estado values(true,1,0);
alter table public.integracao_ia_agenda_estado enable row level security;
revoke all on public.integracao_ia_agenda_estado from public,anon,authenticated;
grant all on public.integracao_ia_agenda_estado to service_role;
create function public.integracao_ia_agenda(proxima_pagina integer default null,proximo_indice integer default 0) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if proxima_pagina is not null then update public.integracao_ia_agenda_estado set pagina=greatest(1,proxima_pagina),indice=greatest(0,proximo_indice) where id;end if;
 return (select jsonb_build_object('pagina',pagina,'indice',indice) from public.integracao_ia_agenda_estado where id);
end $$;
revoke all on function public.integracao_ia_agenda(integer,integer) from public,anon,authenticated;
grant execute on function public.integracao_ia_agenda(integer,integer) to service_role;

-- Existing verified conversations receive the same enrichment; no new identity is asserted.
select integracao_crm_privado.enriquecer_identificado(id) from public.integracao_crm_conversas where identidade_confirmada;
