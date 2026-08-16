/**
 * What someone actually pastes when asked for a repository.
 *
 * The server wants `owner/repository` and nothing else, and is right to: it
 * builds a download address out of that string, so anything that could carry a
 * path or a host has to be refused rather than escaped. But nobody looking at a
 * repository has `owner/repository` on their clipboard — they have the address
 * bar, or the green Code button, or an SSH remote. So the form takes any of
 * those and hands the server the one thing it accepts.
 *
 * A `/tree/<ref>` address carries the branch or tag as well, which is exactly
 * what someone browsing a tag has copied, so that is read too.
 */

export interface ParsedRepository {
  repository: string;
  /** Only when the pasted address named one. */
  ref?: string;
}

/** Owner and repository as GitHub allows them to be written. */
const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;

function usable(owner: string | undefined, name: string | undefined) {
  if (!owner || !name) return undefined;
  const repository = name.replace(/\.git$/i, "");
  if (!SEGMENT.test(owner) || !SEGMENT.test(repository)) return undefined;
  return `${owner}/${repository}`;
}

/**
 * Reads a repository, and possibly a ref, out of whatever was typed. Returns
 * `undefined` for anything it cannot be sure of — a guess here would send the
 * server somewhere the person did not mean.
 */
export function parseRepositoryInput(input: string): ParsedRepository | undefined {
  const text = input.trim();
  if (!text) return undefined;

  // `git@github.com:owner/repo.git`
  const ssh = /^git@github\.com:(.+)$/i.exec(text);
  const path = ssh
    ? ssh[1]
    : // `https://github.com/owner/repo`, and the same without a scheme.
      /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(text)?.[1];

  if (path === undefined) {
    // Not an address, so it has to be the plain form already.
    const [owner, name, ...rest] = text.replace(/\/+$/, "").split("/");
    if (rest.length) return undefined;
    const repository = usable(owner, name);
    return repository ? { repository } : undefined;
  }

  const [owner, name, kind, ...tail] = path.replace(/\/+$/, "").split("/");
  const repository = usable(owner, name);
  if (!repository) return undefined;

  // `/tree/<ref>` and `/commit/<sha>` name a ref; the ref itself may hold
  // slashes, as `release/1.2` does.
  if ((kind === "tree" || kind === "commit") && tail.length) {
    const ref = tail.join("/");
    return { repository, ref };
  }
  // Any other trailing path — `/issues`, `/blob/main/README.md` — is a page
  // about the repository rather than the repository, and naming one would be a
  // guess. The repository itself is still unambiguous.
  return { repository };
}
