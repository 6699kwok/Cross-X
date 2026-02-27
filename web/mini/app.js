(function miniApp() {
  function qs(id) {
    return document.getElementById(id);
  }

  function now() {
    return new Date().toLocaleString();
  }

  function setBuild() {
    fetch('/api/system/build')
      .then((res) => res.json())
      .then((data) => {
        const tag = qs('buildTag');
        if (tag) tag.textContent = data.buildId || 'build:unknown';
      })
      .catch(() => {
        const tag = qs('buildTag');
        if (tag) tag.textContent = 'build:unknown';
      });
  }

  function setTimestamp() {
    const ts = qs('timestamp');
    if (ts) ts.textContent = now();
  }

  function bindActions() {
    document.body.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;
      if (!action) return;

      if (action === 'open-chat-web') {
        window.location.href = '/index.html';
      }

      if (action === 'refresh-mini') {
        setTimestamp();
      }
    });
  }

  setBuild();
  setTimestamp();
  bindActions();
})();
