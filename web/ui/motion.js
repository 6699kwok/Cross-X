(function createCrossXMotion(global) {
  const media = global.matchMedia ? global.matchMedia("(prefers-reduced-motion: reduce)") : null;

  function reduced() {
    return media ? media.matches : false;
  }

  function safeDuration(ms) {
    return reduced() ? 1 : ms;
  }

  function enter(element, opts) {
    if (!element) return Promise.resolve();
    const options = opts || {};
    const keyframes = [
      { opacity: options.fromOpacity !== undefined ? options.fromOpacity : 0, transform: `translateY(${options.fromY || 10}px)` },
      { opacity: options.toOpacity !== undefined ? options.toOpacity : 1, transform: "translateY(0px)" },
    ];
    return element.animate(keyframes, {
      duration: safeDuration(options.duration || 180),
      easing: options.easing || "cubic-bezier(.2,.8,.2,1)",
      fill: "forwards",
    }).finished.catch(() => {});
  }

  function exit(element, opts) {
    if (!element) return Promise.resolve();
    const options = opts || {};
    const keyframes = [
      { opacity: 1, transform: "translateY(0px)" },
      { opacity: 0, transform: `translateY(${options.toY || 8}px)` },
    ];
    return element.animate(keyframes, {
      duration: safeDuration(options.duration || 150),
      easing: options.easing || "ease-in",
      fill: "forwards",
    }).finished.catch(() => {});
  }

  function slideInRight(element, opts) {
    if (!element) return Promise.resolve();
    const options = opts || {};
    return element.animate(
      [
        { opacity: 0, transform: "translateX(28px)" },
        { opacity: 1, transform: "translateX(0)" },
      ],
      {
        duration: safeDuration(options.duration || 220),
        easing: options.easing || "cubic-bezier(.2,.8,.2,1)",
        fill: "forwards",
      },
    ).finished.catch(() => {});
  }

  function slideOutRight(element, opts) {
    if (!element) return Promise.resolve();
    const options = opts || {};
    return element.animate(
      [
        { opacity: 1, transform: "translateX(0)" },
        { opacity: 0, transform: "translateX(24px)" },
      ],
      {
        duration: safeDuration(options.duration || 180),
        easing: options.easing || "ease-in",
        fill: "forwards",
      },
    ).finished.catch(() => {});
  }

  function popIn(element, opts) {
    if (!element) return Promise.resolve();
    const options = opts || {};
    return element.animate(
      [
        { opacity: 0, transform: "scale(.96)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      {
        duration: safeDuration(options.duration || 180),
        easing: options.easing || "cubic-bezier(.2,.8,.2,1)",
        fill: "forwards",
      },
    ).finished.catch(() => {});
  }

  function popOut(element, opts) {
    if (!element) return Promise.resolve();
    const options = opts || {};
    return element.animate(
      [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "scale(.98)" },
      ],
      {
        duration: safeDuration(options.duration || 140),
        easing: options.easing || "ease-in",
        fill: "forwards",
      },
    ).finished.catch(() => {});
  }

  function pressable(element) {
    if (!element || element.dataset.pressableBound === "1") return;
    element.dataset.pressableBound = "1";
    element.addEventListener("pointerdown", () => {
      element.classList.add("is-pressed");
      if (!reduced()) {
        const ripple = document.createElement("span");
        ripple.className = "ripple";
        element.appendChild(ripple);
        const done = () => ripple.remove();
        ripple.addEventListener("animationend", done, { once: true });
      }
    });
    const clear = () => element.classList.remove("is-pressed");
    element.addEventListener("pointerup", clear);
    element.addEventListener("pointerleave", clear);
    element.addEventListener("pointercancel", clear);
  }

  function stagger(elements, options) {
    const opts = options || {};
    const list = Array.isArray(elements) ? elements : [];
    const gap = safeDuration(opts.gap || 28);
    list.forEach((el, idx) => {
      if (!el) return;
      setTimeout(() => {
        enter(el, { duration: opts.duration || 180, fromY: opts.fromY || 8 });
      }, idx * gap);
    });
  }

  function bindPressables(root) {
    const scope = root || document;
    scope.querySelectorAll("button, .card, .chip, .tab").forEach((item) => pressable(item));
  }

  global.CrossXMotion = {
    reduced,
    safeDuration,
    enter,
    exit,
    slideInRight,
    slideOutRight,
    popIn,
    popOut,
    pressable,
    stagger,
    bindPressables,
  };
})(window);
