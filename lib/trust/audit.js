function createAuditLogger({ appendFn, readFn }) {
  return {
    append(event) {
      appendFn(event);
    },
    readRecent(limit = 20) {
      return readFn(limit);
    },
  };
}

module.exports = {
  createAuditLogger,
};
