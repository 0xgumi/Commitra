// Requests reach the origin either directly or through the cloudflared tunnel
// running on this host. CF-Connecting-IP is only trustworthy when the TCP peer
// is the local tunnel process; a direct client could set the header itself.
const LOOPBACK_PEERS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function clientIp(req) {
  const peer = req.socket && req.socket.remoteAddress;
  const cf = req.headers["cf-connecting-ip"];
  if (peer && LOOPBACK_PEERS.has(peer) && typeof cf === "string" && cf.length > 0) {
    return cf.split(",")[0].trim();
  }
  return req.ip;
}

module.exports = { clientIp };
