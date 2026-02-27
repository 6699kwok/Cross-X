(function createCrossXToast(global) {
  function createToast(options) {
    const opts = options || {};
    let root = document.getElementById(opts.rootId || "toastRoot");
    if (!root) {
      root = document.createElement("div");
      root.id = opts.rootId || "toastRoot";
      root.className = "toast-root";
      root.setAttribute("aria-live", "polite");
      root.setAttribute("aria-atomic", "true");
      document.body.appendChild(root);
    }

    function show(config) {
      const cfg = config || {};
      const toast = document.createElement("article");
      toast.className = `toast ${cfg.type || "info"}`;
      toast.innerHTML = `
        <div class="toast-content">${cfg.message || ""}</div>
        ${cfg.actionLabel ? `<button class="secondary toast-action">${cfg.actionLabel}</button>` : ""}
      `;
      root.appendChild(toast);
      if (global.CrossXMotion) global.CrossXMotion.enter(toast, { duration: 140, fromY: 6 });

      const close = async () => {
        if (global.CrossXMotion) await global.CrossXMotion.exit(toast, { duration: 120, toY: 6 });
        toast.remove();
      };

      if (cfg.actionLabel) {
        const actionBtn = toast.querySelector(".toast-action");
        actionBtn.addEventListener("click", () => {
          if (typeof cfg.onAction === "function") cfg.onAction();
          close();
        });
      }

      const timeout = setTimeout(close, Number(cfg.duration || 2600));
      toast.addEventListener("mouseenter", () => clearTimeout(timeout), { once: true });
      return close;
    }

    return {
      show,
    };
  }

  global.CrossXToast = {
    createToast,
  };
})(window);
