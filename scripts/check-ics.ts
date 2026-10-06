/**
 * Unit-style checks for the hand-rolled iCalendar writer (src/lib/ics.ts).
 *   npx tsx scripts/check-ics.ts
 *
 * Bugs these catch:
 *  - folding by UTF-16 length instead of UTF-8 octets (lines > 75 bytes with emoji / "—")
 *  - splitting a multi-byte character or surrogate pair across a fold
 *  - forgetting that the continuation line's leading space counts toward 75 octets
 *  - missing / wrong-order escaping of \ ; , and newlines (double-escaping the backslash)
 *  - LF instead of CRLF line endings, or a missing final CRLF
 *  - local-time instead of UTC "Z" DATE-TIME values
 */
import assert from "node:assert/strict";
import { buildCalendar, escapeText, foldLine, formatUtc } from "../src/lib/ics";

const enc = new TextEncoder();
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

/** Reverse RFC 5545 unfolding: CRLF followed by one space/tab is removed. */
const unfold = (s: string) => s.replace(/\r\n[ \t]/g, "");
/** Reverse TEXT escaping. */
const unescape = (s: string) => s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

check("escapeText escapes backslash first, then ; , and newlines", () => {
  assert.equal(escapeText("a\\b;c,d\ne\r\nf\rg"), "a\\\\b\\;c\\,d\\ne\\nf\\ng");
  // A literal backslash-n in the input must not turn into a newline after a round trip.
  assert.equal(unescape(escapeText("C:\\new")), "C:\\new");
});

check("formatUtc writes UTC with Z", () => {
  assert.equal(formatUtc(new Date("2026-10-07T22:00:00.000Z")), "20261007T220000Z");
  assert.equal(formatUtc(new Date("2026-10-07T18:00:00-04:00")), "20261007T220000Z");
});

const tricky =
  "SUMMARY:" +
  escapeText(
    "Maya: Pirates rehearsal — Act 1, Sc 3; \"Poor Wand'ring One\" 🏴‍☠️🎭 with Ms. Ñúñez\\Choreo\nBring water, shoes; and your script! " +
      "日本語のテキストも折り返しに含まれます。".repeat(3),
  );

check("foldLine keeps every physical line ≤ 75 octets", () => {
  const folded = foldLine(tricky);
  const physical = folded.split("\r\n");
  assert.ok(physical.length > 3, "expected several folds");
  for (const [i, line] of physical.entries()) {
    assert.ok(enc.encode(line).length <= 75, `line ${i} is ${enc.encode(line).length} octets`);
    if (i > 0) assert.equal(line[0], " ", "continuation must start with a space");
  }
});

check("foldLine never splits a UTF-8 sequence or surrogate pair", () => {
  const folded = foldLine(tricky);
  for (const line of folded.split("\r\n")) {
    // A lone surrogate at either end would mean a split pair.
    assert.ok(!/[\uD800-\uDBFF]$/.test(line) && !/^ ?[\uDC00-\uDFFF]/.test(line), "split surrogate pair");
    // Re-encoding must round-trip (no U+FFFD from a broken sequence).
    assert.ok(!new TextDecoder().decode(enc.encode(line)).includes("\uFFFD"));
  }
  assert.equal(unfold(folded), tricky, "unfolding must restore the original line exactly");
});

check("foldLine leaves short lines alone and handles exactly-75-octet lines", () => {
  assert.equal(foldLine("SUMMARY:short"), "SUMMARY:short");
  const exact = "X".repeat(75);
  assert.equal(foldLine(exact), exact);
  const over = "X".repeat(76);
  assert.equal(foldLine(over), "X".repeat(75) + "\r\n X");
});

check("buildCalendar: CRLF everywhere, escaped round trip, required props", () => {
  const description = "Line one, with comma; semicolon\nLine two \\ backslash — 🎭";
  const ics = buildCalendar({
    name: "Calltime — Dana, Rivera",
    refresh: "PT1H",
    events: [
      {
        uid: "ev1-p1@calltime",
        start: new Date("2026-10-07T22:00:00Z"),
        end: new Date("2026-10-07T23:30:00Z"),
        summary: "Maya: Pirates rehearsal (called 6:00–7:30 PM)",
        description,
        location: "Hall, Room B; upstairs",
        status: "CANCELLED",
        sequence: 3,
      },
    ],
  });
  assert.ok(ics.endsWith("\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "bare LF found");
  const lines = unfold(ics).split("\r\n");
  const get = (name: string) => lines.find((l) => l.startsWith(name + ":") || l.startsWith(name + ";"));
  assert.equal(get("X-WR-CALNAME"), "X-WR-CALNAME:Calltime — Dana\\, Rivera");
  assert.equal(get("REFRESH-INTERVAL"), "REFRESH-INTERVAL;VALUE=DURATION:PT1H");
  assert.equal(get("X-PUBLISHED-TTL"), "X-PUBLISHED-TTL:PT1H");
  assert.equal(get("DTSTART"), "DTSTART:20261007T220000Z");
  assert.equal(get("DTEND"), "DTEND:20261007T233000Z");
  assert.equal(get("SEQUENCE"), "SEQUENCE:3");
  assert.equal(get("STATUS"), "STATUS:CANCELLED");
  assert.equal(get("UID"), "UID:ev1-p1@calltime");
  assert.ok(get("DTSTAMP")?.match(/^DTSTAMP:\d{8}T\d{6}Z$/));
  const descLine = lines.find((l) => l.startsWith("DESCRIPTION:") && l.includes("Line one"))!;
  assert.equal(unescape(descLine.slice("DESCRIPTION:".length)), description);
  for (const l of ics.split("\r\n")) assert.ok(enc.encode(l).length <= 75);
});

console.log(`\n${passed} checks passed`);
