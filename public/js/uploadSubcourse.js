const nameInput = document.getElementById('subcourse-name');
const descriptionInput = document.getElementById('subcourse-des');
const photoUrlInput = document.getElementById('image');
const priceInput = document.getElementById('price');
const comingSoonInput = document.getElementById('coming-soon');
const uploadBtn = document.querySelector('.btn-sub');

const notifcation = document.querySelector('.correct');
const notifcationMsg = document.querySelector('.correct-message');

const domain = document.body.dataset.domain;

const showNotification = function(msg, type) {
  notifcation.classList.remove('hidden', 'green', 'red');
  notifcation.classList.add(type === 'success' ? 'green' : 'red');
  notifcationMsg.textContent = msg;
  setTimeout(() => notifcation.classList.add('hidden'), 5000);
};

uploadBtn.addEventListener('click', async () => {
  const title = nameInput.value.trim();
  const description = descriptionInput.value.trim();
  const photoUrl = photoUrlInput.value.trim();
  const price = priceInput.value;

  if(!title || !description || !photoUrl || price === '') return showNotification('الرجاء تعبئة جميع الحقول', 'fail');

  const courseId = location.pathname.split('/')[2];

  uploadBtn.disabled = true;
  try {
    const res = await fetch(`${domain}/api/v1/courses/${courseId}/subcourses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, photoUrl, price, comingSoon: comingSoonInput.checked })
    });
    const data = await res.json();
    showNotification(data.message || 'حدث خطأ', data.status);
    if(data.status === 'success') setTimeout(() => location.assign('/#courses'), 1200);
    else uploadBtn.disabled = false;
  } catch {
    showNotification('حدث خطأ', 'fail');
    uploadBtn.disabled = false;
  }
});
