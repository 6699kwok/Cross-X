const { buildPlan } = require("./planner");
const { executePlan } = require("./runner");

function createOrchestrator({ tools, audit }) {
  const lastFoodQuery = new Map();

  return {
    planTask({ taskId, userId, intent, constraints, silent = false }) {
      const lastUserQuery = lastFoodQuery.get(userId);
      const plan = buildPlan({ taskId, intent, constraints, lastUserQuery });
      if (!silent && plan.intentType === "eat") {
        lastFoodQuery.set(userId, intent);
      }
      if (!silent) {
        audit.append({
          kind: "plan",
          who: userId,
          what: "task.plan.generated",
          taskId,
          toolInput: { intent, constraints },
          toolOutput: { title: plan.title, stepCount: plan.steps.length },
        });
      }
      return plan;
    },

    async executeTask({ task, userId }) {
      const result = await executePlan({
        plan: task.plan,
        tools,
        amount: task.plan.confirm.amount,
        currency: task.plan.confirm.currency,
        userId,
        taskId: task.id,
        paymentRail: task.paymentRailSnapshot || (task.plan.confirm && task.plan.confirm.paymentRail),
      });

      audit.append({
        kind: "execution",
        who: userId,
        what: "task.executed",
        taskId: task.id,
        toolInput: { steps: task.plan.steps.map((s) => s.toolType) },
        toolOutput: { success: true, events: result.timeline.length },
      });

      return result;
    },
  };
}

module.exports = {
  createOrchestrator,
};
