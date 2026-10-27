const $ = (selector) => document.querySelector(selector);
let leads = [];
let active = 'overview';
let heatData = null;
let heatSequence = 0;

async function api(path, body) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  if (response.status === 401) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    throw Error(data.error);
  }
  if (!response.ok) throw Error(data.error || 'Não foi possível carregar.');
  return data;
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const period = () => $('#period').value;
const formatDate = (value) => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  button.disabled = true;
  $('#login-error').textContent = '';
  try {
    await api('/api/admin/login', { username: $('#username').value, password: $('#password').value });
    $('#password').value = '';
    window.scrollTo(0, 0);
    await load();
  } catch (error) { $('#login-error').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#logout').addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', {});
    $('#app').hidden = true;
    $('#login').hidden = false;
    leads = [];
    $('#lead-rows').replaceChildren();
    $('#lead-info').replaceChildren();
    $('#lead-detail').close();
  } catch (error) { $('#app-error').textContent = error.message; }
});

async function load() {
  try {
    const data = await api(`/api/admin/dashboard?days=${period()}`);
    $('#app').hidden = false;
    $('#login').hidden = true;
    $('#app-error').textContent = '';
    renderDashboard(data);
    if (active === 'leads') await loadLeads();
    if (active === 'heatmap') await loadHeat();
  } catch (error) { $('#app-error').textContent = error.message; }
}

function renderDashboard(data) {
  renderFunnel(data.funnel || []);
  const count = (source, status) => data.counts.filter((item) => (!source || item.source === source) && (!status || item.status === status)).reduce((sum, item) => sum + item.n, 0);
  const qualified = count(null, 'completed');
  const started = count();
  const cards = [
    ['Acessos ao site', data.views.n, `${data.views.sessions} sessões de navegação`],
    ['Leads pelo formulário', count('form', 'completed'), `${count('form')} contatos iniciados`],
    ['Leads pelo chat', count('chat', 'completed'), `${count('chat')} contatos iniciados`],
    ['Taxa de qualificação', started ? `${Math.round(qualified / started * 100)}%` : '—', `${qualified} qualificados de ${started} iniciados`]
  ];
  $('#metrics').replaceChildren();
  cards.forEach(([title, value, caption]) => {
    const card = el('article', undefined, 'metric');
    card.append(el('h2', title), el('div', value, 'value'), el('p', caption));
    $('#metrics').append(card);
  });
  $('#updated').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  $('#daily').replaceChildren();
  if (!data.daily.length) $('#daily').append(el('p', 'Os acessos aparecerão aqui conforme o site receber visitas.', 'empty'));
  else {
    const max = Math.max(...data.daily.map((item) => item.n));
    data.daily.forEach((day) => {
      const bar = el('div', undefined, 'bar');
      const line = el('i');
      line.style.height = `${Math.max(3, day.n / max * 120)}px`;
      bar.append(el('strong', day.n), line, el('span', `${day.day.slice(8)}/${day.day.slice(5, 7)}`));
      bar.title = `${day.day}: ${day.n} acessos`;
      $('#daily').append(bar);
    });
  }
  $('#depth').replaceChildren();
  [25, 50, 75, 90].forEach((percent) => {
    const number = data.depth[`d${percent}`] || 0;
    const value = data.depth.n ? Math.round(number / data.depth.n * 100) : 0;
    const row = el('div', undefined, 'depth-row');
    const top = el('div');
    const track = el('div', undefined, 'depth-track');
    const fill = el('i');
    top.append(el('span', `Chegaram a ${percent}% da página`), el('strong', `${value}%`));
    fill.style.width = `${value}%`;
    track.append(fill);
    row.append(top, track);
    $('#depth').append(row);
  });
}

async function loadLeads() {
  const data = await api(`/api/admin/leads?days=${period()}`);
  leads = data.leads;
  renderLeads();
}

