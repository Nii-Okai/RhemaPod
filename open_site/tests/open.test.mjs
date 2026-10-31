import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { appUrlForPath, detectPlatform, init } = require("../open.js");

const ID = "0b9f6c1e-3a4d-4e8b-9c2f-1d7a5e6b8c90";

for (const type of ["sermon", "series", "playlist"]) {
  test(`valid ${type} uuid maps to rhemapod://`, () => {
    assert.equal(appUrlForPath(`/${type}/${ID}`), `rhemapod://${type}/${ID}`);
  });
}

test("uppercase uuid accepted", () => {
  assert.equal(appUrlForPath(`/sermon/${ID.toUpperCase()}`), `rhemapod://sermon/${ID}`);
});

test("trailing slash accepted", () => {
  assert.equal(appUrlForPath(`/series/${ID}/`), `rhemapod://series/${ID}`);
});

for (const [name, p] of [
  ["/playlist/create", "/playlist/create"],
  ["non-uuid", "/sermon/not-a-uuid"],
  ["short uuid", "/sermon/0b9f6c1e-3a4d-4e8b-9c2f"],
  ["extra segment", `/sermon/${ID}/extra`],
  ["unknown type", `/user/${ID}`],
  ["javascript-ish", "/sermon/javascript:alert(1)"],
  ["javascript in id slot", `/sermon/${ID}"><script>`],
  ["encoded path", `/sermon/%30b9f6c1e-3a4d-4e8b-9c2f-1d7a5e6b8c90`],
  ["encoded slash", `/sermon%2F${ID}`],
  ["empty", ""],
  ["root", "/"],
]) {
  test(`rejected: ${name}`, () => assert.equal(appUrlForPath(p), null));
}

test("UA to platform", () => {
  assert.equal(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5), "ios");
  assert.equal(detectPlatform("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", 5), "ios");
  assert.equal(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), "ios");
  assert.equal(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0), "other");
  assert.equal(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)", 5), "android");
  assert.equal(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0), "other");
  assert.equal(detectPlatform("", undefined), "other");
});

function fakeDoc() {
  const mk = (hidden) => ({ hidden, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  const els = {
    "open-app": mk(true),
    "badge-ios": mk(false),
    "badge-android": mk(false),
    "phone-hint": mk(true),
  };
  return { els, getElementById: (id) => els[id] ?? null };
}

test("init: iOS shows App Store only and sets the href", () => {
  const d = fakeDoc();
  init(d, { pathname: `/sermon/${ID}` }, { userAgent: "iPhone", maxTouchPoints: 5 });
  assert.equal(d.els["open-app"].attrs.href, `rhemapod://sermon/${ID}`);
  assert.equal(d.els["open-app"].hidden, false);
  assert.equal(d.els["badge-android"].hidden, true);
  assert.equal(d.els["badge-ios"].hidden, false);
  assert.equal(d.els["phone-hint"].hidden, true);
});

test("init: Android shows Play only", () => {
  const d = fakeDoc();
  init(d, { pathname: `/series/${ID}` }, { userAgent: "Android", maxTouchPoints: 5 });
  assert.equal(d.els["badge-ios"].hidden, true);
  assert.equal(d.els["badge-android"].hidden, false);
});

test("init: desktop shows both badges and the phone hint; invalid path hides the button", () => {
  const d = fakeDoc();
  d.els["open-app"].hidden = false;
  init(d, { pathname: "/playlist/create" }, { userAgent: "Windows", maxTouchPoints: 0 });
  assert.equal(d.els["open-app"].hidden, true);
  assert.equal("href" in d.els["open-app"].attrs, false);
  assert.equal(d.els["badge-ios"].hidden, false);
  assert.equal(d.els["badge-android"].hidden, false);
  assert.equal(d.els["phone-hint"].hidden, false);
});

test("static pages carry no inline script/style, no content id, no auto-redirect", () => {
  for (const f of ["open.html", "index.html"]) {
    const html = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/i, `${f}: inline script`);
    assert.doesNotMatch(html, /<style/i, `${f}: style block`);
    assert.doesNotMatch(html, /\sstyle=|\son[a-z]+=/i, `${f}: inline style/handler`);
    assert.doesNotMatch(html, /http-equiv=["']refresh/i, `${f}: refresh`);
  }
  const open = readFileSync(new URL("../open.html", import.meta.url), "utf8");
  assert.match(open, /noindex,nofollow/);
  assert.match(open, /app-id=6828878983/);
  assert.doesNotMatch(open, /app-argument/);
});

test("association files have the contracted shape", () => {
  const aasa = JSON.parse(readFileSync(new URL("../.well-known/apple-app-site-association", import.meta.url), "utf8"));
  const d = aasa.applinks.details[0];
  assert.deepEqual(d.appIDs, ["FAND2W5VMM.com.niitech.rhemapod"]);
  assert.deepEqual(d.components[0], { "/": "/playlist/create", exclude: true });
  assert.deepEqual(d.components.slice(1).map((c) => c["/"]), ["/sermon/*", "/series/*", "/playlist/*"]);
  const al = JSON.parse(readFileSync(new URL("../.well-known/assetlinks.json", import.meta.url), "utf8"));
  assert.equal(al[0].target.package_name, "com.niitech.rhemapod");
  assert.match(al[0].target.sha256_cert_fingerprints[0], /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
});
