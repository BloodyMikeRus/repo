(function(){
  const tg = window.Telegram?.WebApp;
  const params = new URLSearchParams(location.search);
  const country = params.get('country') || '';
  const bank = params.get('bank') || '';
  const contextEl = document.getElementById('context');
  if (country || bank) {
    contextEl.textContent = `Вы выбрали: ${country || '-'} / ${bank || '-'}`;
  }
  if (tg) {
    tg.expand();
    tg.MainButton.hide();
    tg.ready && tg.ready();
  }

  const form = document.getElementById('leadForm');
  const statusEl = document.getElementById('status');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const payload = {
        country, bank,
        name: data.name,
        phone: data.phone,
        comment: data.comment,
        username: (tg?.initDataUnsafe?.user?.username) || ''
      };
      statusEl.textContent = 'Отправляем...';
      if (tg && typeof tg.sendData === 'function') {
        tg.sendData(JSON.stringify(payload));
        statusEl.textContent = 'Заявка отправлена через Telegram.';
        tg.close && tg.close();
        return;
      }
      const resp = await fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await resp.json();
      if (json.ok) { statusEl.textContent = 'Заявка отправлена, спасибо!'; } else { statusEl.textContent = 'Не удалось отправить. Попробуйте ещё раз.'; }
    } catch (err) {
      statusEl.textContent = 'Ошибка сети. Попробуйте ещё раз.';
    }
  });
})();