function renderLeads() {
  const query = $('#search').value.toLocaleLowerCase();
  const source = $('#source').value;
  const rows = leads.filter((lead) => (source === 'all' || source === lead.source) && [lead.data.name, lead.data.email, lead.data.phone, lead.data.company, lead.data.city || ''].join(' ').toLocaleLowerCase().includes(query));
  $('#lead-rows').replaceChildren();
  rows.forEach((lead) => {
    const row = el('tr');
    const contact = el('td');
    contact.append(el('strong', lead.data.name), el('small', lead.data.email), el('small', lead.data.phone));
    const status = el('td');
    status.append(el('span', lead.status === 'completed' ? 'Qualificado' : 'Iniciado', lead.status === 'completed' ? 'badge complete' : 'badge'));
    const action = el('td');
    const button = el('button', 'Ver detalhes');
    button.addEventListener('click', () => showLead(lead));
    action.append(button);
    row.append(contact, el('td', lead.data.company || 'Ainda não informado'), el('td', lead.source === 'form' ? 'Formulário' : 'Chat'), status, el('td', lead.data.budget || 'Ainda não informado'), el('td', formatDate(lead.created)), action);
    $('#lead-rows').append(row);
  });
  if (!rows.length) {
    const cell = el('td', 'Nenhum lead encontrado neste período.', 'empty');
    cell.colSpan = 7;
    const row = el('tr');
    row.append(cell);
    $('#lead-rows').append(row);
  }
  $('#lead-count').textContent = `${rows.length} lead(s) exibido(s). Até 1.000 registros mais recentes por período.`;
}

function showLead(lead) {
  $('#lead-info').replaceChildren();
  const data = lead.data;
  const fields = [
    ['Nome', data.name], ['E-mail', data.email], ['Telefone', data.phone], ['Empresa', data.company || 'Ainda não informada'],
    ['Origem', lead.source === 'form' ? 'Formulário' : 'Chat'], ['Situação', lead.status === 'completed' ? 'Lead qualificado' : 'Contato iniciado'],
    ['Recebido', formatDate(lead.created)], ['Última atualização', formatDate(lead.updated)]
  ];
  if (lead.status === 'completed') fields.push(
    ['Cargo', data.role], ['Cidade/UF', data.city || 'Não informado'], ['Porte da operação', data.stores],
    ['Investimento em mídia', data.budget], ['Prioridade', data.challenge], ['Prazo para iniciar', data.timeline], ['Contexto adicional', data.details || 'Sem observações adicionais']
  );
  fields.forEach(([label, value]) => {
    const row = el('div', undefined, 'info-row');
    row.append(el('small', label), el('span', value));
    $('#lead-info').append(row);
  });
  $('#lead-detail').showModal();
}

$('#close-detail').addEventListener('click', () => $('#lead-detail').close());
$('#search').addEventListener('input', renderLeads);
$('#source').addEventListener('change', renderLeads);
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', async () => {
  active = button.dataset.tab;
  window.scrollTo(0, 0);
  document.querySelectorAll('.tab').forEach((tab) => { tab.hidden = tab.id !== active; });
  document.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('active', item === button));
  $('#page-title').textContent = { overview: 'Visão geral', leads: 'Leads recebidos', heatmap: 'Mapa de calor' }[active];
  try {
    if (active === 'leads') await loadLeads();
    if (active === 'heatmap') await loadHeat();
  } catch (error) { $('#app-error').textContent = error.message; }
}));
$('#period').addEventListener('change', load);
$('#refresh').addEventListener('click', load);
$('#section').addEventListener('change', () => loadHeat().catch((error) => { $('#app-error').textContent = error.message; }));
$('#device').addEventListener('change', () => loadHeat().catch((error) => { $('#app-error').textContent = error.message; }));

async function loadHeat() {
  const sequence = ++heatSequence;
  const data = await api(`/api/admin/heatmap?days=${period()}&section=${$('#section').value}&device=${$('#device').value}`);
  if (sequence !== heatSequence) return;
  heatData = data;
  $('#heat-count').textContent = `${data.points.length} cliques na amostra`;
  $('#heat-empty').hidden = data.points.length > 0;
  $('#top-targets').replaceChildren();
  data.targets.forEach((target) => {
    const row = el('div', undefined, 'target-row');
    row.append(el('span', target.target), el('strong', target.n));
    $('#top-targets').append(row);
  });
  if (!data.targets.length) $('#top-targets').append(el('p', 'Ainda sem dados para este filtro.', 'empty'));
  drawHeat();
}

