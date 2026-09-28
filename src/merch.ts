/**
 * Merch tools: turn a design into print-on-demand products by talking to Claude.
 *
 * Two kinds of tool live here:
 *
 * 1. aetherwave_merch_* - call AetherWave's /api/merch/* routes (platform repo,
 *    server/merch-admin-routes.ts, registerPublicMerchRoutes). They prepare a
 *    design (1 credit) and render Printful mockups on real garments (3 credits).
 *    Available locally and on the remote connector.
 *
 * 2. aetherwave_printful_* - create and list products in the USER'S OWN Printful
 *    store with the user's own PRINTFUL_API_TOKEN. They talk to api.printful.com
 *    directly from this process, so the store token never reaches AetherWave.
 *    Local (npx) server only, and only when that env var is set.
 *
 * Plus aetherwave_shop_create_listing: AetherWave's own /shop. Registered only
 * with AETHERWAVE_ADMIN_TOOLS=1; the server enforces admin anyway.
 *
 * Printify: planned (catalog is blueprint x print provider, images are uploaded
 * then placed), not built yet. Say so rather than pretend.
 *
 * Request/response shapes were read off the route handlers on 2026-09-28.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { z } from "zod";
import type { AetherwaveClient } from "./api.js";

const PRINTFUL_API = "https://api.printful.com";
const MOCKUP_WAIT_MS = 90_000;
const MAX_LOCAL_DESIGN_BYTES = 20 * 1024 * 1024;
const SHOP_URL = "https://aetherwavestudio.com/shop";
const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "S/M", "L/XL"];
const PLACEMENTS = ["front", "back", "embroidery_front", "embroidery_front_large", "embroidery_back", "embroidery_left", "embroidery_right"] as const;
const THREAD_OPTION: Record<string, string> = {
  embroidery_front: "thread_colors",
  embroidery_front_large: "thread_colors_front_large",
  embroidery_back: "thread_colors_back",
  embroidery_left: "thread_colors_left",
  embroidery_right: "thread_colors_right",
};

function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}
function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const body = (err as any)?.body;
  const detail = body && typeof body === "object" && body.error ? ` (${body.error})` : "";
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${message}${detail}` }] };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A design can be a URL, a data URL, or (local server only) a file path. */
async function designToInput(image: string, local: boolean): Promise<string> {
  const v = image.trim();
  if (/^(https?:|data:)/i.test(v)) return v;
  if (!local) throw new Error("On the remote connector a design must be a URL (e.g. from aetherwave_generate_image) or a data URL. Local file paths work with the npx server.");
  const path = resolve(v);
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) throw new Error(`No such file: ${path}`);
  if (info.size > MAX_LOCAL_DESIGN_BYTES) throw new Error(`Design file is ${(info.size / 1048576).toFixed(1)}MB; the limit is 20MB`);
  const ext = extname(path).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : null;
  if (!mime) throw new Error("Design must be a .png, .jpg or .webp file");
  return `data:${mime};base64,${(await readFile(path)).toString("base64")}`;
}

