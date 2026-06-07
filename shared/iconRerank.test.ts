import { test } from "node:test";
import assert from "node:assert/strict";
import { setRerank } from "./iconRerankCache";
import { resolveOpenMojiAssetInfo } from "./openMojiAssets";
import { normalizeQuery } from "./openMojiEmbeddings";

// The context-aware rerank decision must win over raw embedding/keyword matching.
test("resolver prefers a context-aware rerank choice", () => {
  const key = "polysemyTestConcept";
  const hint = "river bank water nature";
  const qk = normalizeQuery(key, hint);
  setRerank(qk, {
    iconRef: "openmoji:1F3DE",
    svgPath: "assets/vendor/openmoji/color/1F3DE.svg",
    label: "national park",
    source: "local-openmoji",
  });
  const res = resolveOpenMojiAssetInfo(key, hint, undefined, true);
  assert.ok(res, "resolver should return a result");
  assert.equal(res?.iconRef, "openmoji:1F3DE", "should use the reranked icon");
  assert.equal(res?.provider, "local-openmoji");
});

test("rerank choice is skipped when that icon is already used in the scene (dedup)", () => {
  const key = "polysemyTestConcept2";
  const hint = "computer mouse pointer";
  const qk = normalizeQuery(key, hint);
  setRerank(qk, {
    iconRef: "excali:some-mouse",
    svgPath: "assets/vendor/excalidraw/svg/some-mouse.svg",
    label: "computer mouse",
    source: "excalidraw",
  });
  // Excluding that exact ref forces a fall-through (not the rerank pick).
  const res = resolveOpenMojiAssetInfo(key, hint, new Set(["excali:some-mouse"]), true);
  assert.ok(!res || res.iconRef !== "excali:some-mouse", "should not reuse an excluded icon");
});
