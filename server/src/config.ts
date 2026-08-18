import { projectFile } from "./paths.js";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  /** The Devil's Tables, which runs on its own port against the same database. */
  tablesPort: Number(process.env.DEVILS_TABLES_PORT ?? 4100),
  /**
   * Where a browser can reach The Devil's Tables, for the link in the game's
   * rail. Set this when a reverse proxy puts it somewhere other than this host
   * on `tablesPort`; otherwise the client works it out for itself.
   */
  tablesUrl: process.env.DEVILS_TABLES_URL ?? "",
  dataDir: projectFile(process.env.DEVILS_TOYS_DATA_DIR ?? ".data"),
  uploadLimitMb: Number(process.env.DEVILS_TOYS_UPLOAD_LIMIT_MB ?? 1024),
  sceneImageUploadLimitMb: Number(process.env.DEVILS_TOYS_SCENE_IMAGE_LIMIT_MB ?? 60),
  referenceImageUploadLimitMb: Number(
    process.env.DEVILS_TOYS_REFERENCE_IMAGE_LIMIT_MB ?? process.env.DEVILS_TOYS_IMAGE_LIMIT_MB ?? 20
  ),
  audioUploadLimitMb: Number(process.env.DEVILS_TOYS_AUDIO_LIMIT_MB ?? 50),
  /**
   * A system bundle is rules text and JSON, so it is small: exporting Monolith,
   * the largest of the three, gives about 130 KB. The cap is generous enough for
   * a book several times that and low enough that a mistaken upload is refused
   * before it is read into memory.
   */
  systemUploadLimitMb: Number(process.env.DEVILS_TOYS_SYSTEM_LIMIT_MB ?? 25),
  /**
   * A campaign is the other size of thing entirely: its JSON and Markdown are
   * kilobytes and its maps and music are gigabytes, so this cap is about the art
   * and nothing else.
   *
   * It is deliberately generous, because the upload is the only door — nothing
   * may be imported from a path on this server. A campaign that will not fit
   * through it is split into parts sharing a `campaignId` and imported one after
   * another, which is what the refusal says. Raising this is not the only way
   * past it, and should not be the first thing an operator reaches for: a
   * reverse proxy's own body limit will refuse the request long before this does.
   */
  campaignUploadLimitMb: Number(process.env.DEVILS_TOYS_CAMPAIGN_LIMIT_MB ?? 2048),
  /** The most files one campaign may carry. More than this is a mistake worth naming. */
  campaignEntryLimit: Number(process.env.DEVILS_TOYS_CAMPAIGN_ENTRY_LIMIT ?? 5000),
  /**
   * The menu of systems an admin can install without going looking for one.
   *
   * A JSON index, fetched over HTTPS and cached. It is a URL rather than a
   * compiled-in list so that an operator can point at their own — a club, a
   * publisher, or a private mirror — and so that adding a system to the public
   * catalogue does not need a release of this application.
   *
   * It defaults to the published one because a server that ships no game system
   * and offers no way to find one is a server with nothing to do. Set it to
   * another index to offer a different menu, or to an empty string for no menu
   * at all — installing by repository and ref, or from a file, works either way.
   *
   * Nothing is fetched until an admin opens the Systems panel.
   */
  systemCatalogUrl:
    process.env.DEVILS_TOYS_SYSTEM_CATALOG_URL ??
    "https://raw.githubusercontent.com/tpskowski/devils-toys-systems/main/index.json",
  /**
   * The only hosts this server will fetch a system from.
   *
   * Importing is the one thing that makes the server open an outbound
   * connection, and an admin naming a repository is the one thing that decides
   * where to. An allowlist keeps that from becoming "fetch any URL an admin can
   * type", which is a request-forgery primitive pointed at whatever this server
   * can reach that a browser cannot.
   */
  systemSourceHosts: (
    process.env.DEVILS_TOYS_SYSTEM_HOSTS ??
    "codeload.github.com,raw.githubusercontent.com,api.github.com,objects.githubusercontent.com"
  )
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
  /** Optional, and only to lift GitHub's unauthenticated rate limit. */
  githubToken: process.env.DEVILS_TOYS_GITHUB_TOKEN ?? "",
  /** How long a fetched catalogue is reused before it is asked for again. */
  systemCatalogTtlSeconds: Number(process.env.DEVILS_TOYS_SYSTEM_CATALOG_TTL ?? 300),
  logLevel: process.env.DEVILS_TOYS_LOG_LEVEL ?? "info",
  isProduction: process.env.NODE_ENV === "production"
};
