/**
 * One path component that can survive both a campaign ZIP and Windows.
 *
 * Wiki folders are persisted names and a bundle's Markdown filename can grow
 * into a folder on import, so they use the same rule.  Checking only slashes
 * would accept `CON` or `notes:private`: those work on one host but either
 * cannot be extracted on Windows or create an export the next host refuses.
 */
export function isSafeWikiPathComponent(name: string) {
  // Campaigns are imported on Windows too, where these are not legal path
  // components. Refuse them at the Wiki boundary instead of exporting a bundle
  // this server cannot later expand.
  if (!name || name === "." || name === ".." || /[\u0000-\u001f\u007f\\/:*?"<>|]/.test(name) || /[. ]$/.test(name))
    return false;
  // Windows reserves these even with an extension (for example `con.md`).
  const stem = name.split(".", 1)[0]!.toUpperCase();
  return !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem);
}

/** A folder component, never a path. Keep database names portable to ZIP. */
export function isSafeWikiFolderName(name: string) {
  return isSafeWikiPathComponent(name);
}

export function assertSafeWikiFolderName(name: string) {
  if (!isSafeWikiFolderName(name))
    throw new Error(`The wiki folder "${name}" cannot be represented safely in a campaign archive.`);
}