function drawHeat() {
  if (!heatData || active !== 'heatmap') return;
  const frame = $('#heat-frame');
  const doc = frame.contentDocument;
  if (!doc || !doc.querySelector(`#${heatData.section}`)) return;
  const width = heatData.device === 'mobile' ? 390 : 1440;
  frame.style.width = `${width}px`;
  frame.style.height = '900px';
  requestAnimationFrame(() => {
    const section = doc.querySelector(`#${heatData.section}`);
    const height = Math.ceil(section.getBoundingClientRect().height);
    const scale = Math.min(1, $('#heat-frame-wrap').clientWidth / width);
    frame.style.height = `${height}px`;
    const stage = $('#heat-stage');
    stage.style.left = `${Math.max(0, ($('#heat-frame-wrap').clientWidth - width * scale) / 2)}px`;
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    stage.style.transform = `scale(${scale})`;
    $('#heat-frame-wrap').style.height = `${Math.ceil(height * scale)}px`;
    frame.contentWindow.scrollTo({ top: section.getBoundingClientRect().top + frame.contentWindow.scrollY, behavior: 'instant' });
    const canvas = $('#heat-canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    const bins = new Map();
    heatData.points.forEach((point) => {
      const key = `${Math.floor(point.x * 40)},${Math.floor(point.y * 40)}`;
      const cell = bins.get(key) || { x: 0, y: 0, n: 0 };
      cell.x += point.x; cell.y += point.y; cell.n += 1; bins.set(key, cell);
    });
    const max = Math.max(1, ...[...bins.values()].map((item) => item.n));
    for (const bin of bins.values()) {
      const x = bin.x / bin.n * width;
      const y = bin.y / bin.n * height;
      const radius = heatData.device === 'mobile' ? 30 : 45;
      const weight = bin.n / max;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, weight > .6 ? 'rgba(239,67,57,.8)' : 'rgba(249,173,52,.7)');
      gradient.addColorStop(.4, 'rgba(248,190,49,.45)');
      gradient.addColorStop(1, 'rgba(53,168,224,0)');
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  });
}

$('#heat-frame').addEventListener('load', drawHeat);
window.addEventListener('resize', drawHeat);

function renderFunnel(items) {
  $('#funnel').replaceChildren();
  const labels = {
    contact: 'Dados profissionais', business: 'Empresa e cargo', profile: 'Porte e investimento', goal: 'Prioridade e prazo',
    name: 'Nome', email: 'E-mail', phone: 'WhatsApp', company: 'Empresa', role: 'Cargo', stores: 'Porte da operação',
    challenge: 'Prioridade', budget: 'Investimento em mídia', timeline: 'Prazo de início', review: 'Lead qualificado'
  };
  for (const item of items) {
    const card = el('article', undefined, 'panel funnel-card');
    card.append(el('h3', item.source === 'form' ? 'Formulário' : 'Chat'));
    const headline = el('div', undefined, 'funnel-headline');
    headline.append(el('strong', item.rate === null ? '—' : `${item.rate.toLocaleString('pt-BR')}%`), el('span', 'de desistência'));
    card.append(headline);
    const stats = el('div', undefined, 'funnel-stats');
    [[item.started, 'Começaram'], [item.active, 'Em andamento'], [item.completed, 'Qualificaram'], [item.abandoned, 'Desistiram']].forEach(([number, label]) => {
      const cell = el('div');
      cell.append(el('strong', number), el('span', label));
      stats.append(cell);
    });
    card.append(stats);
    if (!item.stages.length) card.append(el('p', item.started ? 'Nenhuma desistência identificada neste período.' : 'As etapas aparecerão assim que houver preenchimentos.', 'empty'));
    else {
      const top = item.stages.filter((stage) => stage.n === item.stages[0].n);
      card.append(el('h4', top.length > 1 ? 'Etapas com mais desistências (empate)' : 'Etapa com mais desistências'), el('p', top.map((stage) => labels[stage.stage] || stage.stage).join(' · '), 'funnel-top'));
      item.stages.forEach((stage) => {
        const row = el('div', undefined, 'depth-row');
        const line = el('div');
        const track = el('div', undefined, 'depth-track');
        const fill = el('i');
        const share = item.abandoned ? Math.round(stage.n / item.abandoned * 100) : 0;
        line.append(el('span', labels[stage.stage] || stage.stage), el('strong', `${stage.n} · ${share}%`));
        fill.style.width = `${share}%`;
        track.append(fill);
        row.append(line, track);
        card.append(row);
      });
      card.append(el('small', 'Percentuais das etapas representam a participação no total de desistências.'));
    }
    $('#funnel').append(card);
  }
}

load();
