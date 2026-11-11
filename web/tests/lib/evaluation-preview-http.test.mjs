/**
 * Optional built-dashboard HTTP acceptance. Set both environment variables and
 * run this against an ISOLATED local preview server. No valid model request is
 * sent by this test; it cannot consume a free-model attempt.
 */
import test from "node:test";
import assert from "node:assert/strict";

const base = process.env.CAREER_OPS_PREVIEW_HTTP_BASE;
const token = process.env.CAREER_OPS_PREVIEW_TOKEN;
const configured = Boolean(base && token);
if (configured && !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(base)) {
  throw new Error("HTTP acceptance is restricted to an explicit loopback server.");
}
const url = configured ? base + "/api/evaluation-preview" : null;
const validInput = {
  evaluationOnly: true,
  postingUrl: "https://example.com/jobs/acceptance-only",
  jobDescription: "An intentionally synthetic Data Engineer testing description. ".repeat(6),
};
const request = (headers, body = validInput) => fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

test("built preview HTTP: missing and invalid tokens cannot start a model", { skip: !configured }, async () => {
  const absent = await request({});
  assert.equal(absent.status, 401);
  const wrong = await request({ "x-career-ops-preview-token": "a".repeat(64) });
  assert.equal(wrong.status, 401);
});

test("built preview HTTP: hostile Origin fails before reading the request body", { skip: !configured }, async () => {
  const result = await request({
    "x-career-ops-preview-token": token,
    origin: "https://untrusted.example",
  });
  assert.equal(result.status, 403);
});

test("built preview HTTP: valid token still needs explicit evaluation-only input", { skip: !configured }, async () => {
  const result = await request({ "x-career-ops-preview-token": token },
    { ...validInput, evaluationOnly: false });
  assert.equal(result.status, 400);
});

test("built preview HTTP: authorized malformed input does not consume model allowance", { skip: !configured }, async () => {
  const result = await request({ "x-career-ops-preview-token": token },
    { ...validInput, jobDescription: "short" });
  assert.equal(result.status, 400);
});
