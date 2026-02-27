(function createCrossXDrawer(global) {
  const focusableSelector =
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function createDrawerController() {
    let active = null;
    let lastActiveElement = null;
    let closeOnEsc = null;
    let trapTab = null;
    let backdropClose = null;

    function getFocusable(drawer) {
      return [...drawer.querySelectorAll(focusableSelector)].filter((el) => !el.hasAttribute("hidden"));
    }

    async function open(drawer, options) {
      if (!drawer) return;
      const opts = options || {};
      if (active && active !== drawer) await close(active);
      active = drawer;
      lastActiveElement = opts.trigger || document.activeElement;

      drawer.classList.remove("hidden");
      drawer.setAttribute("aria-hidden", "false");
      drawer.dataset.open = "1";

      if (global.CrossXMotion) {
        const panel = drawer.querySelector(".drawer-panel");
        if (panel) global.CrossXMotion.slideInRight(panel, { duration: 220 });
      }

      const nodes = getFocusable(drawer);
      const first = opts.initialFocus || nodes[0];
      if (first && typeof first.focus === "function") first.focus();

      closeOnEsc = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close(drawer);
        }
      };

      trapTab = (event) => {
        if (event.key !== "Tab") return;
        const focusable = getFocusable(drawer);
        if (!focusable.length) return;
        const firstNode = focusable[0];
        const lastNode = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === firstNode) {
          event.preventDefault();
          lastNode.focus();
        } else if (!event.shiftKey && document.activeElement === lastNode) {
          event.preventDefault();
          firstNode.focus();
        }
      };

      backdropClose = (event) => {
        if (event.target === drawer) close(drawer);
      };

      document.addEventListener("keydown", closeOnEsc);
      document.addEventListener("keydown", trapTab);
      drawer.addEventListener("click", backdropClose);
    }

    async function close(drawer) {
      const target = drawer || active;
      if (!target) return;

      if (global.CrossXMotion) {
        const panel = target.querySelector(".drawer-panel");
        if (panel) await global.CrossXMotion.slideOutRight(panel, { duration: 180 });
      }

      target.classList.add("hidden");
      target.setAttribute("aria-hidden", "true");
      target.dataset.open = "0";

      if (closeOnEsc) document.removeEventListener("keydown", closeOnEsc);
      if (trapTab) document.removeEventListener("keydown", trapTab);
      if (backdropClose) target.removeEventListener("click", backdropClose);
      closeOnEsc = null;
      trapTab = null;
      backdropClose = null;
      active = null;

      if (lastActiveElement && typeof lastActiveElement.focus === "function") {
        lastActiveElement.focus();
      }
    }

    function isOpen(drawer) {
      return Boolean(drawer && drawer.dataset.open === "1");
    }

    return {
      open,
      close,
      isOpen,
    };
  }

  global.CrossXDrawer = {
    createDrawerController,
  };
})(window);
