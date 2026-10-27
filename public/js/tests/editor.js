/* Admin test editor: info + questions (2-6 choices, one correct, a difficulty) + optional random pool */
(() => {
  const page = document.getElementById('test-editor');
  if (!page) return;

  const testId = page.dataset.testId;
  const locked = page.dataset.locked === 'true';
  const initial = JSON.parse(page.dataset.test || 'null');
  const form = document.getElementById('test-form');
  const list = document.getElementById('questions');
  const count = document.getElementById('questions-count');
  const $ = id => document.getElementById(id);
  let uid = 0;
  const DIFFS = { easy: 'سهل', medium: 'متوسط', hard: 'صعب' };
  const poolBox = $('pool-box');
  const pickInputs = [...document.querySelectorAll('.pick-input')];

  // Date -> value of <input type="datetime-local"> in the admin's time zone
  const toLocal = d => { const dt = new Date(d); return new Date(dt - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

  const choiceRow = function (name, text = '', checked = false) {
    const row = document.createElement('div');
    row.className = 'choice-edit';
    row.innerHTML = `
      <label class="correct-pick" title="الإجابة الصحيحة"><input type="radio" name="${name}" aria-label="الإجابة الصحيحة"><span><i class="fa-solid fa-check"></i></span></label>
      <input class="input choice-text" maxlength="300">
      <button type="button" class="icon-btn sm danger remove-choice" title="حذف الخيار" aria-label="حذف الخيار"><i class="fa-solid fa-xmark"></i></button>`;
    row.querySelector('.choice-text').value = text;
    row.querySelector('input[type=radio]').checked = checked;
    return row;
  };

  const addQuestion = function (q = { text: '', choices: ['', '', '', ''], correct: 0, difficulty: 'medium' }) {
    const name = `correct-${uid++}`;
    const li = document.createElement('li');
    li.className = 'q-edit';
    li.innerHTML = `
      <div class="q-edit-head"><span class="q-num"></span>
        <div class="q-edit-tools">
          <select class="input q-diff" aria-label="صعوبة السؤال">${Object.entries(DIFFS).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
          <button type="button" class="icon-btn sm move-q-up" title="للأعلى" aria-label="تحريك السؤال للأعلى"><i class="fa-solid fa-chevron-up"></i></button>
          <button type="button" class="icon-btn sm move-q-down" title="للأسفل" aria-label="تحريك السؤال للأسفل"><i class="fa-solid fa-chevron-down"></i></button>
          <button type="button" class="icon-btn danger remove-question" title="حذف السؤال" aria-label="حذف السؤال"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <textarea class="input q-text" rows="2" maxlength="1000" placeholder="نص السؤال"></textarea>
      <div class="q-choices"></div>
      <button type="button" class="btn-chip add-choice"><i class="fa-solid fa-plus"></i> خيار</button>`;
    li.querySelector('.q-text').value = q.text;
    const diff = li.querySelector('.q-diff');
    diff.value = DIFFS[q.difficulty] ? q.difficulty : 'medium';
    li.dataset.diff = diff.value;
    const box = li.querySelector('.q-choices');
    q.choices.forEach((c, i) => box.appendChild(choiceRow(name, c, i === q.correct)));
    li.dataset.name = name;
    list.appendChild(li);
    refresh();
    return li;
  };

  const refresh = function () {
    const items = [...list.children];
    items.forEach((li, i) => {
      li.querySelector('.q-num').textContent = `السؤال ${i + 1}`;
      const rows = li.querySelectorAll('.choice-edit');
      rows.forEach((row, ci) => { row.querySelector('.choice-text').placeholder = `الخيار ${ci + 1}`; });
      li.querySelector('.add-choice').hidden = locked || rows.length >= 6;
      li.querySelectorAll('.remove-choice').forEach(b => { b.hidden = locked || rows.length <= 2; });
    });
    count.textContent = items.length;
    refreshPool();
    if (locked) list.querySelectorAll('input, textarea, button, select').forEach(el => { el.disabled = true; });
  };

  const available = d => list.querySelectorAll(`.q-edit[data-diff="${d}"]`).length;

  const refreshPool = function () {
    $('diff-counts').innerHTML = Object.entries(DIFFS)
      .map(([d, t]) => `<span class="diff-chip diff-${d}">${t}: ${available(d)}</span>`).join('');
    poolBox.hidden = !$('pool').checked;
    let total = 0, over = false;
    pickInputs.forEach(input => {
      const d = input.dataset.diff, max = available(d), n = Math.max(0, Math.floor(Number(input.value) || 0));
      input.max = max;
      input.classList.toggle('invalid', n > max);
      over = over || n > max;
      total += n;
      poolBox.querySelector(`.pick-available[data-diff="${d}"]`).textContent = `من أصل ${max}`;
    });
    $('pool-total').textContent = over ? 'العدد المطلوب أكبر من عدد الأسئلة المتاحة' : `كل طالب يحصل على ${total} سؤال عشوائي`;
    $('pool-total').classList.toggle('is-error', over || !total);
  };

  list.addEventListener('change', e => {
    if (!e.target.classList.contains('q-diff')) return;
    e.target.closest('.q-edit').dataset.diff = e.target.value;
    refreshPool();
  });
  $('pool').addEventListener('change', refreshPool);
  pickInputs.forEach(input => input.addEventListener('input', refreshPool));

  list.addEventListener('click', e => {
    const li = e.target.closest('.q-edit');
    if (!li) return;
    if (e.target.closest('.add-choice')) {
      li.querySelector('.q-choices').appendChild(choiceRow(li.dataset.name)).querySelector('.choice-text').focus();
    } else if (e.target.closest('.remove-choice')) {
      e.target.closest('.choice-edit').remove();
    } else if (e.target.closest('.remove-question')) {
      if (list.children.length > 1) li.remove();
    } else if (e.target.closest('.move-q-up')) {
      if (li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
    } else if (e.target.closest('.move-q-down')) {
      if (li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
    } else return;
    refresh();
  });

  const addBtn = $('add-question');
  if (addBtn) addBtn.addEventListener('click', () => addQuestion().querySelector('.q-text').focus());

  if (initial) {
    $('title').value = initial.title;
    $('description').value = initial.description || '';
    $('startAt').value = toLocal(initial.startAt);
    $('endAt').value = toLocal(initial.endAt);
    $('duration').value = initial.duration;
    $('shuffle').checked = initial.shuffle;
    $('showAnswers').checked = initial.showAnswers;
    $('pool').checked = !!initial.pool;
    pickInputs.forEach(input => { input.value = (initial.pick && initial.pick[input.dataset.diff]) || 0; });
    initial.questions.forEach(addQuestion);
    if (locked) ['startAt', 'duration', 'shuffle', 'pool'].forEach(id => { $(id).disabled = true; });
    if (locked) pickInputs.forEach(input => { input.disabled = true; });
  } else {
    // default: starts in one hour, open for one day
    const start = new Date(Date.now() + 3600000);
    start.setMinutes(0, 0, 0);
    $('startAt').value = toLocal(start);
    $('endAt').value = toLocal(new Date(start.getTime() + 86400000));
    addQuestion();
  }

  const iso = v => v ? new Date(v).toISOString() : '';

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const body = {
      title: $('title').value,
      description: $('description').value,
      startAt: iso($('startAt').value),
      endAt: iso($('endAt').value),
      duration: Number($('duration').value),
      shuffle: $('shuffle').checked,
      showAnswers: $('showAnswers').checked,
      pool: $('pool').checked,
      pick: Object.fromEntries(pickInputs.map(input => [input.dataset.diff, Math.max(0, Math.floor(Number(input.value) || 0))])),
      questions: [...list.children].map(li => {
        const rows = [...li.querySelectorAll('.choice-edit')];
        return {
          text: li.querySelector('.q-text').value,
          difficulty: li.querySelector('.q-diff').value,
          choices: rows.map(r => r.querySelector('.choice-text').value),
          correct: rows.findIndex(r => r.querySelector('input[type=radio]').checked)
        };
      })
    };
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const res = await Anki.api(testId ? `/api/v1/tests/${testId}` : '/api/v1/tests', testId ? 'PATCH' : 'POST', body);
      Anki.toastAfterReload(res.message);
      location.href = '/tests';
    } catch (err) {
      Anki.toast(err.message, 'error');
      btn.disabled = false;
    }
  });
})();
