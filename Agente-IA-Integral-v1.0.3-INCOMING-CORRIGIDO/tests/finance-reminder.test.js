import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../api/finance-reminder.js';

const recipient = '5500000000000';
const secret = 'synthetic-new-crm-auth-token';
const key = 'a'.repeat(64);

function invoke({ auth = secret, phone = recipient, method = 'POST', idempotencyKey = key, mode } = {}) {
  const res = {
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const headers = { 'idempotency-key': idempotencyKey };
  if (auth) headers.authorization = `Bearer ${auth}`;
  return handler({
    method, headers,
    body: { phone, mode, payment: { accountName: 'Conta teste', method: 'Boleto', due: '2026-11-15', value: 1 } },
  }, res);
}

function configure(t, provider) {
  const old = globalThis.fetch;
  const env = {
    CHATWOOT_BASE_URL: 'https://fixture.test',
    CHATWOOT_ACCOUNT_ID: '1',
    CHATWOOT_API_TOKEN: 'synthetic-chatwoot-token',
    FINANCE_AGENT_TOKEN: secret,
    FINANCE_REMINDER_PHONE: recipient,
  };
  for (const [name, value] of Object.entries(env)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => previous === undefined ? delete process.env[name] : process.env[name] = previous);
  }
  globalThis.fetch = provider;
  t.after(() => { globalThis.fetch = old; });
}

function chatwoot({ contacts = [{ id: 3, phone_number: recipient }], send }) {
  return async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.host, 'fixture.test');
    if (parsed.pathname.endsWith('/inboxes')) return Response.json([{ id: 2, name: 'WhatsApp' }]);
    if (parsed.pathname.endsWith('/message_templates')) {
      return Response.json([{ name: 'financeiro_avisos_internos', status: 'approved' }]);
    }
    if (parsed.pathname.endsWith('/contacts/search')) return Response.json(contacts);
    if (parsed.pathname.endsWith('/conversations')) return Response.json([{ id: 4, inbox_id: 2 }]);
    assert.ok(parsed.pathname.endsWith('/messages'));
    assert.equal(options.method, 'POST');
    return send(JSON.parse(options.body));
  };
}

test('CRM falha fechado sem segredo e recusa método, token antigo, destino e chave inválidos antes do Chatwoot', async (t) => {
  configure(t, () => assert.fail('Não deve chegar ao provedor'));
  assert.equal((await invoke({ method: 'GET' })).code, 405);
  assert.equal((await invoke({ auth: '' })).code, 401);
  assert.equal((await invoke({ auth: 'token-antigo-sintetico' })).code, 401);
  assert.equal((await invoke({ phone: '5500000000001' })).code, 400);
  assert.equal((await invoke({ idempotencyKey: '' })).code, 400);
  delete process.env.FINANCE_AGENT_TOKEN;
  assert.equal((await invoke()).code, 401);
});

test('CRM envia ao contato exato, vincula a chave ao registro e retorna somente confirmação', async (t) => {
  let calls = 0;
  configure(t, chatwoot({ send(body) {
    calls++;
    assert.equal(body.content_attributes.finance_reminder_key, key);
    assert.equal(body.template_params.processed_params.body['5'], 'Boleto');
    return Response.json({ id: 5 });
  } }));
  const result = await invoke();
  assert.deepEqual(result.body, { ok: true });
  assert.equal(result.code, 200);
  assert.equal(calls, 1);
});

test('CRM não escolhe contato ambíguo nem aceita outro país pelo sufixo', async (t) => {
  let contacts = [{ id: 3, phone_number: recipient }, { id: 7, phone_number: recipient }];
  configure(t, (...args) => chatwoot({ contacts, send: () => assert.fail('Não deve enviar') })(...args));
  assert.equal((await invoke()).code, 502);
  contacts = [{ id: 3, phone_number: `54${recipient.slice(2)}` }];
  assert.equal((await invoke()).code, 502);
});

test('CRM não tenta repetir um envio de resultado incerto nem devolve detalhes do provedor', async (t) => {
  let calls = 0;
  configure(t, chatwoot({ send() {
    calls++;
    return Response.json({ message: 'detalhe sensível' }, { status: 502 });
  } }));
  const result = await invoke();
  assert.equal(result.code, 502);
  assert.deepEqual(result.body, { ok: false, error: 'reminder_not_confirmed' });
  assert.equal(calls, 1);
});

test('rota de cron legada recusa a solicitação sem abrir conexão ou enviar', async (t) => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('rede proibida no teste'); };
  t.after(() => { globalThis.fetch = previous; });
  const { default: legacy } = await import('../api/finance-due-reminders.js');
  const res = {
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
  legacy({ method: 'POST', headers: { authorization: 'Bearer teste' } }, res);
  assert.equal(res.code, 410);
  assert.equal(calls, 0);
});
