import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { HelpGuide, HelpGuideId, HelpPage } from "@devils-toys/shared";
import { HELP_GUIDES } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth } from "./auth.js";
import { projectFile } from "./paths.js";

/**
 * The written guides, served from `docs/guide/` so there is one copy of them
 * rather than a set of pages that drift from the files. The same arrangement
 * The Devil's Tables uses for its own guide, one directory further out.
 *
 * There are three, one per account role, and **any signed-in account may read
 * any of them**. They describe what each role can do; that is documentation
 * rather than something to withhold, and a player reading the admin guide
 * learns why they cannot delete a room, which is worth more than the secrecy.
 */
export const helpRouter = express.Router();

const guideRoot = projectFile("docs", "guide");
const imageDir = path.join(guideRoot, "images");

/**
 * Where each guide's pages live, relative to `docs/guide/`. The table editor's
 * guide is not one of these: it is a single document at the repository root,
 * read below.
 */
const guideDirectories: Record<string, string> = { player: ".", gm: "gm", admin: "admin" };
const guideLabels: Record<HelpGuideId, string> = {
  player: "Player's Guide",
  gm: "GM's Guide",
  admin: "Admin's Guide",
  tables: "The Devil's Tables"
};

/** The first heading a page carries, which is what the menu calls it. */
function titleOf(markdown: string, fallback: string) {
  return /^#\s+(.+?)\s*$/m.exec(markdown)?.[1]?.replace(/^The Devil's Toys — /, "") ?? fallback;
}

/**
 * The order a guide's own README puts its pages in.
 *
 * Each README carries a numbered list of its pages — the contents its author
 * wrote — and that is what the menu follows, rather than an order restated in
 * here that could drift from it.
 *
 * It has to be the numbered list rather than every link in the file: the admin
 * README mentions Accounts and Rooms in prose well before its contents, and
 * reading the first mention of each would put "First run" last in a guide about
 * standing a server up. Where a README has no numbered list, every link it makes
 * is the next best answer.
 */
function linkedOrder(readme: string) {
  const own = (target: string) => !target.includes("/") && target !== "README.md";
  const collect = (pattern: RegExp) => {
    const order: string[] = [];
    for (const [, target] of readme.matchAll(pattern)) {
      if (!own(target)) continue;
      const slug = target.replace(/\.md$/, "");
      if (!order.includes(slug)) order.push(slug);
    }
    return order;
  };
  const contents = collect(/^[ \t]*\d+\..*?\[[^\]]*\]\(([^)\s]+\.md)(?:#[^)]*)?\)/gm);
  return contents.length ? contents : collect(/\[[^\]]*\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g);
}

function slugOf(text: string) {
  return (
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

/**
 * One document as a guide, split at its own second-level headings.
 *
 * `devils-tables.md` is the editor's guide and stays a single file: the editor
 * itself serves it whole as its Guide page, and `AGENTS.md` is explicit that
 * there is one copy of it rather than a page that drifts from the file. So it is
 * split here, when it is read, rather than on disk — the menu is the document's
 * own sections, and the source is still the one document.
 */
function splitDocument(markdown: string): HelpPage[] {
  const lines = markdown.split("\n");
  const starts: number[] = [];
  let fenced = false;
  lines.forEach((line, index) => {
    // A heading inside a fenced example is example text, not a section.
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced && /^##\s+/.test(line)) starts.push(index);
  });

  const preamble = lines
    .slice(0, starts[0] ?? lines.length)
    .join("\n")
    .trim();
  const pages: HelpPage[] = [{ slug: "overview", title: "Overview", markdown: preamble }];
  starts.forEach((start, index) => {
    const title = /^##\s+(.+?)\s*$/.exec(lines[start])![1];
    pages.push({
      slug: slugOf(title),
      title,
      markdown: lines
        .slice(start, starts[index + 1] ?? lines.length)
        .join("\n")
        .trim()
    });
  });
  return pages;
}

function readGuide(id: HelpGuideId): HelpGuide {
  if (id === "tables")
    return {
      id,
      label: guideLabels[id],
      pages: splitDocument(fs.readFileSync(projectFile("devils-tables.md"), "utf8"))
    };
  const directory = path.join(guideRoot, guideDirectories[id]);
  const readmePath = path.join(directory, "README.md");
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : "";
  const files = fs.existsSync(directory)
    ? fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
        .map((entry) => entry.name.replace(/\.md$/, ""))
    : [];

  const wanted = linkedOrder(readme);
  const ordered = [...wanted.filter((slug) => files.includes(slug)), ...files.filter((slug) => !wanted.includes(slug))];

  const pages: HelpPage[] = [
    { slug: "overview", title: "Overview", markdown: readme },
    ...ordered.map((slug) => {
      const markdown = fs.readFileSync(path.join(directory, `${slug}.md`), "utf8");
      return { slug, title: titleOf(markdown, slug), markdown };
    })
  ];
  return { id, label: guideLabels[id], pages };
}

/**
 * Every guide in one response. The whole set is a few tens of kilobytes, and
 * sending it at once is what lets the page search across all of a guide's pages
 * without a request per keystroke — the same way the rules reference filters
 * text it already holds.
 */
helpRouter.get("/help", requireAuth, (req: AuthedRequest, res) => {
  res.json({ viewerRole: req.account!.role, guides: HELP_GUIDES.map(readGuide) });
});

helpRouter.get("/help/images/:name", requireAuth, (req, res) => {
  const name = String(req.params.name);
  // A name is a file in one directory, never a path into another.
  if (path.basename(name) !== name || !/\.(?:png|jpe?g|webp|svg)$/i.test(name))
    return res.status(404).json({ error: "Image not found." });
  if (!fs.existsSync(path.join(imageDir, name))) return res.status(404).json({ error: "Image not found." });
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.sendFile(name, { root: imageDir });
});
