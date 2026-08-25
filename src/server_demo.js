require('dotenv').config({ path: '.env.demo', quiet: true });

const express = require("express");
const path = require("path");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const voterRouter = require("./routes/voter_demo");
const { clientIp } = require("./lib/clientIp");

const app = express();

// The cloudflared tunnel runs on this host, so only loopback is a trusted proxy.
app.set("trust proxy", "loopback");

const limiterDefaults = {
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req))
};

// Rate limiting (before auth so unauthenticated floods are limited too)
app.use(rateLimit({
  ...limiterDefaults,
  windowMs: 60 * 1000,
  limit: 100,
  message: { error: "Too many requests, please try again later" }
}));

// Basic Auth (enabled if BASIC_AUTH_PASSWORD is set in .env.demo)
if (process.env.BASIC_AUTH_PASSWORD) {
  // Counts only 401 responses, so repeated wrong passwords get throttled
  app.use(rateLimit({
    ...limiterDefaults,
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => res.statusCode !== 401,
    message: { error: "Too many failed authentication attempts, please try again later" }
  }));
  app.use((req, res, next) => {
    const auth = req.headers.authorization || '';
    const [, credentials] = auth.split(' ');
    const [, password] = Buffer.from(credentials || '', 'base64').toString().split(':');
    if (password !== process.env.BASIC_AUTH_PASSWORD) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Demo"');
      return res.status(401).send('Unauthorized');
    }
    next();
  });
  console.log("✓ Basic Auth enabled");
}

app.use("/voter/leaf", rateLimit({
  ...limiterDefaults,
  windowMs: 60 * 1000,
  limit: 20,
  message: { error: "Too many requests to this endpoint, please try again later" }
}));
app.use("/voter/submit-vote", rateLimit({
  ...limiterDefaults,
  windowMs: 60 * 1000,
  limit: 20,
  message: { error: "Too many requests to this endpoint, please try again later" }
}));

app.use(express.json({ limit: '1mb' }));

app.use("/voter", voterRouter);
app.get("/health", (req, res) => res.send("OK"));

// Browser prover: serve the pinned local snarkjs build instead of a CDN copy
const SNARKJS_BROWSER_BUILD = path.join(__dirname, "../node_modules/snarkjs/build/snarkjs.min.js");
app.get("/vendor/snarkjs.min.js", (req, res) => res.sendFile(SNARKJS_BROWSER_BUILD));

// Serve index_demo.html as the default page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index_demo.html"));
});

app.use(express.static(path.join(__dirname, "../public")));

app.listen(4000, () => {
  console.log("✓ Demo server running at http://localhost:4000");
});
