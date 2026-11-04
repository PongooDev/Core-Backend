import { test } from "node:test";
import assert from "node:assert/strict";
import { contentPage } from "../src/services/content/pages.js";

// Save the World's "New Updates" popup showed no text on any build (Core-Backend #234): the page had neither
// survivalmessage nor savetheworldnews.
const builds = [3541083, 3700114, 3724489, 3757339, 3790078, 3889387, 3915963, 3935073, 3942182, undefined];

test("every build gets the Save the World message in survivalmessage and savetheworldnews", () => {
  for (const build of builds) {
    const page = contentPage(undefined, undefined, build === undefined ? undefined : String(build));
    const message = page.survivalmessage.overrideablemessage.message;
    assert.ok(message.title && message.body, `survivalmessage on ${build}`);
    const [news] = page.savetheworldnews.news.messages;
    assert.equal(news.title, message.title);
    assert.equal(news.body, message.body);
    assert.equal(news.hidden, false);
  }
});

test("a configured Save the World message replaces the default, with {version} filled in", () => {
  const page = contentPage(undefined, undefined, "3935073", undefined, undefined, { title: "News {version}", body: "Hello" });
  assert.equal(page.survivalmessage.overrideablemessage.message.title, "News 3.2");
  assert.equal(page.savetheworldnews.news.messages[0].body, "Hello");
});
