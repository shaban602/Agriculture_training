const app = require("../../backend/app");

const authActions = new Set(["login", "logout", "me"]);

module.exports = (req, res) => {
  const requestPath = req.url.split("?")[0];
  const action = (req.query && req.query.action) || requestPath.split("/").filter(Boolean).pop();

  if (typeof action !== "string" || !authActions.has(action)) {
    return res.status(404).json({ message: "Auth route not found." });
  }

  const queryIndex = req.url.indexOf("?");
  const query = queryIndex === -1 ? "" : req.url.slice(queryIndex);
  req.url = `/api/auth/${action}${query}`;

  return app(req, res);
};
