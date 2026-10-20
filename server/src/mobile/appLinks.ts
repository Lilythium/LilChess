import type { FastifyInstance } from "fastify";
import { config, type MobileLinkConfig } from "../config.js";

/**
 * Association files that let the OS open challenge and simul invite links in the mobile app instead of the browser.
 *
 *   Android App Links  GET /.well-known/assetlinks.json
 *   iOS universal links GET /.well-known/apple-app-site-association
 *
 * Both are generated from environment settings and are absent (404) until the operator sets them, so a default
 * install advertises nothing. An https invite link only ever names a server and a target: the app still confirms the
 * server and the server still decides whether the invite is valid (docs/mobile-phase-7-platform.md).
 *
 * They must be registered as explicit routes: @fastify/static ignores dotfiles, and the SPA fallback would otherwise
 * answer these paths with index.html and a 200, which both platforms treat as a failed verification.
 */

export interface AssetLink {
  relation: ["delegate_permission/common.handle_all_urls"];
  target: { namespace: "android_app"; package_name: string; sha256_cert_fingerprints: string[] };
}

export function buildAssetLinks(mobile: MobileLinkConfig): AssetLink[] | null {
  if (mobile.androidCertSha256.length === 0) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: mobile.androidPackage,
        sha256_cert_fingerprints: mobile.androidCertSha256,
      },
    },
  ];
}

export interface AppleSiteAssociation {
  applinks: {
    details: Array<{ appIDs: string[]; components: Array<Record<string, string>> }>;
  };
}

/**
 * Invites are hash routes (`https://host/#/c/<id>`, `https://host/#/s/<code>`), so the path is always `/`. The `#`
 * component restricts universal links to those two routes: other pages on the site keep opening in Safari.
 */
export function buildAppleSiteAssociation(mobile: MobileLinkConfig): AppleSiteAssociation | null {
  if (mobile.iosAppIds.length === 0) return null;
  return {
    applinks: {
      details: [
        {
          appIDs: mobile.iosAppIds,
          components: [
            { "/": "/", "#": "/c/*", comment: "Challenge invites" },
            { "/": "/", "#": "/s/*", comment: "Simul invites" },
          ],
        },
      ],
    },
  };
}

export async function appLinkRoutes(app: FastifyInstance, opts: { mobile?: MobileLinkConfig } = {}): Promise<void> {
  const mobile = opts.mobile ?? config.mobile;

  const serve = (path: string, build: (m: MobileLinkConfig) => unknown) => {
    app.get(path, async (_req, reply) => {
      const body = build(mobile);
      if (body === null) return reply.code(404).send({ error: "Not found" });
      return reply
        .header("cache-control", "public, max-age=300")
        .type("application/json; charset=utf-8")
        .send(body);
    });
  };

  serve("/.well-known/assetlinks.json", buildAssetLinks);
  serve("/.well-known/apple-app-site-association", buildAppleSiteAssociation);
}
