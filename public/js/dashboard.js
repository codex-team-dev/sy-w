/* Students dashboard: local dates + admin group / supervisor management */
(() => {
  document.querySelectorAll('time[data-time]').forEach(el => {
    el.textContent = new Date(el.dataset.time).toLocaleString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  });

  const API = '/api/v1/dashboard';
  const reloadWith = msg => { Anki.toastAfterReload(msg); location.reload(); };
  const demote = btn => Anki.confirm({
    title: `إلغاء صلاحية ${btn.dataset.name}؟`,
    text: 'يعود الحساب حساب طالب ويُسحب من كل المجموعات التي يشرف عليها.',
    danger: true,
    onSubmit: async () => reloadWith((await Anki.api(`${API}/supervisors/${btn.dataset.userId}`, 'DELETE')).message)
  });

  document.getElementById('supervisors-page')?.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.classList.contains('demote-btn')) demote(btn);
    if (btn.classList.contains('make-supervisor-btn')) Anki.confirm({
      title: `تعيين ${btn.dataset.name} مشرفا؟`,
      text: 'يصبح الحساب حساب مشرف ويخرج من مجموعات الطلاب. أعطه بعدها صلاحية المجموعات التي يتابعها.',
      icon: 'fa-user-tie',
      submitText: 'تعيين',
      onSubmit: async () => {
        Anki.toastAfterReload((await Anki.api(`${API}/supervisors`, 'POST', { userId: btn.dataset.userId })).message);
        location.href = '/dashboard/supervisors';
      }
    });
  });

  const page = document.getElementById('groups-page');
  if (!page) return;
  const groupOf = el => el.closest('.group-admin');
  const supervisors = [...document.getElementById('supervisors-data').content.querySelectorAll('option')]
    .map(o => ({ value: o.value, label: o.textContent }));

  document.getElementById('new-group-btn').addEventListener('click', () => Anki.dialog({
    title: 'مجموعة جديدة',
    icon: 'fa-people-group',
    submitText: 'إنشاء',
    fields: [{ name: 'name', label: 'اسم المجموعة', required: true, maxlength: 60 }],
    onSubmit: async v => reloadWith((await Anki.api(`${API}/groups`, 'POST', v)).message)
  }));

  page.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const card = groupOf(btn);
    const groupUrl = card && `${API}/groups/${card.dataset.groupId}`;

    if (btn.classList.contains('rename-group-btn')) Anki.dialog({
      title: 'تعديل اسم المجموعة',
      icon: 'fa-pen',
      fields: [{ name: 'name', label: 'اسم المجموعة', value: card.dataset.name, required: true, maxlength: 60 }],
      onSubmit: async v => reloadWith((await Anki.api(groupUrl, 'PATCH', v)).message)
    });

    if (btn.classList.contains('delete-group-btn')) Anki.confirm({
      title: `حذف مجموعة ${card.dataset.name}؟`,
      text: 'تحذف المجموعة فقط، ولا تتأثر حسابات الطلاب أو علاماتهم.',
      icon: 'fa-trash',
      danger: true,
      submitText: 'حذف',
      onSubmit: async () => reloadWith((await Anki.api(groupUrl, 'DELETE')).message)
    });

    if (btn.classList.contains('add-students-btn')) Anki.dialog({
      title: `إضافة طلاب إلى ${card.dataset.name}`,
      icon: 'fa-user-plus',
      submitText: 'إضافة',
      fields: [{ name: 'students', label: 'أسماء الحسابات أو أرقام الهواتف (كل واحد في سطر)', type: 'textarea', required: true }],
      onSubmit: async v => {
        const data = await Anki.api(`${groupUrl}/students`, 'POST', v);
        const missing = data.notFound.length ? ` · غير موجود: ${data.notFound.join('، ')}` : '';
        reloadWith(data.message + missing);
      }
    });

    if (btn.classList.contains('remove-student-btn')) Anki.api(`${groupUrl}/students/${btn.dataset.userId}`, 'DELETE')
      .then(d => reloadWith(d.message)).catch(err => Anki.toast(err.message, 'error'));

    if (btn.classList.contains('add-supervisor-btn')) Anki.dialog({
      title: `مشرف لمجموعة ${card.dataset.name}`,
      icon: 'fa-user-tie',
      submitText: 'إضافة',
      fields: [{ name: 'userId', label: 'المشرف', type: 'select', options: supervisors, required: true }],
      onSubmit: async v => reloadWith((await Anki.api(`${groupUrl}/supervisors`, 'POST', v)).message)
    });

    if (btn.classList.contains('remove-supervisor-btn')) Anki.api(`${groupUrl}/supervisors/${btn.dataset.userId}`, 'DELETE')
      .then(d => reloadWith(d.message)).catch(err => Anki.toast(err.message, 'error'));
  });
})();
