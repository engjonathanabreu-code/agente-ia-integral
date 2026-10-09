import {test, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {collectIdentity} from '../lib/integracao-intake.js';
import {handleIncomingMessage} from '../lib/agent.js';

process.env.INTEGRACAO_ENABLED = 'true';
process.env.OPENAI_API_KEY = 'fixture';
process.env.CHATWOOT_BASE_URL = 'https://chat.invalid';
process.env.CHATWOOT_ACCOUNT_ID = '1';
process.env.CHATWOOT_API_TOKEN = 'fixture';
process.env.INTEGRACAO_SUPABASE_SECRET = 'fixture';

const originalFetch = global.fetch;
const originalError = console.error;
after(() => { global.fetch = originalFetch; console.error = originalError; });
let attrs, sent, calls, errors, unexpected, teamId, messages;
afterEach(() => assert.deepEqual(unexpected, []));

function setup({initial = {}, model = 'offline', assignment = 'success', history = []} = {}) {
  attrs = {...initial}; sent = []; calls = []; errors = []; unexpected = [];
  teamId = null; messages = history;
  console.error = (...args) => errors.push(args);
  global.fetch = async (url, options = {}) => {
    url = String(url);
    calls.push(url);
    const body = options.body ? JSON.parse(options.body) : {};
    let result;
    if (url.startsWith('https://api.openai.com/')) {
      if (model === 'offline') throw new Error('private transport detail');
      if (Number.isInteger(model)) {
        return new Response(JSON.stringify({error: {message: 'private upstream detail', type: 'api_error'}}), {status: model});
      }
      const output = model === 'invalid_json' ? '{' : model === 'empty' ? '' : JSON.stringify(model);
      result = {output: [{type: 'message', content: [{type: 'output_text', text: output}]}]};
    } else if (url.endsWith('/teams')) {
      result = assignment === 'missing' ? [] : [{id: 4, name: 'Atendimento'}];
    } else if (url.endsWith('/assignments')) {
      if (assignment === 'failed') return new Response('{}', {status: 500});
      if (assignment !== 'unconfirmed') teamId = body.team_id;
      result = {team: {id: teamId}};
    } else if (url.endsWith('/custom_attributes')) {
      attrs = body.custom_attributes;
      result = {custom_attributes: attrs};
    } else if (url.endsWith('/messages')) {
      if (options.method === 'POST') sent.push(body);
      result = {payload: messages};
    } else if (url.endsWith('/conversations/1')) {
      result = {id: 1, status: 'open', custom_attributes: attrs, messages, meta: {team: {id: teamId}}};
    } else if (url.endsWith('/rpc/integracao_ia_municipios')) {
      result = ['Taió'];
    } else if (url.endsWith('/rpc/integracao_crm_identificar')) {
      result = {confirmado: true};
    } else {
      unexpected.push(url);
      throw new Error('Unexpected offline request');
    }
    return new Response(JSON.stringify(result), {status: 200, headers: {'content-type': 'application/json'}});
  };
}

const run = content => handleIncomingMessage({event: 'message_created', id: 9, conversation: {id: 1}, content});
const asksForIdentity = /nome completo|município|apenas o CPF|Não consegui conferir/;

for (const model of ['offline', 401, 429, 503, 'invalid_json', 'empty']) {
  test(`falha na extração (${model}) preserva dados e solicita revisão sem repetir pergunta`, async () => {
    const initial = {ia_etapa: 'identidade', ia_nome: 'Pessoa Teste', ia_cidade: 'Taió', ia_documento: '52998224725',
      ia_pede_andamento: true, ia_pedido_original: 'Quero saber o andamento', prioridade_humana: 'alta'};
    setup({initial, model});
    const result = await collectIdentity(1, 'Já informei os dados', attrs);
    assert.equal(result.review, true);
    assert.equal(result.reason, 'identity_extraction_failed');
    assert.deepEqual(result.attrs, initial);
    assert.deepEqual(attrs, initial);
    assert.equal(sent.length, 0);
    assert.equal(calls.filter(url => url.startsWith('https://api.openai.com/')).length, 1);
    assert.ok(!calls.some(url => url.includes('/rpc/')));
    assert.equal(errors[0][0], 'identity_extraction_failed');
    assert.equal(errors[0][1].status, Number.isInteger(model) ? model : null);
    assert.equal(errors[0][1].kind, ['invalid_json', 'empty'].includes(model) ? 'invalid_response' : 'model_unavailable');
    assert.doesNotMatch(JSON.stringify(errors), /Pessoa Teste|52998224725|Já informei|private/);
  });
}

for (const stage of ['inicio', 'nome', 'cidade', 'identidade']) {
  test(`falha na etapa ${stage} transfere uma vez e silencia a IA nas mensagens seguintes`, async () => {
    setup({initial: {ia_etapa: stage, ia_campo_pendente: stage === 'cidade' ? 'cidade' : 'nome', prioridade_humana: 'alta'}});
    const result = await run('Pessoa Teste');
    assert.equal(result.assigned, true);
    assert.equal(teamId, 4);
    assert.equal(attrs.ia_etapa, 'encaminhado');
    assert.equal(attrs.ia_atendimento_concluido, true);
    assert.equal(attrs.ia_pedido_original, 'Pessoa Teste');
    assert.equal(attrs.prioridade_humana, 'alta');
    assert.ok(!attrs.ia_identidade_confirmada);
    assert.equal(sent.length, 1);
    assert.doesNotMatch(sent[0].content, asksForIdentity);
    const count = calls.length;
    for (const text of ['Pessoa Teste', 'Brincadeira né']) {
      assert.equal((await run(text)).reason, 'human_handoff_active');
    }
    assert.equal(sent.length, 1);
    assert.ok(!calls.slice(count).some(url => url.startsWith('https://api.openai.com/')));
  });
}

for (const assignment of ['missing', 'failed', 'unconfirmed']) {
  test(`transferência ${assignment} mantém pedido pendente e não confirma encaminhamento`, async () => {
    setup({assignment, initial: {ia_etapa: 'identidade', ia_nome: 'Pessoa Teste', ia_pedido_original: 'Quero saber o andamento'}});
    const result = await run('Taió');
    assert.equal(result.assigned, false);
    assert.equal(result.retryable, true);
    assert.equal(attrs.ia_encaminhamento_pendente, true);
    assert.equal(attrs.ia_atendimento_concluido, false);
    assert.equal(attrs.ia_nome, 'Pessoa Teste');
    assert.equal(attrs.ia_pedido_original, 'Quero saber o andamento');
    assert.equal(sent.length, 1);
    assert.match(sent[0].content, /Não consegui concluir a transferência/);
    assert.doesNotMatch(sent[0].content, asksForIdentity);
  });
}

test('intervenção humana impede extração e transferência mesmo com modelo indisponível', async () => {
  setup({initial: {ia_etapa: 'identidade'}, history: [{message_type: 1, sender: {type: 'user'}, created_at: Date.now() / 1000}]});
  assert.equal((await run('Pessoa Teste')).ignored, true);
  assert.equal(sent.length, 0);
  assert.ok(!calls.some(url => url.startsWith('https://api.openai.com/') || url.endsWith('/assignments')));
});

test('extração bem-sucedida continua solicitando somente o próximo campo', async () => {
  setup({initial: {ia_etapa: 'nome'}, model: {nome: 'Pessoa Teste', cidade: '', documento: '', pede_andamento: false, representante: false}});
  await run('Pessoa Teste');
  assert.equal(attrs.ia_nome, 'Pessoa Teste');
  assert.equal(attrs.ia_campo_pendente, 'cidade');
  assert.equal(teamId, null);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /município/);
  assert.doesNotMatch(sent[0].content, /nome completo/);
  assert.equal(errors.length, 0);
});

test('integração desligada mantém coleta de nome sem consultar o modelo', async () => {
  setup({initial: {ia_etapa: 'nome'}});
  process.env.INTEGRACAO_ENABLED = 'false';
  try {
    await run('João Silva');
    assert.equal(attrs.ia_nome, 'João Silva');
    assert.equal(attrs.ia_etapa, 'cidade');
    assert.equal(sent.length, 1);
    assert.ok(!calls.some(url => url.startsWith('https://api.openai.com/')));
  } finally { process.env.INTEGRACAO_ENABLED = 'true'; }
});