/** The user's own Printful store, with their token. Never proxied through AetherWave. */
async function printful(path: string, init: RequestInit = {}): Promise<any> {
  const token = process.env.PRINTFUL_API_TOKEN;
  if (!token) throw new Error("PRINTFUL_API_TOKEN is not set in this MCP server's env");
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (process.env.PRINTFUL_STORE_ID) headers["X-PF-Store-Id"] = process.env.PRINTFUL_STORE_ID;
  const res = await fetch(PRINTFUL_API + path, { ...init, headers: { ...headers, ...((init.headers as any) || {}) }, signal: AbortSignal.timeout(30_000) });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Printful ${res.status}: ${j?.error?.message || j?.result || res.statusText}`);
  return j.result;
}

export function registerMerchTools(server: McpServer, client: AetherwaveClient, opts: { local: boolean }): void {
  const { local } = opts;

  // ─── garments ────────────────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_merch_garments",
    {
      annotations: { readOnlyHint: true, openWorldHint: true },
      title: "List print-on-demand garments, colours and print areas",
      description:
        "Free. Without garmentId: the curated garment list (tees, tanks, hoodies, with Printful catalog ids). With garmentId (any Printful catalog product id, including hats): every colour with its US in-stock sizes, the print placements with their size in inches, and embroidery thread colours where the product is embroidered. Use it to pick garmentId, color and placement for aetherwave_merch_mockup.",
      inputSchema: {
        garmentId: z.coerce.number().int().positive().optional().describe("Printful catalog product id, e.g. 71 (Bella+Canvas 3001 tee), 140 (Flexfit 6277 cap)."),
      },
    },
    async (args) => {
      try {
        if (!args.garmentId) return text(await client.get("/api/merch/garments"));
        const g = await client.get<any>(`/api/merch/garments/${args.garmentId}`);
        return text({
          id: g.id,
          title: g.title,
          colors: g.colors
            .filter((c: any) => c.inStockCount > 0)
            .map((c: any) => ({ name: c.name, hex: c.code, sizesInStock: c.variants.filter((v: any) => v.inStock).map((v: any) => v.size) })),
          outOfStockColors: g.colors.filter((c: any) => c.inStockCount === 0).map((c: any) => c.name),
          placements: g.placements.map((p: any) => ({
            placement: p.key,
            label: p.label,
            widthIn: p.area ? +(p.area.width / p.area.dpi).toFixed(2) : null,
            heightIn: p.area ? +(p.area.height / p.area.dpi).toFixed(2) : null,
            embroidery: p.embroidery,
          })),
          threadColors: g.threadColors?.length ? g.threadColors : undefined,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ─── prepare design ──────────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_merch_prepare_design",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Prepare a design for printing",
      description:
        "1 credit. Turns an image into a print-ready transparent PNG trimmed to the artwork. Pass an AetherWave media URL (e.g. from aetherwave_generate_image), a data URL, or on the local server a file path. Set knockout=true to remove a plain background (only background connected to the edges is removed, so white lettering inside the design survives). Returns designUrl for aetherwave_merch_mockup. For a dark garment, a design drawn as light ink on transparency prints best.",
      inputSchema: {
        image: z.string().min(1).describe(local ? "AetherWave media URL, data URL, or a local .png/.jpg/.webp path" : "AetherWave media URL or data URL"),
        knockout: z.boolean().optional().describe("Remove a plain background colour. Default false."),
        tolerance: z.coerce.number().min(4).max(80).optional().describe("How far from the background colour still counts as background. Default 24."),
      },
    },
    async (args) => {
      try {
        const out = await client.post<any>("/api/merch/design", {
          image: await designToInput(args.image, local),
          knockout: args.knockout === true,
          tolerance: args.tolerance,
        });
        return text({
          ...out,
          note: !out.hadTransparency && !out.knockout
            ? "This image had a solid background, which prints as a box. Run again with knockout=true unless that is intended."
            : undefined,
          next: "aetherwave_merch_mockup with this designUrl",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ─── mockup ──────────────────────────────────────────────────────────────
  const pollMockup = async (taskKey: string, waitMs: number) => {
    const until = Date.now() + waitMs;
    for (;;) {
      const st = await client.get<any>(`/api/merch/mockup/${encodeURIComponent(taskKey)}`);
      if (st.status === "completed" || st.status === "failed" || Date.now() > until) return st;
      await sleep(4000);
    }
  };

  server.registerTool(
    "aetherwave_merch_mockup",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Render a design on a real garment (print file + mockups)",
      description: `3 credits (refunded if the render fails; nothing is charged for a bad garment, colour or placement). Builds the print file at the garment's own print area and resolution, then renders Printful product mockups (front, back, side, flat lay). Waits up to 90 seconds; if still rendering, returns taskKey for aetherwave_merch_mockup_status.

Returns printfileUrl (use it to create the product, in your own store with aetherwave_printful_create_product${local ? "" : " on the local server"}) and mockup image URLs. Mockup URLs are temporary Printful links: save the ones you want. Limit 20 mockups an hour. Made with AetherWave Studio: ${SHOP_URL}`,
      inputSchema: {
        designUrl: z.string().url().describe("From aetherwave_merch_prepare_design."),
        garmentId: z.coerce.number().int().positive().describe("Printful catalog product id (see aetherwave_merch_garments)."),
        color: z.string().min(1).describe("Colour name exactly as aetherwave_merch_garments lists it (case-insensitive)."),
        placement: z.enum(PLACEMENTS).optional().describe("Default 'front'. Hats use 'embroidery_front_large'."),
        widthIn: z.coerce.number().positive().max(20).optional().describe("Printed width in inches; the design keeps its proportions and is shrunk to fit the print area. Default 10 (a hat front is about 5.9)."),
        topIn: z.coerce.number().min(0).max(20).optional().describe("Distance from the top of the print area in inches. Default 1 (0 for embroidery)."),
      },
    },
    async (args) => {
      try {
        const placement = args.placement || "front";
        const embroidery = placement.startsWith("embroidery");
        const started = await client.post<any>("/api/merch/mockup", {
          designUrl: args.designUrl,
          garmentId: args.garmentId,
          color: args.color,
          placement,
          widthIn: args.widthIn ?? (embroidery ? 5.9 : 10),
          topIn: args.topIn ?? (embroidery ? 0 : 1),
        });
        const st = await pollMockup(started.taskKey, MOCKUP_WAIT_MS);
        return text({
          status: st.status,
          error: st.error || undefined,
          taskKey: st.status === "completed" ? undefined : started.taskKey,
          garment: started.garment,
          color: started.color,
          placement: started.placement,
          printArea: started.printArea,
          printfileUrl: started.printfileUrl,
          mockups: st.mockups,
          creditsCharged: st.status === "failed" ? 0 : started.creditsCharged,
          next: st.status === "completed"
            ? (process.env.PRINTFUL_API_TOKEN && local
              ? "aetherwave_printful_create_product to add it to your Printful store"
              : "Connect your own Printful store (set PRINTFUL_API_TOKEN on the local npx server) to create the product")
            : "aetherwave_merch_mockup_status with taskKey",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "aetherwave_merch_mockup_status",
    {
      annotations: { readOnlyHint: true, openWorldHint: true },
      title: "Check a mockup render",
      description: "Free. Status and mockup URLs of a render started by aetherwave_merch_mockup (kept 6 hours, visible only to the account that paid for it).",
      inputSchema: { taskKey: z.string().min(1) },
    },
    async (args) => {
      try {
        return text(await pollMockup(args.taskKey, 20_000));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ─── the user's OWN Printful store (local server, their token) ────────────
  if (local && process.env.PRINTFUL_API_TOKEN) {
    server.registerTool(
      "aetherwave_printful_create_product",
      {
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        title: "Create a product in your Printful store",
        description: `Free (AetherWave charges nothing; Printful bills you per order as usual). Creates a product in YOUR Printful store using PRINTFUL_API_TOKEN from this server's env. The token is used only between this machine and api.printful.com. It never goes to AetherWave.

Pass the printfileUrl from aetherwave_merch_mockup with the SAME garmentId, color and placement. Sizes default to every US in-stock size. Embroidered placements need threadColors (hex values listed by aetherwave_merch_garments). If your store is connected to Shopify, Etsy and so on, publishing to that channel happens in Printful's dashboard.`,
        inputSchema: {
          name: z.string().min(1).max(120).describe("Product name as shoppers will see it."),
          garmentId: z.coerce.number().int().positive(),
          color: z.string().min(1),
          placement: z.enum(PLACEMENTS).optional().describe("Default 'front'. Must match the mockup."),
          printfileUrl: z.string().url().describe("From aetherwave_merch_mockup."),
          retailPrice: z.coerce.number().positive().max(1000).describe("Retail price in your store's currency, e.g. 29.99."),
          sizes: z.array(z.string()).optional().describe("Subset of sizes, e.g. ['S','M','L']. Default: all in stock."),
          threadColors: z.array(z.string()).optional().describe("Embroidery only, e.g. ['#FFFFFF']."),
          thumbnailUrl: z.string().url().optional().describe("Product thumbnail, e.g. a mockup URL."),
        },
      },
      async (args) => {
        try {
          const placement = args.placement || "front";
          const prod = await printful(`/products/${args.garmentId}`);
          const color = String(args.color).toLowerCase();
          const inColor = (prod.variants || []).filter((v: any) => String(v.color).toLowerCase() === color);
          if (!inColor.length) throw new Error(`Colour "${args.color}" not found on garment ${args.garmentId}`);
          const inStock = inColor.filter((v: any) => {
            const us = (v.availability_status || []).find((a: any) => a.region === "US");
            return us ? us.status === "in_stock" : v.in_stock;
          });
          const wanted = args.sizes?.length ? new Set(args.sizes.map((s) => s.toUpperCase())) : null;
          const rank = (sz: string) => { const i = SIZE_ORDER.indexOf(String(sz).toUpperCase()); return i < 0 ? 99 : i; };
          const variants = inStock
            .filter((v: any) => !wanted || wanted.has(String(v.size).toUpperCase()))
            .sort((x: any, y: any) => rank(x.size) - rank(y.size));
          if (!variants.length) throw new Error(`No in-stock sizes match. In stock: ${inStock.map((v: any) => v.size).join(", ") || "none"}`);
          const threadOption = THREAD_OPTION[placement];
          if (threadOption && !args.threadColors?.length) throw new Error("Embroidered placement: pass threadColors, e.g. ['#FFFFFF']");
          const created = await printful("/store/products", {
            method: "POST",
            body: JSON.stringify({
              sync_product: { name: args.name, ...(args.thumbnailUrl ? { thumbnail: args.thumbnailUrl } : {}) },
              sync_variants: variants.map((v: any) => ({
                variant_id: v.id,
                retail_price: args.retailPrice.toFixed(2),
                files: [{ type: placement, url: args.printfileUrl }],
                ...(threadOption ? { options: [{ id: threadOption, value: args.threadColors!.map((t) => t.toUpperCase()) }] } : {}),
              })),
            }),
          });
          return text({
            created: true,
            printfulProductId: created.id,
            name: args.name,
            sizes: variants.map((v: any) => v.size),
            retailPrice: args.retailPrice.toFixed(2),
            note: "Check Printful's cost for this garment, plus shipping and any tax, against your retail price before promoting it.",
          });
        } catch (err) {
          return fail(err);
        }
      },
    );

    server.registerTool(
      "aetherwave_printful_list_products",
      {
        annotations: { readOnlyHint: true, openWorldHint: true },
        title: "List products in your Printful store",
        description: "Free. Lists products in YOUR Printful store (PRINTFUL_API_TOKEN, used locally only).",
        inputSchema: { limit: z.coerce.number().int().min(1).max(100).optional() },
      },
      async (args) => {
        try {
          const list = await printful(`/store/products?limit=${args.limit || 20}`);
          return text((list || []).map((p: any) => ({ id: p.id, name: p.name, variants: p.variants, synced: p.synced, thumbnail: p.thumbnail_url })));
        } catch (err) {
          return fail(err);
        }
      },
    );
  }

  // ─── AetherWave's own /shop (admins only) ─────────────────────────────────
  if (local && process.env.AETHERWAVE_ADMIN_TOOLS === "1") {
    server.registerTool(
      "aetherwave_shop_create_listing",
      {
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        title: "AetherWave admin: create a /shop merch listing",
        description:
          "ADMIN ONLY (the server rejects anyone else). Creates the product in AetherWave's Printful store and its /shop listing, hidden unless publish=true. Both confirmations are required: the wording was searched in apparel (US Class 25), and nothing names or shows a celebrity or copies another shirt's artwork. Prices: check margin after Printful cost, shipping (included in price) and Printful's sales tax.",
        inputSchema: {
          name: z.string().min(1).max(80),
          description: z.string().min(1).max(1200).describe("No em dashes."),
          brand: z.enum(["ICONIC!", "AetherWave"]).optional(),
          priceUsd: z.coerce.number().min(5).max(500),
          designUrl: z.string().url().describe("From aetherwave_merch_prepare_design."),
          garmentId: z.coerce.number().int().positive(),
          color: z.string().min(1).describe("Exact colour name."),
          placement: z.enum(PLACEMENTS).optional(),
          widthIn: z.coerce.number().positive(),
          topIn: z.coerce.number().min(0).optional(),
          sizes: z.array(z.string()).min(1),
          threadColors: z.array(z.string()).optional(),
          mockupUrls: z.array(z.string().url()).min(1).max(6).describe("First one is the cover. Square images suit the shop grid."),
          publish: z.boolean().optional(),
          confirmTrademarkSearched: z.literal(true),
          confirmNoCelebrityOrCopiedArt: z.literal(true),
        },
      },
      async (args) => {
        try {
          const out = await client.post<any>("/api/admin/merch/create", {
            name: args.name,
            description: args.description,
            brand: args.brand || "ICONIC!",
            priceUsd: args.priceUsd,
            designUrl: args.designUrl,
            garmentId: args.garmentId,
            color: args.color,
            placement: args.placement || "front",
            widthIn: args.widthIn,
            topIn: args.topIn ?? 0,
            sizes: args.sizes,
            threadColors: args.threadColors,
            mockupUrls: args.mockupUrls,
            publish: args.publish === true,
            ack: { trademark: args.confirmTrademarkSearched, noCelebrity: args.confirmNoCelebrityOrCopiedArt },
          });
          return text({ ...out, shopUrl: `https://aetherwavestudio.com${out.shopUrl}` });
        } catch (err) {
          return fail(err);
        }
      },
    );
  }
}
