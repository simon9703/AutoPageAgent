import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { InspectedElement } from "@auto-page-agent/shared";
import { createRepositoryQueryTerms, LocalRepositoryProvider } from "../src/repositories.js";

const element: InspectedElement = {
  tagName: "input",
  role: "textbox",
  label: "Estimated arrival time",
  text: "",
  placeholder: "Arrival time",
  attributes: { name: "estimatedArrivalTime", "data-testid": "arrival-time" },
  nearbyText: "Withdrawal details",
  source: { component: "ArrivalTime", file: "src/ArrivalTime.tsx", repository: "payments-web" },
};

test("query terms prioritize explicit source metadata", () => {
  const terms = createRepositoryQueryTerms(element);
  assert.deepEqual(terms.slice(0, 2).map((term) => [term.value, term.confidence]), [
    ["src/ArrivalTime.tsx", "high"],
    ["ArrivalTime", "high"],
  ]);
  assert.ok(terms.some((term) => term.value === "estimatedArrivalTime"));
});

test("repository analysis reports a clear warning without configured roots", async () => {
  const result = await new LocalRepositoryProvider([]).analyze(element);
  assert.equal(result.evidence.length, 0);
  assert.match(result.warnings[0] ?? "", /No local repositories/u);
});

test("repository analysis finds direct source and API evidence", async () => {
  const root = fileURLToPath(new URL("./fixtures/sample-repo", import.meta.url));
  const result = await new LocalRepositoryProvider([{ name: "payments-web", path: root }]).analyze(element, [{
    url: "https://example.com/api/v2/withdrawal/detail",
    pathname: "/api/v2/withdrawal/detail",
    initiatorType: "fetch",
    duration: 320,
    transferSize: 1024,
  }]);
  assert.ok(result.evidence.some((item) => item.kind === "source" && item.confidence === "high"));
  assert.ok(result.evidence.some((item) => item.kind === "api"));
  assert.ok(result.queryTerms.includes("/api/v2/withdrawal/detail"));
});
