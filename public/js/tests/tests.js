/* Tests pages: local dates, countdowns, admin delete */
const Tests = (() => {
  const pad = n => String(n).padStart(2, '0');
  // "2 يوم 3 ساعة" / "1 ساعة 5 دقيقة" / "04:09"
  const left = function (ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d) return `${d} يوم ${h} ساعة`;
    if (h) return `${h} ساعة ${m} دقيقة`;
    return `${pad(m)}:${pad(s % 60)}`;
  };
  const formatTime = d => new Date(d).toLocaleString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });

  document.querySelectorAll('[data-time]').forEach(el => { el.textContent = formatTime(el.dataset.time); });

  const countdowns = [...document.querySelectorAll('[data-countdown]')];
  const tick = function () {
    countdowns.forEach(el => {
      const ms = new Date(el.dataset.countdown) - Date.now();
      el.textContent = left(ms);
      if (ms <= 0 && el.hasAttribute('data-reload') && !el.dataset.reloading) {
        el.dataset.reloading = '1';
        setTimeout(() => location.reload(), 1500);
      }
    });
  };
  if (countdowns.length) { tick(); setInterval(tick, 1000); }

  document.querySelectorAll('.delete-test-btn').forEach(btn => btn.addEventListener('click', async () => {
    let deleted;
    await Anki.confirm({
      title: 'حذف الاختبار؟',
      text: 'سيتم حذف الاختبار وكل محاولات الطلاب ونتائجهم. لا يمكن التراجع عن هذا الإجراء.',
      icon: 'fa-trash',
      danger: true,
      submitText: 'حذف',
      onSubmit: async () => { deleted = await Anki.api(`/api/v1/tests/${btn.dataset.testId}`, 'DELETE'); }
    });
    if (!deleted) return;
    btn.closest('.test-item').remove();
    Anki.toast(deleted.message);
  }));

  document.querySelectorAll('.copy-test-link').forEach(btn => btn.addEventListener('click', async () => {
    const link = location.origin + btn.dataset.link;
    try {
      await navigator.clipboard.writeText(link);
      Anki.toast('تم نسخ رابط الاختبار');
    } catch (err) {
      window.prompt('رابط الاختبار', link);
    }
  }));

  return { left, formatTime };
})();
