(function createCrossXModal(global) {
  const focusableSelector =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function createModal(options) {
    const opts = options || {};
    let root = opts.root || document.getElementById("modalRoot");
    if (!root) {
      root = document.createElement("div");
      root.id = "modalRoot";
      document.body.appendChild(root);
    }

    function getFocusable(container) {
      return [...container.querySelectorAll(focusableSelector)];
    }

    function confirm(params) {
      const cfg = params || {};
      return new Promise((resolve) => {
        const backdrop = document.createElement("div");
        backdrop.className = "modal-backdrop";
        backdrop.innerHTML = `
          <section class="modal" role="dialog" aria-modal="true" aria-label="${cfg.title || "Confirm"}">
            <header class="modal-head">
              <h3>${cfg.title || "Confirm action"}</h3>
            </header>
            <div class="modal-body">${cfg.body || ""}</div>
            <footer class="modal-foot">
              <button class="secondary" data-action="modal-cancel">${cfg.cancelText || "Cancel"}</button>
              <button class="${cfg.danger ? "danger" : ""}" data-action="modal-confirm">${cfg.confirmText || "Confirm"}</button>
            </footer>
          </section>
        `;
        root.appendChild(backdrop);

        const modal = backdrop.querySelector(".modal");
        const cancelBtn = backdrop.querySelector('[data-action="modal-cancel"]');
        const confirmBtn = backdrop.querySelector('[data-action="modal-confirm"]');
        const previous = document.activeElement;

        if (global.CrossXMotion) {
          global.CrossXMotion.popIn(modal, { duration: 180 });
        }

        const teardown = async (result) => {
          document.removeEventListener("keydown", onKeydown);
          backdrop.removeEventListener("click", onBackdrop);
          if (global.CrossXMotion) {
            await global.CrossXMotion.popOut(modal, { duration: 130 });
          }
          backdrop.remove();
          if (previous && typeof previous.focus === "function") previous.focus();
          resolve(result);
        };

        const onKeydown = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            teardown(false);
            return;
          }
          if (event.key !== "Tab") return;
          const nodes = getFocusable(modal);
          if (!nodes.length) return;
          const first = nodes[0];
          const last = nodes[nodes.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        };

        const onBackdrop = (event) => {
          if (event.target === backdrop) teardown(false);
        };

        cancelBtn.addEventListener("click", () => teardown(false));
        confirmBtn.addEventListener("click", () => teardown(true));
        backdrop.addEventListener("click", onBackdrop);
        document.addEventListener("keydown", onKeydown);
        confirmBtn.focus();
      });
    }

    return {
      confirm,
    };
  }

  global.CrossXModal = {
    createModal,
  };
})(window);
