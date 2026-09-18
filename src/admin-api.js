const path = require("path");

function tokenFromRequest(req) {
  const authorization = req.get("authorization") || "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7);
  return req.query.token || "";
}

function mountAdminApi(app, repository, adminEvents, options = {}) {
  const adminDirectory = options.adminDirectory || path.join(__dirname, "..", "public", "admin");

  app.get("/admin", (_req, res) => res.sendFile(path.join(adminDirectory, "index.html")));
  app.use("/admin", require("express").static(adminDirectory));

  app.use("/api/admin", (req, res, next) => {
    const configuredToken = process.env.ADMIN_TOKEN;
    if (!configuredToken || tokenFromRequest(req) === configuredToken) return next();
    return res.status(401).json({ error: "Unauthorized" });
  });

  app.get("/api/admin/summary", (_req, res) => res.json(repository.getSummary()));

  app.get("/api/admin/calls", (req, res) => {
    res.json({ calls: repository.listCalls({ limit: req.query.limit }) });
  });

  app.get("/api/admin/calls/:id", (req, res) => {
    const call = repository.getCallDetail(req.params.id);
    if (!call) return res.status(404).json({ error: "Call not found" });
    return res.json(call);
  });

  app.get("/api/admin/live", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(`event: ready\ndata: ${JSON.stringify({ connected: true })}\n\n`);

    const unsubscribe = adminEvents.subscribe(event => {
      res.write(`event: call-update\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20000);
    heartbeat.unref?.();

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}

module.exports = { mountAdminApi, tokenFromRequest };

