(() => {
  const preview = new URLSearchParams(location.search).has('heatmap');
  const attempts = {};
  const stages = { form: 'contact', chat: 'name' };
  const queues = {};
  const last = {};

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
        body: JSON.stringify({ ...identity, source, status, data, attemptId: attempt.id, attemptToken: attempt.token })
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
  }).catch(() => {});
  let ready = false;
  send({ type: 'view', session, device: innerWidth <= 800 ? 'mobile' : 'desktop' }).then(() => { ready = true; });

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
  let timer;
  function recordDepth() {
    if (!ready) return;
    const next = Math.min(100, Math.round((scrollY + innerHeight) / document.documentElement.scrollHeight * 100));
    if (next >= depth + 10 || (next >= 90 && depth < 90)) {
      depth = next;
      send({ type: 'depth', depth });
    }
  }
  addEventListener('scroll', () => { clearTimeout(timer); timer = setTimeout(recordDepth, 500); }, { passive: true });
  addEventListener('pagehide', recordDepth);
  addEventListener('load', () => setTimeout(recordDepth, 700));
})();
