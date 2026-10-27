let accountSession = null;
let panelUsers = [];
let availableRoles = [];
let editingUser = false;
let resetToken = '';

function clearAccountState() {
  accountSession = null; panelUsers = []; availableRoles = [];
  $('#users-rows').replaceChildren(); $('#account-info').replaceChildren();
  $('#session-account').replaceChildren(); $('#user-form').reset();
  $('#change-password-form').reset(); $('#user-dialog').close();
  $('#users-nav').hidden = true;
  active = 'overview';
  document.querySelectorAll('.tab').forEach((tab) => { tab.hidden = tab.id !== active; });
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === active));
  $('#page-title').textContent = 'Visão geral';
  $('#page-eyebrow').textContent = 'ACOMPANHAMENTO COMERCIAL';
  $('#report-filters').hidden = false;
}

function applyAccountSession(identity) {
  accountSession = identity;
  $('#users-nav').hidden = !identity.permissions.manageUsers;
  $('#session-account').replaceChildren(el('strong', identity.user.name || identity.user.username), el('small', identity.user.roleLabel));
  $('#mail-status').hidden = identity.user.role !== 'owner' || identity.recoveryEmailConfigured;
}
async function loadAccounts() {
  const result = await api('/api/admin/users');
  panelUsers = result.users;
  availableRoles = result.roles;
  renderAccounts();
}
function renderAccounts() {
  const query = $('#user-search').value.toLocaleLowerCase();
  const users = panelUsers.filter((user) => `${user.name} ${user.username} ${user.email}`.toLocaleLowerCase().includes(query));
  $('#users-rows').replaceChildren();
  users.forEach((user) => {
    const row = el('tr');
    const person = el('td');
    person.append(el('strong', user.name || user.username), el('small', user.email || 'E-mail ainda não cadastrado'));
    const status = el('td');
    status.append(el('span', user.active ? 'Ativo' : 'Desativado', user.active ? 'badge complete' : 'badge'));
    const actions = el('td');
    const edit = el('button', 'Editar acesso');
    edit.addEventListener('click', () => openUser(user));
    actions.append(edit);
    row.append(person, el('td', user.username), el('td', user.roleLabel), status, actions);
    $('#users-rows').append(row);
  });
  if (!users.length) {
    const row = el('tr'), cell = el('td', 'Nenhum usuário encontrado.', 'empty');
    cell.colSpan = 5; row.append(cell); $('#users-rows').append(row);
  }
  $('#users-count').textContent = `${users.length} conta(s) de acesso. Cadastros independentes dos leads.`;
}
function openUser(user = null) {
  editingUser = Boolean(user);
  $('#user-form').reset();
  $('#user-dialog-title').textContent = user ? 'Editar acesso' : 'Criar usuário';
  $('#user-name').value = user?.name || '';
  $('#user-username').value = user?.username || '';
  $('#user-username').readOnly = Boolean(user);
  $('#user-email').value = user?.email || '';
  $('#user-active').checked = user ? user.active : true;
  $('#user-active').disabled = user?.role === 'owner';
  $('#user-role').replaceChildren();
  const roles = user?.role === 'owner' ? [{ value: 'owner', label: 'Dono Administrador' }] : availableRoles;
  roles.forEach((role) => { const option = el('option', role.label); option.value = role.value; $('#user-role').append(option); });
  $('#user-role').disabled = user?.role === 'owner';
  $('#user-role').value = user?.role || roles[0]?.value || 'client';
  $('#initial-password-wrap').hidden = Boolean(user);
  $('#user-password').required = !user;
  $('#user-password').type = 'password';
  $('#user-edit-note').hidden = !user;
  $('#user-message').textContent = '';
  $('#user-dialog').showModal();
}
function loadProfile() {
  const user = accountSession.user;
  $('#account-name').textContent = user.name || user.username;
  $('#account-info').replaceChildren();
  [['Usuário', user.username], ['E-mail', user.email || 'Solicite ao administrador o cadastro do e-mail'], ['Perfil', user.roleLabel]].forEach(([key, value]) => {
    $('#account-info').append(el('dt', key), el('dd', value));
  });
}
$('#new-user').addEventListener('click', () => openUser());
$('#user-search').addEventListener('input', renderAccounts);
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
$('#generate-password').addEventListener('click', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  $('#user-password').value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  $('#user-password').type = 'text';
});
$('#user-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.target.querySelector('button.primary'); button.disabled = true;
  try {
    await api(editingUser ? '/api/admin/users/update' : '/api/admin/users/create', {
      name: $('#user-name').value, username: $('#user-username').value, email: $('#user-email').value,
      role: $('#user-role').value, active: $('#user-active').checked,
      ...(!editingUser ? { password: $('#user-password').value } : {})
    });
    $('#user-password').value = ''; $('#user-dialog').close(); await load();
  } catch (error) { $('#user-message').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#change-password-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.target.querySelector('button');
  if ($('#new-password').value !== $('#confirm-password').value) { $('#password-message').textContent = 'As senhas não coincidem.'; return; }
  button.disabled = true;
  try {
    await api('/api/admin/account/password', { currentPassword: $('#current-password').value, password: $('#new-password').value });
    event.target.reset(); location.reload();
  } catch (error) { $('#password-message').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#forgot-password').addEventListener('click', () => { $('#recovery-message').textContent = ''; $('#recovery-dialog').showModal(); });
$('#recovery-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
  try { const result = await api('/api/auth/recovery', { email: $('#recovery-email').value }); $('#recovery-message').textContent = result.message; }
  catch (error) { $('#recovery-message').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#reset-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if ($('#reset-password').value !== $('#reset-confirm').value) { $('#reset-message').textContent = 'As senhas não coincidem.'; return; }
  const button = event.target.querySelector('button'); button.disabled = true;
  try {
    await api('/api/auth/reset', { token: resetToken, password: $('#reset-password').value });
    resetToken = ''; event.target.reset(); $('#reset-dialog').close();
    $('#login-error').textContent = 'Senha atualizada. Entre com sua nova senha.';
  } catch (error) { $('#reset-message').textContent = error.message; }
  finally { button.disabled = false; }
});
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has('reset')) {
  resetToken = fragment.get('reset') || '';
  history.replaceState(null, '', location.pathname);
  $('#reset-dialog').showModal();
}
load();
