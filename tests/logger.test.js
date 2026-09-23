import { test } from "node:test";
import assert from "node:assert/strict";
import { Logger } from "../src/logger.js";

function capture(level = "debug") {
  const lines = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  const logger = new Logger({ level, file: null });
  return {
    logger,
    lines,
    restore() {
      process.stderr.write = orig;
      logger.close();
    },
  };
}

test("logger writes JSON lines with ts/level/event", () => {
  const c = capture();
  try {
    c.logger.info("hello", { a: 1 });
    assert.equal(c.lines.length, 1);
    const rec = JSON.parse(c.lines[0]);
    assert.equal(rec.event, "hello");
    assert.equal(rec.a, 1);
    assert.ok(rec.ts);
    assert.ok(rec.level.startsWith("INFO"));
  } finally {
    c.restore();
  }
});

test("logger filters below configured level", () => {
  const c = capture("warn");
  try {
    c.logger.debug("nope", {});
    c.logger.info("nope", {});
    c.logger.warn("yes", {});
    assert.equal(c.lines.length, 1);
    assert.match(c.lines[0], /"yes"/);
  } finally {
    c.restore();
  }
});

test("logger redacts sensitive keys", () => {
  const c = capture();
  try {
    c.logger.info("evt", {
      apiKey: "super-secret",
      password: "hunter2",
      Authorization: "Bearer x",
      nested: { token: "abc", plain: "ok" },
    });
    const rec = JSON.parse(c.lines[0]);
    assert.equal(rec.apiKey, "[redacted]");
    assert.equal(rec.password, "[redacted]");
    assert.equal(rec.Authorization, "[redacted]");
    assert.equal(rec.nested.token, "[redacted]");
    assert.equal(rec.nested.plain, "ok");
  } finally {
    c.restore();
  }
});
