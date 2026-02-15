require('dotenv').config({ path: '.env.demo', quiet: true });

const express = require("express");
const path = require("path");

const voterRouter = require("./routes/voter_demo");

const app = express();

// Basic Auth (enabled if BASIC_AUTH_PASSWORD is set in .env.demo)
if (process.env.BASIC_AUTH_PASSWORD) {
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

app.use(express.json());

app.use("/voter", voterRouter);
app.get("/health", (req, res) => res.send("OK"));

// Serve index_demo.html as the default page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index_demo.html"));
});

app.use(express.static(path.join(__dirname, "../public")));

app.listen(4000, () => {
  console.log("✓ Demo server running at http://localhost:4000");
});
