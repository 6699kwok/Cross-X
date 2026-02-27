(function createCrossXStore(global) {
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createStore(initialState) {
    let state = clone(initialState || {});
    const listeners = new Set();

    function notify(action) {
      listeners.forEach((listener) => {
        try {
          listener(state, action);
        } catch (_err) {
          // ignore subscriber errors
        }
      });
    }

    function getState() {
      return state;
    }

    function setState(next, action) {
      state = next;
      notify(action || { type: "SET_STATE" });
      return state;
    }

    function dispatch(action) {
      const payload = action && typeof action === "object" ? action : { type: "UNKNOWN" };
      const next = clone(state);
      switch (payload.type) {
        case "SET_LANGUAGE":
          next.ui = next.ui || {};
          next.ui.language = payload.language || "ZH";
          break;
        case "SET_VIEW_MODE":
          next.ui = next.ui || {};
          next.ui.viewMode = payload.mode === "admin" ? "admin" : "user";
          break;
        case "SET_TAB":
          next.ui = next.ui || {};
          next.ui.tab = payload.tab || "chat";
          break;
        case "SET_LOADING":
          next.ui = next.ui || {};
          next.ui.loading = next.ui.loading || {};
          next.ui.loading[payload.key || "global"] = payload.value === true;
          break;
        case "SET_TASK":
          next.task = payload.task || null;
          next.plan = payload.task && payload.task.plan ? payload.task.plan : next.plan;
          next.steps = payload.task && payload.task.steps ? payload.task.steps : [];
          break;
        case "SET_STEPS":
          next.steps = Array.isArray(payload.steps) ? payload.steps : [];
          break;
        case "UPSERT_STEP":
          next.steps = Array.isArray(next.steps) ? next.steps : [];
          next.steps = next.steps.map((step) => (step.id === payload.step.id ? { ...step, ...payload.step } : step));
          break;
        case "SET_PROOFS":
          next.proofs = Array.isArray(payload.proofs) ? payload.proofs : [];
          break;
        case "SET_ORDERS":
          next.orders = Array.isArray(payload.orders) ? payload.orders : [];
          break;
        case "SET_NEARBY":
          next.nearby = Array.isArray(payload.items) ? payload.items : [];
          break;
        case "SET_AUDIT":
          next.audit = Array.isArray(payload.logs) ? payload.logs : [];
          break;
        case "SET_ERROR":
          next.error = payload.error || null;
          break;
        case "PATCH":
          if (payload.patch && typeof payload.patch === "object") {
            Object.assign(next, payload.patch);
          }
          break;
        default:
          break;
      }
      return setState(next, payload);
    }

    function subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    return {
      getState,
      setState,
      dispatch,
      subscribe,
    };
  }

  global.CrossXState = {
    createStore,
  };
})(window);
