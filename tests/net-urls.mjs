globalThis.window = {};
globalThis.location = {
  protocol: "http:",
  host: "127.0.0.1:8090",
  hostname: "127.0.0.1",
};

const { normalizeWsUrl, joinCandidates, expandJoinCandidates, defaultWsUrl } =
  await import("../public/js/net.js");

function assert(cond, label) {
  if (!cond) {
    console.error("FAIL", label);
    process.exitCode = 1;
  } else {
    console.log("ok", label);
  }
}

assert(normalizeWsUrl("192.168.1.5") === "ws://192.168.1.5/ws", "bare host normalized");
assert(normalizeWsUrl("http://192.168.1.5:8080") === "ws://192.168.1.5:8080/ws", "http converted to ws");
assert(normalizeWsUrl("ws://192.168.1.5:8080") === "ws://192.168.1.5:8080/ws", "ws path added");

const direct = joinCandidates("ws://192.168.1.5:8080/ws");
assert(direct.length === 2 && direct[1].endsWith(":8081/ws"), "8080 -> 8081 fallback");

const bare = joinCandidates("192.168.1.5");
assert(bare[0].includes(":8080/ws"), "bare host tries 8080 first");
assert(bare[1].includes(":8081/ws"), "bare host tries relay second");

assert(defaultWsUrl() === "ws://127.0.0.1:8090/ws", "page origin ws url");

const expanded = await expandJoinCandidates("http://127.0.0.1:8090", 1500);
assert(expanded.includes("ws://127.0.0.1:8090/ws"), "status discovery keeps ws port");

console.log(JSON.stringify({ direct, bare, expanded }, null, 2));
