/** Where The Devil's Tables is, and whether it is running, per `/api/tables-app`. */
export interface TablesApp {
  /** An explicit address, set when a reverse proxy has moved it. */
  url: string;
  /** The port its own server listens on, used when there is no explicit address. */
  port: number;
  /** Whether the game server could reach it just now. */
  running: boolean;
  /** The command that starts it, which differs between development and production. */
  command: string;
}

/**
 * The address of The Devil's Tables from the browser's point of view.
 *
 * An explicit address always wins. Otherwise it is this host on the editor's own
 * port — except in development, where the game is served by Vite on 10666 and
 * the editor by its own Vite on 10667, and going to the API port would find
 * whatever was last built rather than what is being worked on.
 */
export function tablesAppUrl(
  tables: Pick<TablesApp, "url" | "port"> | undefined,
  origin: { protocol: string; hostname: string },
  devServerPort?: number
) {
  if (tables?.url) return tables.url;
  const port = devServerPort ?? tables?.port;
  if (!port) return "";
  return `${origin.protocol}//${origin.hostname}:${port}`;
}
