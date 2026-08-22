import source from "../../quotes.md?raw";

/**
 * The quotes on the landing page, read from `quotes.md` at the root of the
 * repository.
 *
 * The file stays as it is written — a quote, its attribution on the last line,
 * a blank line, the next — rather than becoming a generated JSON list beside
 * it. There would be two files to keep level with each other and a build step
 * standing between adding a quote and seeing it, and nothing here needs what
 * that would buy: the whole file is a few kilobytes, it is read once as the
 * module loads, and a quote is added by typing one.
 */
export interface Quote {
  /** The quote's lines, kept apart so a verse or an exchange stays one. */
  lines: string[];
  attribution: string;
  /**
   * Whether the lines carry quotation marks of their own, which is the page's
   * signal not to add a pair. True only of an exchange between two speakers,
   * where one pair around the whole thing would put both halves in one mouth.
   */
  selfQuoted: boolean;
}

const openers = '"“‘«';
const closers = '"”’»';

const opens = (line: string) => openers.includes(line[0] ?? "");
const closes = (line: string) => closers.includes(line.at(-1) ?? "");

export function parseQuotes(markdown: string): Quote[] {
  return markdown
    .split(/\r?\n\s*\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
    .filter((lines) => lines.length >= 2)
    .map((lines) => {
      // The last line names who said it, sometimes behind a dash — of which
      // there are several, and a file typed in more than one editor has met
      // most of them. The page draws its own, so any of them here would come
      // out doubled.
      const attribution = lines.pop()!.replace(/^[-‒–—―−]\s*/, "");
      // Three shapes are written in the file, and they differ in exactly the
      // way that matters to a page adding marks of its own: a quote with no
      // marks at all, one the author wrapped from its first line to its last,
      // and an exchange whose every line carries its own pair. Only the middle
      // one is unwrapped here, so that what is left is either bare — and gets a
      // pair from the page — or is punctuation the author meant.
      const selfQuoted = lines.length > 1 && lines.every((line) => opens(line) && closes(line));
      if (!selfQuoted && opens(lines[0]) && closes(lines.at(-1)!)) {
        lines[0] = lines[0].slice(1);
        lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1);
      }
      return { lines, attribution, selfQuoted };
    });
}

export const quotes = parseQuotes(source);

/** One of them, at random. Takes its randomness so a test can pin it. */
export function randomQuote(random: () => number = Math.random): Quote {
  return quotes[Math.min(quotes.length - 1, Math.floor(random() * quotes.length))];
}

/**
 * How large the landing page may set a quote. The hero size is built for a line
 * or two; the long ones in the file run to a paragraph, and at 72px a paragraph
 * is a wall that pushes the room list off the bottom of the screen.
 *
 * Length is counted in characters, except that a quote written over many lines
 * is tall however few characters it holds — a distress call of a dozen short
 * lines fills the screen at a size the same words in one paragraph would not.
 * Six is where a quote stops being a couple of lines and becomes a column.
 */
export function quoteScale(quote: Quote): "short" | "medium" | "long" | "tall" {
  if (quote.lines.length >= 6) return "tall";
  const length = quote.lines.join(" ").length;
  if (length <= 90) return "short";
  return length <= 200 ? "medium" : "long";
}
