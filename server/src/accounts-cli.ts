/**
 * Account recovery from the machine the server runs on.
 *
 *   npm run accounts list
 *   npm run accounts reset <username>
 *   npm run accounts delete <username>
 *
 * This is the way back in when nobody can sign in to let you back in. Everything
 * the application does to an account is normally done by an admin over HTTP, and
 * should be: an admin can already reset any password, including another admin's.
 * The one case that has no answer there is the last admin forgetting theirs, and
 * a server whose only admin is locked out cannot install a system, make a room,
 * or add an account — it is bricked, with all its data intact.
 *
 * So this deliberately answers to the filesystem rather than to a password:
 * whoever can read the database can already read every session token in it and
 * write any row they like. It grants no authority that a person with the
 * database did not already have. It does take care not to *hand out* any:
 *
 * - a password is never taken as an argument, because argv is visible to every
 *   other process on the machine and lands in shell history;
 * - it is asked for twice, with the terminal's echo off;
 * - it is hashed at the same cost the application uses, and every existing
 *   session for that account is dropped, so a stolen cookie does not outlive the
 *   reset;
 * - nothing here ever prints a hash.
 */
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline/promises";
import { all, db, one } from "./db.js";
import { config } from "./config.js";

/** The cost the application hashes with. Kept in step deliberately. */
const BCRYPT_COST = 12;
/** The same bounds the HTTP routes enforce, so the two cannot disagree. */
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

interface AccountRow {
  id: number;
  username: string;
  is_admin: number;
  account_role: string;
  created_at: string;
}

function accounts(): AccountRow[] {
  return all<AccountRow>("SELECT id, username, is_admin, account_role, created_at FROM accounts ORDER BY id");
}

/** `COLLATE NOCASE` on the column, so this matches the way signing in does. */
function findAccount(username: string) {
  return one<AccountRow>(
    "SELECT id, username, is_admin, account_role, created_at FROM accounts WHERE username = ?",
    username
  );
}

function adminCount() {
  return one<{ count: number }>("SELECT COUNT(*) AS count FROM accounts WHERE account_role = 'admin'")?.count ?? 0;
}

/**
 * Input comes from one of two places, and they are not the same problem.
 *
 * A terminal is asked question by question, with the echo off for a secret. A
 * pipe is read once, whole, and consumed a line at a time — because readline
 * over a pipe answers the first `question()` and then never resolves the second,
 * which fails by hanging rather than by saying anything. Two piped lines, for a
 * password and its confirmation, is exactly that case.
 */
let piped: string[] | undefined;
let reader: ReturnType<typeof createInterface> | undefined;

async function pipedLines() {
  if (piped) return piped;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  piped = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  return piped;
}

function terminal() {
  reader ??= createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return reader;
}

export function closeInput() {
  reader?.close();
  reader = undefined;
}

/** The next line of piped input, or an empty string once it has run out. */
async function nextPipedLine() {
  return (await pipedLines()).shift()?.trim() ?? "";
}

/**
 * Reads a secret without echoing it. Piped input is read as a plain line — there
 * is nothing to hide it from — so the command can be scripted without ever
 * putting a password in argv, where every other process on the machine can read
 * it and the shell writes it to history.
 */
async function askSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) return nextPipedLine();

  const rl = terminal();
  process.stdout.write(prompt);
  const stream = process.stdout;
  const write = stream.write.bind(stream);
  // Everything typed between the prompt and the newline is the secret.
  stream.write = ((chunk: string, ...rest: unknown[]) =>
    typeof chunk === "string" && !chunk.includes("\n") ? true : write(chunk, ...(rest as []))) as typeof stream.write;
  try {
    return await rl.question("");
  } finally {
    stream.write = write;
    process.stdout.write("\n");
  }
}

async function askLine(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) return nextPipedLine();
  return (await terminal().question(prompt)).trim();
}

function refuseUnusablePassword(password: string) {
  if (password.length < MIN_PASSWORD) throw new Error(`A password is at least ${MIN_PASSWORD} characters.`);
  if (password.length > MAX_PASSWORD) throw new Error(`A password is at most ${MAX_PASSWORD} characters.`);
}

function list() {
  const rows = accounts();
  if (!rows.length) {
    console.log("This server has no accounts. Open it in a browser to create the first one.");
    return;
  }
  const width = Math.max(8, ...rows.map((row) => row.username.length));
  console.log(`${"ID".padStart(4)}  ${"USERNAME".padEnd(width)}  ROLE   CREATED`);
  for (const row of rows) {
    console.log(
      `${String(row.id).padStart(4)}  ${row.username.padEnd(width)}  ${row.account_role.padEnd(6)} ${row.created_at}`
    );
  }
  const admins = adminCount();
  console.log(`\n${rows.length} account${rows.length === 1 ? "" : "s"}, ${admins} admin${admins === 1 ? "" : "s"}.`);
}

