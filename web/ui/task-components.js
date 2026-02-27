(function createCrossXTaskComponents(global) {
  function esc(input) {
    return String(input || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setPanel(root, html) {
    if (!root) return;
    root.innerHTML = html || "";
    if (html) root.classList.remove("section-hidden");
    else root.classList.add("section-hidden");
  }

  const TopBar = {
    sync() {
      // Keep topbar DOM ownership in app.js. This component is reserved for future extension.
    },
  };

  const ChatTimeline = {
    sync() {
      // Message rendering stays in app.js addMessage pipeline.
    },
  };

  const TaskStatusCard = {
    render(root, payload) {
      if (!root) return;
      if (!payload || payload.visible !== true) {
        setPanel(root, "");
        return;
      }
      const chips = Array.isArray(payload.chips) ? payload.chips : [];
      const actions = payload.actions || {};
      setPanel(
        root,
        `
        <h3>${esc(payload.title || "Task status")}</h3>
        <div class="status">${esc(payload.stateLabel || "State")}: <span class="status-badge ${esc(payload.stateClass || "queued")}">${esc(payload.stateText || "-")}</span></div>
        <div class="status">${esc(payload.summaryLabel || "Summary")}: ${chips.length ? chips.map((chip) => esc(chip)).join(" ") : esc(payload.summaryFallback || "-")}</div>
        <div class="status">${esc(payload.stepLabel || "Current step")}: ${esc(payload.currentStep || "-")}</div>
        <div class="actions">
          <button class="secondary" data-action="agent-open-condition-editor">${esc(actions.modify || "Modify")}</button>
          <button class="secondary" data-action="agent-switch-backup">${esc(actions.switchBackup || "Switch backup")}</button>
        </div>
      `,
      );
    },
  };

  const PlanCard = {
    render(option, opts = {}) {
      const safe = option && typeof option === "object" ? option : {};
      const reasons = Array.isArray(safe.reasons) ? safe.reasons.slice(0, 3) : [];
      const comments = Array.isArray(safe.comments) ? safe.comments.slice(0, 2) : [];
      const key = String(safe.key || (opts.primary ? "main" : "backup"));
      return `
        <article class="inline-block agent-option-card ${opts.primary ? "agent-option-primary" : ""}">
          <img class="agent-option-image media-photo" src="${esc(safe.imagePath || "/assets/solution-flow.svg")}" alt="${esc(safe.title || "option")}" />
          <h3>${esc(safe.title || "-")}</h3>
          <div class="status">${esc(opts.placeLabel || "Place/Route")}: ${esc(safe.place || "-")}</div>
          <div class="status">ETA ${Number(safe.eta || 0)} min · ${esc(opts.amountLabel || "Amount")} ${Number(safe.amount || 0)} CNY</div>
          ${safe.risk ? `<div class="status">${esc(opts.riskLabel || "Risk")}: ${esc(safe.risk)}</div>` : ""}
          ${reasons.length ? `<ul class="steps agent-option-reasons">${reasons.map((reason) => `<li>${esc(reason)}</li>`).join("")}</ul>` : ""}
          ${comments.length ? `<div class="status">${comments.map((comment) => esc(comment)).join(" · ")}</div>` : ""}
          <div class="actions">
            <button ${opts.primary ? "" : 'class="secondary"'} data-action="agent-request-execute" data-option="${esc(key)}">${esc(opts.executeLabel || "Execute")}</button>
          </div>
        </article>
      `;
    },
  };

  const PlanCardsSection = {
    render(root, payload) {
      if (!root) return;
      if (!payload || payload.visible !== true) {
        setPanel(root, "");
        return;
      }
      const mainCard = PlanCard.render(payload.mainOption, {
        primary: true,
        placeLabel: payload.placeLabel,
        amountLabel: payload.amountLabel,
        riskLabel: payload.riskLabel,
        executeLabel: payload.mainExecuteLabel,
      });
      const backupCard = PlanCard.render(payload.backupOption, {
        primary: false,
        placeLabel: payload.placeLabel,
        amountLabel: payload.amountLabel,
        riskLabel: payload.riskLabel,
        executeLabel: payload.backupExecuteLabel,
      });
      const comboSteps = Array.isArray(payload.comboSteps) ? payload.comboSteps : [];
      setPanel(
        root,
        `
        <h3>${esc(payload.title || "Plan options")}</h3>
        <div class="status">${esc(payload.summary || "")}</div>
        ${comboSteps.length ? `<ol class="steps">${comboSteps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>` : ""}
        <div class="agent-plan-grid">${mainCard}${backupCard}</div>
      `,
      );
    },
  };

  const ConfirmCard = {
    render(root, payload) {
      if (!root) return;
      if (!payload || payload.visible !== true) {
        setPanel(root, "");
        return;
      }
      setPanel(
        root,
        `
        <h3>${esc(payload.title || "Confirm")}</h3>
        <div class="status">${esc(payload.summary || "")}</div>
        <div class="status">${esc(payload.amountLabel || "Amount")}: <strong>${Number(payload.amount || 0)} CNY</strong></div>
        <details class="plan-details">
          <summary>${esc(payload.breakdownLabel || "Fee breakdown")}</summary>
          <ul class="steps">
            <li>${esc(payload.breakdownMerchant || "Merchant")}: ${Number(payload.merchantAmount || 0)} CNY</li>
            <li>${esc(payload.breakdownService || "Service")}: ${Number(payload.serviceAmount || 0)} CNY</li>
            <li>${esc(payload.breakdownThird || "Third-party")}: ${Number(payload.thirdAmount || 0)} CNY</li>
          </ul>
        </details>
        <div class="status">${esc(payload.cancelPolicy || "")}</div>
        <div class="actions">
          <button data-action="agent-confirm-execution" data-option="${esc(payload.optionKey || "main")}">${esc(payload.confirmLabel || "Confirm and execute")}</button>
          <button class="secondary" data-action="agent-open-condition-editor">${esc(payload.modifyLabel || "Modify")}</button>
          <button class="secondary" data-action="agent-cancel-confirm">${esc(payload.cancelLabel || "Cancel")}</button>
        </div>
      `,
      );
    },
  };

  const ExecutionStepsList = {
    render(root, payload) {
      if (!root) return;
      if (!payload || payload.visible !== true) {
        setPanel(root, "");
        return;
      }
      const steps = Array.isArray(payload.steps) ? payload.steps : [];
      setPanel(
        root,
        `
        <h3>${esc(payload.title || "Execution")}</h3>
        <div class="status">${esc(payload.statusLabel || "Status")}: <span class="status-badge ${esc(payload.statusClass || "queued")}">${esc(payload.statusText || "-")}</span></div>
        <div class="status">${esc(payload.progressLabel || "Progress")}: ${Number(payload.done || 0)}/${Number(payload.total || 0)}</div>
        <ol class="steps">
          ${steps
            .map((step) => {
              return `<li class="step-line"><strong>${esc(step.label || "-")}</strong> <span class="status-badge ${esc(step.badge || "queued")}">${esc(step.statusText || "-")}</span>${step.reason ? `<div class="status">${esc(step.reason)}</div>` : ""}</li>`;
            })
            .join("")}
        </ol>
      `,
      );
    },
  };

  const ExecutionResultCard = {
    render(root, payload) {
      if (!root) return;
      if (!payload || payload.visible !== true) {
        setPanel(root, "");
        return;
      }
      const actions = payload.actions || {};
      setPanel(
        root,
        `
        <h3>${esc(payload.title || "Result")}</h3>
        <div class="status">${esc(payload.summary || "")}</div>
        ${payload.orderId ? `<div class="status">Order: <span class="code">${esc(payload.orderId)}</span></div>` : ""}
        <div class="actions">
          ${actions.primaryLabel ? `<button class="secondary" data-action="agent-nav">${esc(actions.primaryLabel)}</button>` : ""}
          ${
            actions.backupLabel
              ? `<button class="secondary" data-action="${esc(actions.backupAction || "agent-request-execute")}" ${actions.backupAction === "agent-request-execute" || !actions.backupAction ? 'data-option="backup"' : ""}>${esc(actions.backupLabel)}</button>`
              : ""
          }
          ${actions.replanLabel ? `<button data-action="agent-switch-backup">${esc(actions.replanLabel)}</button>` : ""}
          ${actions.retryLabel ? `<button class="secondary" data-action="agent-retry-run">${esc(actions.retryLabel)}</button>` : ""}
        </div>
      `,
      );
    },
  };

  const InputDock = {
    sync(root, payload) {
      if (!root || !payload) return;
      if (payload.placeholder && payload.input) {
        payload.input.placeholder = payload.placeholder;
      }
    },
  };

  const VoiceButton = {
    apply(button, payload) {
      if (!button) return;
      const safe = payload || {};
      const state = String(safe.state || "idle");
      const label = String(safe.label || "");
      button.dataset.voiceState = state;
      button.classList.toggle("is-on", state !== "idle");
      button.classList.toggle("is-listening", state === "listening");
      button.classList.toggle("is-speaking", state === "speaking");
      button.classList.toggle("is-processing", state === "processing");
      button.classList.toggle("is-interrupted", state === "interrupted");
      button.classList.toggle("is-error", state === "error");
      if (safe.iconOnly) {
        // Keep the SVG mic icon if it's already there; only update the sr-only label
        const existingSvg = button.querySelector("svg");
        if (existingSvg) {
          let srOnly = button.querySelector(".sr-only");
          if (!srOnly) { srOnly = document.createElement("span"); srOnly.className = "sr-only"; button.appendChild(srOnly); }
          srOnly.textContent = label;
        } else {
          button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mic-icon" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg><span class="sr-only">${esc(label)}</span>`;
        }
        if (label) {
          button.setAttribute("title", label);
          button.setAttribute("aria-label", label);
        }
      } else if (safe.label) {
        button.textContent = label;
      }
      if (typeof safe.ariaPressed === "boolean") button.setAttribute("aria-pressed", safe.ariaPressed ? "true" : "false");
      if (typeof safe.disabled === "boolean") button.disabled = safe.disabled;
    },
  };

  const ConditionEditorDrawer = {
    open(controller, drawer, trigger) {
      if (!drawer) return;
      if (controller && typeof controller.open === "function") {
        controller.open(drawer, { trigger });
      } else {
        drawer.classList.remove("hidden");
        drawer.setAttribute("aria-hidden", "false");
      }
    },
    close(controller, drawer) {
      if (!drawer) return;
      if (controller && typeof controller.close === "function") {
        controller.close(drawer);
      } else {
        drawer.classList.add("hidden");
        drawer.setAttribute("aria-hidden", "true");
      }
    },
  };

  global.CrossXTaskComponents = {
    TopBar,
    ChatTimeline,
    TaskStatusCard,
    ExecutionStepsList,
    PlanCardsSection,
    PlanCard,
    ConfirmCard,
    ExecutionResultCard,
    InputDock,
    VoiceButton,
    ConditionEditorDrawer,
  };
})(window);
