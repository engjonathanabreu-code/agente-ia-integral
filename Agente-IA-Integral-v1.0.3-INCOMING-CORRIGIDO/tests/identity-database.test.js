import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
let db;const client='10000000-0000-0000-0000-000000000001',town='20000000-0000-0000-0000-000000000001';
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema integracao_crm_privado;
 create table fin_receb_municipios(id uuid primary key,nome text,prefixo text);
 create table fin_receb_clientes(id uuid primary key,nome text,codigo text,cpf_cnpj text,municipio_id uuid,telefone text);
 create table integracao_moradores(referencia_id uuid,colecao text,dados jsonb);
 create table integracao_crm_cards(id uuid primary key default gen_random_uuid(),cliente_id uuid,lead_nome text,lead_cidade text,lead_telefone text,lead_municipio_id uuid,origem text,responsavel_id uuid,origem_dados jsonb,updated_at timestamptz,status text,valor_total numeric);
 create table integracao_crm_conversas(id uuid primary key default gen_random_uuid(),instalacao text,conta_id bigint,conversa_id bigint,contato_id bigint,card_id uuid,identidade_confirmada boolean default false);
 create table integracao_crm_atendimentos(card_id uuid);create table integracao_crm_tarefas(card_id uuid);
 create table integracao_crm_auditoria(tabela text,registro_id uuid,acao text,atual jsonb);
 create function integracao_crm_privado.normalizar(text) returns text language sql as $$select trim(translate(lower($1),'áãéíóúç','aaeiouc'))$$;
 create function integracao_crm_privado.nome(text,text,text) returns text language sql as $$select integracao_crm_privado.normalizar($1)$$;
 create function integracao_crm_privado.telefone(text) returns text language sql as $$select regexp_replace(coalesce($1,''),'[^0-9]','','g')$$;
 create function integracao_crm_privado.unir_followups(uuid,uuid) returns void language sql as $$select$$;
 insert into fin_receb_municipios values('${town}','Taió',null);
 insert into fin_receb_clientes values('${client}','José da Silva',null,'52998224725','${town}','47999990000');`);
 // Exact same migration as production; helpers above supply the existing schema.
 await db.exec(await readFile(new URL('../supabase/migrations/20260923135603_chatwoot_identificacao_contextual.sql',import.meta.url),'utf8'));
});
after(()=>db.close());
let sequence=0;
async function setup(phone='47999990000'){
 const n=++sequence;
 const card=(await db.query("insert into integracao_crm_cards(lead_nome,lead_telefone,status,valor_total) values('Contato WhatsApp',$1,'negociando',1500) returning id",[phone])).rows[0].id;
 await db.query("insert into integracao_crm_conversas(instalacao,conta_id,conversa_id,contato_id,card_id) values('test',1,$1,$1,$2)",[n,card]);return {n,card};
}
const identify=async(n,name,city,doc='')=>(await db.query('select integracao_crm_identificar($1,1,$2,$3,$4,$5) r',['test',n,name,city,doc])).rows[0].r;
test('município com UF confirma pelo telefone e nome exatos e alimenta cartão',async()=>{
 const {n,card}=await setup();const r=await identify(n,'José da Silva','Taió/SC');assert.equal(r.confirmado,true);
 const saved=(await db.query('select * from integracao_crm_cards where id=$1',[card])).rows[0];
 assert.equal(saved.cliente_id,client);assert.equal(saved.lead_nome,'José da Silva');assert.equal(saved.lead_cidade,'Taió');assert.equal(saved.lead_municipio_id,town);assert.equal(saved.status,'negociando');assert.equal(saved.valor_total,'1500');
});
test('divergência solicita apenas documento; documento errado vai para revisão',async()=>{
 const {n}=await setup();let r=await identify(n,'José da Sousa','Taió');assert.deepEqual(r.campos_faltantes,['documento']);
 r=await identify(n,'José da Sousa','Taió','52998224720');assert.equal(r.acao,'revisao_equipe');assert.deepEqual(r.campos_faltantes,[]);
});
test('telefone diferente não confirma mesmo com nome e CPF conhecidos',async()=>{
 const {n}=await setup('47888880000');const r=await identify(n,'José da Silva','Taió','52998224725');assert.equal(r.confirmado,false);
});
test('CPF confirma mantendo regra do telefone e une somente o contato verificado',async()=>{
 const {n,card}=await setup();await db.query("insert into integracao_crm_conversas(instalacao,conta_id,conversa_id,contato_id,card_id) values('test',1,900,900,$1)",[card]);
 assert.equal((await identify(n,'José da Silva','Taió','52998224725')).confirmado,true);
 assert.equal((await db.query('select identidade_confirmada from integracao_crm_conversas where conversa_id=900')).rows[0].identidade_confirmada,false);
 assert.equal((await db.query('select nome from fin_receb_clientes where id=$1',[client])).rows[0].nome,'José da Silva');
});
test('dados faltantes retornam somente o próximo campo',async()=>{
 const {n}=await setup();assert.deepEqual((await identify(n,'','')).campos_faltantes,['nome']);assert.deepEqual((await identify(n,'José da Silva','')).campos_faltantes,['cidade']);
});
test('catálogo e cursor são privados ao servidor',async()=>{
 await db.exec('set role anon');await assert.rejects(db.query('select integracao_ia_municipios()'),/permission denied/);await assert.rejects(db.query('select integracao_ia_agenda(null)'),/permission denied/);await db.exec('reset role');
 assert.equal((await db.query('select integracao_ia_agenda(4) p')).rows[0].p.pagina,4);assert.equal((await db.query('select integracao_ia_agenda(null) p')).rows[0].p.pagina,4);
});
