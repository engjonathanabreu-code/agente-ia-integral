-- Uma pasta não pode representar dois clientes. Trocar um vínculo invalida trabalhos já iniciados.
alter table public.integracao_documental_pastas add constraint documental_pasta_cliente_unica unique(pasta_id);
create function public.integracao_documental_pasta_revisao() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and new.pasta_id is not distinct from old.pasta_id then return new; end if;
 update public.integracao_documental_config set versao=versao+1 where municipio_id='b62f14cb-b2ee-55df-aa2f-3154b6fe7d1d';
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.integracao_documental_pasta_revisao() from public,anon,authenticated;
create trigger documental_pasta_revisao after insert or update or delete on public.integracao_documental_pastas for each row execute function public.integracao_documental_pasta_revisao();
