function createConfirmPolicy({ getSingleLimit }) {
  return {
    verifyIntent({ amount, secondFactor }) {
      const threshold = Number(getSingleLimit() || 0);
      const needs2FA = Number(amount || 0) > threshold;
      if (needs2FA && !secondFactor) {
        return { verified: false, reason: "2FA required", threshold };
      }
      return { verified: true, threshold };
    },
  };
}

module.exports = {
  createConfirmPolicy,
};