async function reset(username: string) {
  const account = findAccount(username);
  if (!account) throw new Error(`No account called "${username}". Run 'list' to see what there is.`);

  console.log(`Resetting the password for ${account.username} (${account.account_role}).`);
  const password = await askSecret("New password: ");
  refuseUnusablePassword(password);
  const again = await askSecret("Again: ");
  if (password !== again) throw new Error("Those did not match. Nothing has been changed.");

  const hash = await bcrypt.hash(password, BCRYPT_COST);
  // Both together: a reset that left the old sessions alive would not lock out
  // whoever the reset was prompted by.
  db.exec("BEGIN");
  let dropped = 0;
  try {
    db.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run(hash, account.id);
    dropped = Number(db.prepare("DELETE FROM sessions WHERE account_id = ?").run(account.id).changes);
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }

  console.log(`\n${account.username} can sign in with the new password.`);
  if (dropped) console.log(`${dropped} existing session${dropped === 1 ? "" : "s"} signed out.`);
}

/**
 * What an account has made that would be orphaned by deleting it.
 *
 * Six tables reference an account with no `ON DELETE` rule, so the delete would
 * fail on a foreign key. That is the right answer — a room's creator is part of
 * its record — but "FOREIGN KEY constraint failed" is not, so each one is
 * counted and named instead.
 */
function belongings(accountId: number) {
  const kinds: { one: string; many: string; sql: string }[] = [
    { one: "room created", many: "rooms created", sql: "SELECT COUNT(*) AS count FROM rooms WHERE created_by = ?" },
    { one: "message", many: "messages", sql: "SELECT COUNT(*) AS count FROM messages WHERE account_id = ?" },
    {
      one: "private roll",
      many: "private rolls",
      sql: "SELECT COUNT(*) AS count FROM private_rolls WHERE account_id = ?"
    },
    { one: "upload", many: "uploads", sql: "SELECT COUNT(*) AS count FROM media WHERE uploaded_by = ?" },
    { one: "table set", many: "table sets", sql: "SELECT COUNT(*) AS count FROM table_sets WHERE created_by = ?" },
    { one: "custom NPC", many: "custom NPCs", sql: "SELECT COUNT(*) AS count FROM custom_npcs WHERE created_by = ?" },
    { one: "encounter", many: "encounters", sql: "SELECT COUNT(*) AS count FROM encounters WHERE created_by = ?" }
  ];
  return kinds
    .map((kind) => ({ ...kind, count: countOf(kind.sql, accountId) }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.count} ${entry.count === 1 ? entry.one : entry.many}`);
}

function countOf(sql: string, accountId: number) {
  return one<{ count: number }>(sql, accountId)?.count ?? 0;
}

async function remove(username: string, options: { yes: boolean }) {
  const account = findAccount(username);
  if (!account) throw new Error(`No account called "${username}". Run 'list' to see what there is.`);

  // A server with no admin can no longer install a system, make a room, or add
  // an account, and there is no way back in through the application.
  if (account.account_role === "admin" && adminCount() === 1)
    throw new Error(
      `${account.username} is this server's only admin. Make another admin first, or the server cannot be administered at all.`
    );

  const held = belongings(account.id);
  if (held.length) {
    throw new Error(
      `${account.username} cannot be deleted: ${held.join(", ")}. Those records name this account and would be left pointing at nothing. ` +
        `Delete or reassign them first — or reset the password instead, which keeps the history and takes back the access.`
    );
  }

  if (!options.yes) {
    const typed = await askLine(`Type ${account.username} to delete the account, or anything else to stop: `);
    if (typed !== account.username) {
      console.log("Nothing has been changed.");
      return;
    }
  }

  // Sessions, memberships, invitations, and revealed references cascade.
  db.prepare("DELETE FROM accounts WHERE id = ?").run(account.id);
  console.log(`${account.username} has been deleted.`);
}

const [command, ...rest] = process.argv.slice(2).filter((argument) => argument !== "--yes");
const yes = process.argv.includes("--yes");
const target = rest[0];

const usage = `Account tools — run on the machine the server's database is on.

  npm run accounts list
  npm run accounts reset <username>
  npm run accounts delete <username> [--yes]

Reading ${config.dataDir}. Set DEVILS_TOYS_DATA_DIR to point elsewhere.
A password is never passed as an argument; it is asked for.`;

try {
  if (command === "list") list();
  else if (command === "reset") {
    if (!target) throw new Error("Name the account to reset.\n\n" + usage);
    await reset(target);
  } else if (command === "delete") {
    if (!target) throw new Error("Name the account to delete.\n\n" + usage);
    await remove(target, { yes });
  } else {
    console.log(usage);
    process.exitCode = command ? 1 : 0;
  }
} catch (cause) {
  console.error(`\n${cause instanceof Error ? cause.message : String(cause)}`);
  process.exitCode = 1;
} finally {
  closeInput();
}
