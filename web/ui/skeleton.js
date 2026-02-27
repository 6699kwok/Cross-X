(function createCrossXSkeleton(global) {
  function row() {
    return '<span class="skeleton-line"></span>';
  }

  function card(lines) {
    const count = Number(lines || 3);
    const rows = Array.from({ length: count }, () => row()).join("");
    return `<article class="card skeleton-card"><span class="skeleton-title"></span>${rows}</article>`;
  }

  function render(container, options) {
    if (!container) return;
    const opts = options || {};
    const count = Number(opts.count || 1);
    const lines = Number(opts.lines || 3);
    container.dataset.skeleton = "1";
    container.innerHTML = Array.from({ length: count }, () => card(lines)).join("");
  }

  function clear(container) {
    if (!container) return;
    if (container.dataset.skeleton === "1") {
      container.innerHTML = "";
      container.dataset.skeleton = "0";
    }
  }

  global.CrossXSkeleton = {
    render,
    clear,
    card,
  };
})(window);
