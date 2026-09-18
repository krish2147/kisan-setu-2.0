const { EventEmitter } = require("events");

function createAdminEvents() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);

  return {
    publish(event) {
      emitter.emit("update", event);
    },
    subscribe(listener) {
      emitter.on("update", listener);
      return () => emitter.off("update", listener);
    }
  };
}

module.exports = { createAdminEvents };

