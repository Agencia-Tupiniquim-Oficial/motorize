(() => {
  const preview = new URLSearchParams(location.search).has('heatmap');
  const attempts = {};
  const stages = { form: 'contact', chat: 'name' };
  const queues = {};
  const last = {};
  // First entry in this tab is preserved through reloads and qualification steps.
  let attribution;
  try { attribution = JSON.parse(sessionStorage.getItem('motorize-attribution-v1') || 'null'); } catch (_) {}
  if (!attribution) {
    const params = new URLSearchParams(location.search);
    let referrer = '';
    try { const ref = new URL(document.referrer); if (ref.origin !== location.origin) referrer = ref.origin; } catch (_) {}
    attribution = window.motorizeAttribution.normalize({
      source: params.get('utm_source'), medium: params.get('utm_medium'), campaign: params.get('utm_campaign'),
      content: params.get('utm_content'), term: params.get('utm_term'), referrer,
      googleAds: params.has('gclid') || params.has('gbraid') || params.has('wbraid')
    });
    try { if (!preview) sessionStorage.setItem('motorize-attribution-v1', JSON.stringify(attribution)); } catch (_) {}
  }

  const hexToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const saveAttempt = (source) => {
    try { sessionStorage.setItem(`motorize-attempt-${source}`, JSON.stringify(attempts[source])); } catch (_) {}
  };

  function attemptIdentity(source) {
    if (!attempts[source]) {
      try { attempts[source] = JSON.parse(sessionStorage.getItem(`motorize-attempt-${source}`) || 'null'); } catch (_) {}
    }
    if (!attempts[source]) {
      attempts[source] = { id: crypto.randomUUID(), token: hexToken() };
      saveAttempt(source);
    }
    return attempts[source];
  }

  function touch(source, force = false) {
    if (preview || stages[source] === 'review') return Promise.resolve();
    let attempt = attemptIdentity(source);
    if (attempt.completed && ['contact', 'name'].includes(stages[source])) {
      delete attempts[source];
      try { sessionStorage.removeItem(`motorize-attempt-${source}`); } catch (_) {}
      attempt = attemptIdentity(source);
    }
    if (attempt.completed) return Promise.resolve();
    if (!force && Date.now() - (last[source] || 0) < 3000) return queues[source] || Promise.resolve();
    last[source] = Date.now();
    const payload = { id: attempt.id, token: attempt.token, source, stage: stages[source] };
    const task = (queues[source] || Promise.resolve()).catch(() => {}).then(async () => {
      const response = await fetch('/api/funnel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true
      });
      if (!response.ok) throw Error('Não foi possível registrar o preenchimento. Tente novamente.');
    });
    queues[source] = task;
    return task;
  }

  window.motorizeFunnelActivity = (source) => touch(source, true).catch(() => {});
  window.motorizeFunnelStage = (source, stage) => {
    const changed = stages[source] !== stage;
    stages[source] = stage;
    if (changed && attempts[source] && !attempts[source].completed) touch(source, true).catch(() => {});
  };

  if (!preview) {
    for (const eventName of ['input', 'change']) {
      document.addEventListener(eventName, (event) => {
        const source = event.target.closest('#lead-form') ? 'form' : event.target.closest('#sales-chat') ? 'chat' : null;
        if (source && event.target.matches('input, textarea, select')) touch(source).catch(() => {});
      });
    }
  }

  window.motorizeSave = async (source, status, data) => {
    await touch(source, true);
    const attempt = attemptIdentity(source);
    const key = `motorize-lead-${source}`;
    let identity;
    try { identity = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (_) {}
    if (identity?.completed && status === 'started') identity = null;
    if (!identity) {
      identity = { id: crypto.randomUUID(), token: hexToken() };
      try { sessionStorage.setItem(key, JSON.stringify(identity)); } catch (_) {}
    }
    let response;
    try {
      response = await fetch('/api/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...identity, source, status, data, attribution, attemptId: attempt.id, attemptToken: attempt.token })
      });
    } catch (_) {
      throw Error('Não conseguimos salvar agora. Confira sua conexão e tente novamente.');
    }
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Não foi possível salvar. Tente novamente.');
    if (status === 'completed') {
      attempt.completed = true;
      identity.completed = true;
      saveAttempt(source);
      try { sessionStorage.setItem(key, JSON.stringify(identity)); } catch (_) {}
    }
  };

  if (preview) {
    document.documentElement.classList.add('heatmap-preview');
    return;
  }

  document.addEventListener('click', (event) => {
    const source = event.target.closest('#lead-form') ? 'form' : event.target.closest('#sales-chat') ? 'chat' : null;
    if (source && attempts[source] && !attempts[source].completed && event.target.closest('button')) touch(source).catch(() => {});
  }, { capture: true });

  const visit = crypto.randomUUID();
  let session;
  try {
    session = sessionStorage.getItem('motorize-visit-session');
    if (!session) {
      session = crypto.randomUUID();
      sessionStorage.setItem('motorize-visit-session', session);
    }
  } catch (_) { session = crypto.randomUUID(); }

  const send = (data) => fetch('/api/analytics', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visit, ...data }), keepalive: true
  }).then((response) => response.ok).catch(() => false);
  let ready = false;
  async function registerView(attempt = 0) {
    ready = await send({ type: 'view', session, device: innerWidth <= 800 ? 'mobile' : 'desktop' });
    if (ready) recordDepth(true);
    else if (attempt < 2) setTimeout(() => registerView(attempt + 1), 1500 * (attempt + 1));
  }

  const allowed = ['inicio', 'diagnostico', 'metodo', 'especialistas', 'solucoes', 'faq', 'contato', 'rodape', 'cabecalho'];
  document.addEventListener('click', (event) => {
    if (!ready || event.target.closest('input,textarea,select,#sales-chat,#lead-form,.chat-launch')) return;
    const section = event.target.closest('section[id],header[id],footer[id]');
    if (!section || !allowed.includes(section.id)) return;
    const rect = section.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const control = event.target.closest('a,button,summary');
    let target = 'Área da seção';
    if (control) {
      if (control.getAttribute('href') === '#diagnostico') target = 'Iniciar diagnóstico';
      else if (control.tagName === 'SUMMARY') target = 'Abrir dúvida';
      else target = control.textContent.trim().replace(/\s+/g, ' ').slice(0, 80) || 'Navegação';
    }
    send({
      type: 'click', section: section.id, target,
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    });
  }, { passive: true });

  let depth = 0;
  let peakDepth = 0;
  let timer;
  function sampleDepth() {
    const height = document.documentElement.scrollHeight;
    const bottom = Math.max(0, scrollY) + innerHeight;
    const next = bottom >= height - 2 ? 100 : Math.min(99, Math.floor(bottom / height * 100));
    peakDepth = Math.max(peakDepth, next);
  }
  async function recordDepth(force = false) {
    sampleDepth();
    if (!ready) return;
    const next = peakDepth;
    if (next > depth && (force || next >= depth + 5 || [25, 50, 75, 90, 100].some((mark) => depth < mark && next >= mark))) {
      if (await send({ type: 'depth', depth: next })) depth = Math.max(depth, next);
    }
  }
  addEventListener('scroll', () => {
    sampleDepth();
    if (!timer) timer = setTimeout(() => { timer = null; recordDepth(); }, 250);
  }, { passive: true });
  addEventListener('pagehide', () => recordDepth(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') recordDepth(true); });
  addEventListener('resize', () => recordDepth(true));
  addEventListener('load', () => recordDepth(true));
  registerView();
})();
