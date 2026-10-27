const header = document.querySelector('.site-header');
const menuButton = document.querySelector('.menu-button');
const updateHeader = () => header?.classList.toggle('scrolled', window.scrollY > 18);
updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });
menuButton?.addEventListener('click', () => {
  const open = header.classList.toggle('menu-open');
  menuButton.setAttribute('aria-expanded', String(open));
});
const navLinks = [...document.querySelectorAll('nav a[href^="#"]')];
const navSections = navLinks
  .map((link) => document.querySelector(link.getAttribute('href')))
  .filter(Boolean);

navLinks.forEach((link) => link.addEventListener('click', () => {
  header.classList.remove('menu-open');
  menuButton?.setAttribute('aria-expanded', 'false');
}));

const updateActiveNav = () => {
  const readingLine = window.scrollY + (window.innerHeight * 0.34);
  let activeSection = null;
  navSections.forEach((section) => {
    if (section.offsetTop <= readingLine && (!activeSection || section.offsetTop >= activeSection.offsetTop)) {
      activeSection = section;
    }
  });
  navLinks.forEach((link) => {
    const active = link.getAttribute('href') === `#${activeSection?.id}`;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
};

updateActiveNav();
window.addEventListener('scroll', updateActiveNav, { passive: true });
window.addEventListener('resize', updateActiveNav);

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach((item) => observer.observe(item));

document.querySelectorAll('details').forEach((detail) => {
  detail.addEventListener('toggle', () => {
    if (!detail.open) return;
    document.querySelectorAll('details').forEach((other) => {
      if (other !== detail) other.open = false;
    });
  });
});

const whatsappNumber = '551141687152';
const phoneDigits = (value) => value.replace(/\D/g, '');
const isValidPhone = (value) => /^(?:55)?[1-9][0-9]{9,10}$/.test(phoneDigits(value));
const whatsappUrl = (message) => {
  const text = encodeURIComponent(message);
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return mobile
    ? `whatsapp://send?phone=${whatsappNumber}&text=${text}`
    : `https://web.whatsapp.com/send?phone=${whatsappNumber}&text=${text}`;
};

function formatPhone(value) {
  const digits = phoneDigits(value).replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function buildLeadMessage(data) {
  return [
    'Olá! Vim pelo site da Motorize+ e gostaria de uma análise da minha operação.',
    '',
    `Nome: ${data.name || 'Não informado'}`,
    `E-mail: ${data.email || 'Não informado'}`,
    `WhatsApp: ${data.phone || 'Não informado'}`,
    `Concessionária/grupo: ${data.company || 'Não informado'}`,
    `Cargo: ${data.role || 'Não informado'}`,
    `Cidade/UF: ${data.city || 'Não informado no chat'}`,
    `Porte da operação: ${data.stores || 'Não informado'}`,
    `Investimento mensal em mídia: ${data.budget || 'Não informado'}`,
    `Prioridade: ${data.challenge || 'Não informado'}`,
    `Prazo para iniciar: ${data.timeline || 'Não informado'}`,
    `Contexto adicional: ${data.details || 'Sem observações adicionais'}`
  ].join('\n');
}

// Formulário guiado
const leadForm = document.querySelector('#lead-form');
if (leadForm) {
  const panels = [...leadForm.querySelectorAll('[data-form-step]')];
  const progressLabel = document.querySelector('#form-progress');
  const progressBar = document.querySelector('#form-progress-bar');
  const title = document.querySelector('#form-title');
  const intro = document.querySelector('#form-intro');
  const nextButton = document.querySelector('#form-next');
  const backButton = document.querySelector('#form-back');
  const navigation = leadForm.querySelector('.form-navigation');
  const summary = document.querySelector('#lead-summary');
  const whatsAppLink = document.querySelector('#lead-whatsapp');
  const phoneInput = document.querySelector('#lead-phone');
  const saveStatus = document.querySelector('#form-save-status');
  const copy = [
    ['Vamos começar por você', 'Informe seus dados profissionais para iniciarmos a qualificação.'],
    ['Agora, conte sobre a empresa', 'Queremos entender seu papel e a realidade local da operação.'],
    ['Qual é o porte do negócio?', 'Estrutura e investimento ajudam a dimensionar a recomendação.'],
    ['Prioridade e momento de compra', 'Duas respostas rápidas para direcionar a primeira conversa.'],
    ['Seu diagnóstico começa aqui', 'Confira os dados antes de abrir a conversa no WhatsApp.']
  ];
  let currentStep = 0;

  try {
    const saved = JSON.parse(sessionStorage.getItem('motorize-lead-draft-v2') || '{}');
    Object.entries(saved).forEach(([name, value]) => {
      const field = leadForm.elements.namedItem(name);
      if (!field) return;
      if (field instanceof RadioNodeList) {
        [...field].forEach((radio) => { radio.checked = radio.value === value; });
      } else {
        field.value = value;
      }
    });
  } catch (_) {
    // O formulário continua normalmente quando o armazenamento local não está disponível.
  }

  phoneInput?.addEventListener('input', () => {
    phoneInput.value = formatPhone(phoneInput.value);
    phoneInput.setCustomValidity('');
  });

  const formData = () => Object.fromEntries(new FormData(leadForm).entries());

  function saveDraft() {
    try { sessionStorage.setItem('motorize-lead-draft-v2', JSON.stringify(formData())); } catch (_) {}
  }

  function validatePanel() {
    const panel = panels[currentStep];
    if (currentStep === 0 && phoneInput && !isValidPhone(phoneInput.value)) {
      phoneInput.setCustomValidity('Digite um WhatsApp com DDD.');
    }
    const invalid = [...panel.querySelectorAll('input, textarea')].find((field) => !field.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      return false;
    }
    return true;
  }

  function renderSummary() {
    const data = formData();
    const rows = [
      ['Nome', data.name], ['E-mail', data.email], ['WhatsApp', data.phone],
      ['Empresa', data.company], ['Cargo', data.role], ['Cidade', data.city],
      ['Porte', data.stores], ['Investimento', data.budget], ['Prioridade', data.challenge],
      ['Prazo', data.timeline], ['Observação', data.details || 'Não informada']
    ];
    summary.replaceChildren();
    rows.forEach(([key, value]) => {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = key;
      description.textContent = value;
      row.append(term, description);
      summary.appendChild(row);
    });
    whatsAppLink.href = whatsappUrl(buildLeadMessage(data));
  }

  function showStep() {
    panels.forEach((panel, index) => { panel.hidden = index !== currentStep; });
    progressLabel.textContent = `Etapa ${currentStep + 1} de ${panels.length}`;
    progressBar.style.width = `${((currentStep + 1) / panels.length) * 100}%`;
    title.textContent = copy[currentStep][0];
    intro.textContent = copy[currentStep][1];
    window.motorizeFunnelStage?.('form', panels[currentStep].dataset.formStep);
    backButton.hidden = currentStep === 0;
    navigation.hidden = currentStep === panels.length - 1;
    if (currentStep === panels.length - 1) renderSummary();
    const firstField = panels[currentStep].querySelector('input, textarea, a');
    if (currentStep > 0) window.setTimeout(() => firstField?.focus(), 50);
  }

  nextButton.addEventListener('click', async () => {
    if (!validatePanel()) return;
    saveDraft();
    saveStatus.textContent = '';
    nextButton.disabled = true;
    try {
      if (currentStep === 0) await window.motorizeSave?.('form', 'started', { ...formData(), company: 'Ainda não informado' });
      if (currentStep === panels.length - 2) await window.motorizeSave?.('form', 'completed', formData());
    } catch (error) {
      saveStatus.textContent = error.message;
      nextButton.disabled = false;
      return;
    }
    currentStep = Math.min(currentStep + 1, panels.length - 1);
    nextButton.disabled = false;
    showStep();
  });
  backButton.addEventListener('click', () => {
    saveDraft();
    currentStep = Math.max(currentStep - 1, 0);
    showStep();
  });
  leadForm.addEventListener('submit', (event) => event.preventDefault());
  showStep();
}

// Chat no mesmo fluxo conversacional do diagnóstico
const chatDialog = document.querySelector('#sales-chat');
const chatLaunch = document.querySelector('#chat-launch');
const chatClose = document.querySelector('#chat-close');
const chatMessages = document.querySelector('#chat-messages');
const chatControls = document.querySelector('#chat-controls');
const chatBack = document.querySelector('#chat-back');
const chatProgressLabel = document.querySelector('#chat-progress-label');
const chatProgressBar = document.querySelector('#chat-progress-bar');

if (chatDialog && chatLaunch && chatMessages && chatControls) {
  const chatSteps = [
    { key: 'name', prompt: 'Olá! Eu sou o assistente da Motorize+. Para começar, como posso chamar você?', placeholder: 'Digite seu nome', autocomplete: 'name' },
    { key: 'email', prompt: 'Qual é o seu e-mail corporativo?', placeholder: 'voce@empresa.com.br', autocomplete: 'email', inputType: 'email' },
    { key: 'phone', prompt: 'Qual é o seu WhatsApp com DDD?', placeholder: '(11) 99999-9999', autocomplete: 'tel', inputmode: 'tel' },
    { key: 'company', prompt: 'Qual é o nome da concessionária ou grupo?', placeholder: 'Nome da empresa', autocomplete: 'organization' },
    { key: 'role', prompt: 'Qual é o seu papel na empresa?', choices: ['Proprietário(a) / Sócio(a)', 'Diretor(a)', 'Marketing', 'Comercial', 'Outro'] },
    { key: 'stores', prompt: 'Quantas lojas fazem parte da operação?', choices: ['1 loja', '2 a 5 lojas', '6 a 15 lojas', '16 ou mais lojas'] },
    { key: 'challenge', prompt: 'Qual é a prioridade de negócio hoje?', choices: ['Gerar leads qualificados', 'Girar estoque parado', 'Melhorar conversão', 'Fortalecer a marca'] },
    { key: 'budget', prompt: 'Qual é o investimento mensal aproximado em mídia?', choices: ['Até R$ 10 mil', 'R$ 10 mil a R$ 30 mil', 'R$ 30 mil a R$ 80 mil', 'Acima de R$ 80 mil'] },
    { key: 'timeline', prompt: 'Quando vocês pretendem iniciar?', choices: ['Imediatamente', 'Nos próximos 30 dias', 'Em 2 a 3 meses'] }
  ];
  let answers = [];
  let busy = false;

  const addBubble = (text, who) => {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${who}`;
    bubble.textContent = text;
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  };

  function setChatProgress(index) {
    const shown = Math.min(index + 1, chatSteps.length);
    chatProgressLabel.textContent = index >= chatSteps.length ? 'Tudo pronto' : `Etapa ${shown} de ${chatSteps.length}`;
    chatProgressBar.style.width = `${index >= chatSteps.length ? 100 : (shown / chatSteps.length) * 100}%`;
    chatBack.hidden = answers.length === 0;
  }

  function chatData() {
    return Object.fromEntries(answers.map((answer) => [answer.key, answer.value]));
  }

  function renderControls(step, index) {
    chatControls.innerHTML = '';
    if (step.choices) {
      const wrap = document.createElement('div');
      wrap.className = 'chat-choices';
      step.choices.forEach((choice) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = choice;
        button.addEventListener('click', () => answerStep(index, choice));
        wrap.appendChild(button);
      });
      chatControls.appendChild(wrap);
      return;
    }
    const row = document.createElement('form');
    row.className = 'chat-input-row';
    const input = document.createElement('input');
    input.type = step.inputType || (step.key === 'phone' ? 'tel' : 'text');
    input.placeholder = step.placeholder;
    input.autocomplete = step.autocomplete || 'off';
    if (step.inputmode) input.inputMode = step.inputmode;
    input.required = !step.optional;
    if (step.key === 'phone') input.addEventListener('input', () => { input.value = formatPhone(input.value); input.setCustomValidity(''); });
    const send = document.createElement('button');
    send.type = 'submit';
    send.setAttribute('aria-label', 'Enviar resposta');
    send.textContent = '→';
    row.append(input, send);
    row.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value && !step.optional) return input.reportValidity();
      if (step.key === 'phone' && !isValidPhone(value)) {
        input.setCustomValidity('Digite um WhatsApp com DDD.');
        return input.reportValidity();
      }
      answerStep(index, value || 'Prefiro explicar na conversa');
    });
    chatControls.appendChild(row);
    window.setTimeout(() => input.focus(), 60);
  }

  function renderFinal() {
    const data = chatData();
    addBubble(`Perfeito, ${data.name || 'obrigado'}! Organizei as informações. Clique abaixo para falar com um especialista e iniciar seu diagnóstico.`, 'bot');
    chatControls.innerHTML = `<div class="chat-final"><a href="${whatsappUrl(buildLeadMessage(data))}" target="_blank" rel="noopener">Continuar no WhatsApp ↗</a><small>Nada foi enviado automaticamente.</small></div>`;
    setChatProgress(chatSteps.length);
  }

  function renderCurrent(animated = true) {
    const index = answers.length;
    setChatProgress(index);
    if (index >= chatSteps.length) return renderFinal();
    const step = chatSteps[index];
    const finish = () => {
      addBubble(step.prompt, 'bot');
      renderControls(step, index);
      busy = false;
    };
    if (!animated) return finish();
    busy = true;
    chatControls.innerHTML = '';
    const typing = document.createElement('div');
    typing.className = 'chat-typing';
    typing.setAttribute('aria-label', 'Digitando');
    typing.innerHTML = '<i></i><i></i><i></i>';
    chatMessages.appendChild(typing);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    window.setTimeout(() => { typing.remove(); finish(); }, 420);
  }

  async function answerStep(index, value) {
    if (busy || index !== answers.length) return;
    const step = chatSteps[index];
    busy = true;
    answers.push({ key: step.key, value });
    try {
      if (step.key === 'phone') await window.motorizeSave?.('chat', 'started', { ...chatData(), company: 'Ainda não informado' });
      if (index === chatSteps.length - 1) await window.motorizeSave?.('chat', 'completed', chatData());
    } catch (error) {
      answers.pop();
      busy = false;
      const notice = document.createElement('p');
      notice.className = 'chat-error';
      notice.setAttribute('role', 'alert');
      notice.textContent = error.message;
      chatControls.appendChild(notice);
      return;
    }
    busy = false;
    addBubble(value, 'user');
    renderCurrent();
  }

  function rebuildChat() {
    chatMessages.innerHTML = '';
    answers.forEach((answer, index) => {
      addBubble(chatSteps[index].prompt, 'bot');
      addBubble(answer.value, 'user');
    });
    renderCurrent(false);
  }

  chatLaunch.addEventListener('click', () => {
    chatDialog.showModal();
    chatLaunch.hidden = true;
    if (!chatMessages.children.length) renderCurrent();
  });
  chatClose?.addEventListener('click', () => chatDialog.close());
  chatDialog.addEventListener('close', () => { chatLaunch.hidden = false; });
  chatDialog.addEventListener('click', (event) => {
    const rect = chatDialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) chatDialog.close();
  });
  chatBack?.addEventListener('click', () => {
    if (busy || !answers.length) return;
    answers.pop();
    rebuildChat();
  });
}
