const $ = (id) => document.getElementById(id);
const API = '/api/v1/codex-requests';
const STATUS_LABEL = { new: 'جديد', contacted: 'تم التواصل', done: 'مكتمل' };
let requests = [];
let filter = 'all';

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status !== 'success') throw new Error(data.message || 'حدث خطأ');
  return data;
}

const showError = (msg) => { $('ge').textContent = msg || ''; };

function setCounts(counts) {
  document.querySelectorAll('[data-c]').forEach((b) => { b.textContent = counts[b.dataset.c] || 0; });
  document.title = (counts.new ? `(${counts.new}) ` : '') + 'طلبات Codex | Studyou';
}

function recount() {
  const counts = { all: requests.length, new: 0, contacted: 0, done: 0 };
  requests.forEach((r) => { counts[r.status] += 1; });
  setCounts(counts);
}

const fmtDate = (d) => new Date(d).toLocaleString('ar', {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

function buildCard(r) {
  const node = $('tpl').content.firstElementChild.cloneNode(true);
  const f = (k) => node.querySelector(`[data-f="${k}"]`);
  node.dataset.id = r._id;
  node.classList.add(`s-${r.status}`);
  ['name', 'projectType', 'budget', 'deadline', 'location', 'phone', 'details'].forEach((k) => { f(k).textContent = r[k] || '-'; });
  f('email').textContent = r.email || '-';
  f('date').textContent = fmtDate(r.createdAt);
  f('status').value = r.status;
  f('note').value = r.note || '';

  const digits = (r.phone || '').replace(/[^\d]/g, '');
  f('wa').href = `https://wa.me/${digits}`;
  f('tel').href = `tel:${(r.phone || '').replace(/[^\d+]/g, '')}`;
  if (r.email) f('mail').href = `mailto:${r.email}`; else f('mail').remove();

  const flash = (msg) => { f('saved').textContent = msg; setTimeout(() => { f('saved').textContent = ''; }, 2000); };

  f('status').addEventListener('change', async (e) => {
    const prev = r.status;
    try {
      await api(`${API}/${r._id}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) });
      r.status = e.target.value;
      node.classList.remove(`s-${prev}`);
      node.classList.add(`s-${r.status}`);
      recount();
      flash(`تم: ${STATUS_LABEL[r.status]}`);
      if (filter !== 'all' && filter !== r.status) node.remove();
    } catch (err) {
      e.target.value = prev;
      showError(err.message);
    }
  });

  f('note').addEventListener('change', async (e) => {
    try {
      await api(`${API}/${r._id}`, { method: 'PATCH', body: JSON.stringify({ note: e.target.value }) });
      r.note = e.target.value;
      flash('تم حفظ الملاحظة');
    } catch (err) { showError(err.message); }
  });

  f('del').addEventListener('click', async () => {
    if (!confirm(`حذف طلب ${r.name}؟ لا يمكن التراجع.`)) return;
    try {
      await api(`${API}/${r._id}`, { method: 'DELETE' });
      requests = requests.filter((x) => x._id !== r._id);
      node.remove();
      recount();
      render();
    } catch (err) { showError(err.message); }
  });

  return node;
}

function render() {
  const q = $('q').value.trim().toLowerCase();
  const shown = requests.filter((r) => (filter === 'all' || r.status === filter)
    && (!q || [r.name, r.phone, r.location, r.email, r.details, r.projectType, r.note]
      .some((v) => (v || '').toLowerCase().includes(q))));
  $('list').replaceChildren(...shown.map(buildCard));
  $('empty').hidden = shown.length > 0;
}

async function load() {
  // Don't redraw while the admin is typing a note.
  if (document.activeElement && document.activeElement.matches('#list textarea')) return;
  try {
    const data = await api(API);
    requests = data.requests;
    setCounts(data.counts);
    showError('');
    render();
  } catch (err) { showError(err.message); }
}

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  filter = b.dataset.s;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  render();
});
$('q').addEventListener('input', render);

load();
setInterval(load, 30000);
