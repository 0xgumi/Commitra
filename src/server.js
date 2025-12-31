
const express = require("express");
const path = require("path");

const voterRouter = require("./routes/voter");

const app = express();
app.use(express.json());

app.use("/voter", voterRouter);
app.get("/health", (req, res) => res.send("OK"));
app.use(express.static(path.join(__dirname, "../public")));

app.listen(5000, () => {
  console.log("✓ Server running at http://localhost:5000");
});
