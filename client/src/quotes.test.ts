import { describe, expect, it } from "vitest";
import source from "../../quotes.md?raw";
import { parseQuotes, quoteScale, quotes, randomQuote } from "./quotes";

describe("parseQuotes", () => {
  it("reads a quote and the name on its last line", () => {
    expect(parseQuotes("There may be an ending, but there is no end.\nYu Miri")).toEqual([
      { lines: ["There may be an ending, but there is no end."], attribution: "Yu Miri", selfQuoted: false }
    ]);
  });

  it("takes the marks off a quote the author wrapped, whichever kind they used", () => {
    expect(parseQuotes('"To me my X-Men!"\nProfessor Xavier')[0].lines).toEqual(["To me my X-Men!"]);
    expect(parseQuotes("“All we have to decide.”\nGandalf")[0].lines).toEqual(["All we have to decide."]);
  });

  it("keeps a verse's lines apart and unwraps it as one quote", () => {
    const [verse] = parseQuotes('"I sang of leaves, of leaves of gold:\nOf wind I sang, a wind there came."\nTolkien');
    expect(verse.lines).toEqual(["I sang of leaves, of leaves of gold:", "Of wind I sang, a wind there came."]);
    expect(verse.selfQuoted).toBe(false);
  });

  it("leaves an exchange its own marks, so the page does not speak both halves at once", () => {
    const [exchange] = parseQuotes("“Don’t you have a religion?”\n“Yes, my survival.”\nIain Banks");
    expect(exchange.lines).toEqual(["“Don’t you have a religion?”", "“Yes, my survival.”"]);
    expect(exchange.selfQuoted).toBe(true);
  });

  it("drops a dash in front of a name, and trailing spaces", () => {
    expect(parseQuotes('"We\'ve had one, yes." \n-Pippin Took')[0]).toMatchObject({
      lines: ["We've had one, yes."],
      attribution: "Pippin Took"
    });
  });

  it("ignores a block that is only a name, or only a quote", () => {
    expect(parseQuotes("Just a line with nobody behind it")).toEqual([]);
  });
});

describe("the quotes file", () => {
  it("gives up every block it holds", () => {
    const blocks = source.split(/\r?\n\s*\r?\n/).filter((block) => block.trim());
    expect(quotes).toHaveLength(blocks.length);
    expect(quotes.length).toBeGreaterThan(20);
  });

  it("leaves no quote without words or a name", () => {
    for (const quote of quotes) {
      expect(quote.attribution).not.toBe("");
      expect(quote.lines.join("").trim()).not.toBe("");
      // A stray mark left on one end reads as a typo on the page.
      expect(quote.selfQuoted || !/^["“]/.test(quote.lines[0])).toBe(true);
    }
  });

  it("holds the one the page opened with before it had a file to read", () => {
    expect(quotes.map((quote) => quote.attribution)).toContain("Thomas Fuller");
  });
});

describe("randomQuote", () => {
  it("reaches the first and the last, and never runs off the end", () => {
    expect(randomQuote(() => 0)).toBe(quotes[0]);
    expect(randomQuote(() => 0.999999)).toBe(quotes.at(-1));
    // Math.random() cannot return 1, but a caller's own source might.
    expect(randomQuote(() => 1)).toBe(quotes.at(-1));
  });
});

describe("quoteScale", () => {
  const of = (length: number) => ({ lines: ["x".repeat(length)], attribution: "Someone", selfQuoted: false });

  it("sets the short ones large and the long ones small", () => {
    expect(quoteScale(of(40))).toBe("short");
    expect(quoteScale(of(90))).toBe("short");
    expect(quoteScale(of(91))).toBe("medium");
    expect(quoteScale(of(200))).toBe("medium");
    expect(quoteScale(of(201))).toBe("long");
  });

  it("measures the whole of a verse rather than its first line", () => {
    expect(quoteScale({ lines: ["x".repeat(80), "y".repeat(80)], attribution: "A", selfQuoted: false })).toBe("medium");
  });
});
