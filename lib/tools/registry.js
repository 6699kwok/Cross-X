const { createFoodTools } = require("./food");
const { createTravelTools } = require("./travel");

function createToolRegistry({ connectors, payments } = {}) {
  return {
    food: createFoodTools({ connectors, payments }),
    travel: createTravelTools({ connectors, payments }),
  };
}

module.exports = {
  createToolRegistry,
};
