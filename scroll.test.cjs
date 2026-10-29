const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settle = () => new Promise(setImmediate);

function visitor({ viewFails = 0, depthFails = 0, preview = false } = {}) {
  const events = {}, docEvents = {}, timers = [], sent = [];
  const context = {
    URL, URLSearchParams, crypto: require('node:crypto').webcrypto,
    location: { search: preview ? '?heatmap=1' : '', origin: 'https://motorize.agenciatupiniquim.com.br' },
    document: { referrer: '', visibilityState: 'visible', documentElement: { scrollHeight: 1000, classList: { add() {} } }, addEventListener: (name, fn) => { docEvents[name] = fn; } },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    innerWidth: 1200, innerHeight: 100, scrollY: 0,
    addEventListener: (name, fn) => { events[name] = fn; },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    fetch: async (_, options) => {
      const payload = JSON.parse(options.body);
      sent.push(payload);
      const fail = payload.type === 'view' ? viewFails-- > 0 : payload.type === 'depth' && depthFails-- > 0;
      return { ok: !fail };
    }
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['attribution.js', 'capture.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, 'dist', file), 'utf8'), context);
  return { context, events, docEvents, timers, sent, async scroll(bottom) { context.scrollY = bottom * 10 - 100; events.scroll(); while (timers.length) timers.shift()(); await settle(); } };
}

test('registra tela inicial, cruza cada marco e preserva maior alcance ao voltar', async () => {
  const v = visitor();
  await settle();
  assert.equal(v.sent.at(-1).depth, 10);
  await v.scroll(24);
  await v.scroll(25);
  assert.equal(v.sent.at(-1).depth, 25, 'não perde marco por diferença menor que dez pontos');
  await v.scroll(49); await v.scroll(50);
  assert.equal(v.sent.at(-1).depth, 50);
  await v.scroll(74); await v.scroll(75);
  assert.equal(v.sent.at(-1).depth, 75);
  await v.scroll(89); await v.scroll(90);
  assert.equal(v.sent.at(-1).depth, 90);
  await v.scroll(100);
  assert.equal(v.sent.at(-1).depth, 100);
  const count = v.sent.length;
  await v.scroll(10);
  assert.equal(v.sent.length, count);
});

test('registra pico em rolagem rápida, saída e aba oculta', async () => {
  const v = visitor(); await settle();
  v.context.scrollY = 660; v.events.scroll(); // 76%
  v.context.scrollY = 0; v.events.scroll();
  v.events.pagehide(); await settle();
  assert.equal(v.sent.at(-1).depth, 76);
  v.context.scrollY = 680;
  v.context.document.visibilityState = 'hidden';
  v.docEvents.visibilitychange(); await settle();
  assert.equal(v.sent.at(-1).depth, 78, 'saída não depende de intervalo mínimo');
});

test('não confirma eventos rejeitados e tenta novamente', async () => {
  const v = visitor({ viewFails: 1, depthFails: 1 }); await settle();
  assert.deepEqual(v.sent.map((item) => item.type), ['view']);
  v.timers.shift()(); await settle();
  assert.equal(v.sent.at(-1).type, 'depth');
  v.events.pagehide(); await settle();
  assert.equal(v.sent.filter((item) => item.type === 'depth').length, 2);
});

test('prévia do mapa de calor não gera visitas ou rolagem', async () => {
  const v = visitor({ preview: true }); await settle();
  assert.equal(v.sent.length, 0);
});
