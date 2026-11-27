# AetherWave inside ChatGPT: step 1 scoping report

mcp-desk, 2026-11-27. Row 74, brief `docs/BRIEF-chatgpt-app.md` in the platform repo. Scoping only, nothing built.

Every OpenAI fact below was read on **2026-11-27** from the URL next to it. "Not confirmed" means I looked and the pages read did not say.

## The three facts that most change the plan

1. **A ChatGPT plugin may not sell credits or link to a checkout.** "Selling digital products or services, including subscriptions, digital content, tokens, or credits, is not allowed, whether offered directly or indirectly (for example, through freemium upsells)." A plugin may tell a user a feature needs more credits than they have, but it "should not initiate a checkout or transaction flow" and may not "Link directly to a checkout or other transactional page." Members who sign in can spend credits they already hold. ([plugin guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)) **What changes:** our 0.5.4 credit wall (a one-tap link to the right pack) must not reach ChatGPT. The ChatGPT build needs its own 402 wording. Every purchase happens on our site after the user leaves ChatGPT, so we measure this channel by account creation and week-1 site activity, as the brief says, and never by in-chat sales.
2. **Getting suggested mid-conversation is not part of being listed.** OpenAI says plugins with "strong real-world utility and high user satisfaction may be eligible for enhanced distribution opportunities, such as directory placement or proactive suggestions." That is a possible reward, not a guarantee. The guaranteed paths are the directory (tools menu, chatgpt.com/apps) and the user typing @AetherWave. ([guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines), [announcement](https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/)) **What changes:** the video's premise ("recommends plugins mid-conversation") is not something we can count on. Our first version has to work for people who already know our name, and satisfaction will decide whether we ever get suggestions. That argues for two or three tools that work every time, not sixteen.
3. **Our sign-in is already most of the way there.** ChatGPT requires OAuth 2.1 with PKCE S256, Protected Resource Metadata (RFC 9728), and either dynamic client registration or a client metadata document ([auth](https://developers.openai.com/apps-sdk/build/auth)). Our live authorization server (`https://aetherwavestudio.com/.well-known/oauth-authorization-server`, read 2026-11-27) already advertises S256, a `registration_endpoint`, and code plus refresh grants. The remote host already serves `/.well-known/oauth-protected-resource` and the `WWW-Authenticate` challenge, the same flow the Claude connector uses in production. **What changes:** sign-in costs days, not weeks. The Opus review covers the small changes listed in section 4, not a new auth system.

Also: the product is now called **plugins**. The submission guidelines page is titled "Plugin guidelines," and its directory is "the universal directory shared by ChatGPT and Codex."

## 1. What the thing is today

| Fact | Source |
|---|---|
| The name is "plugins": an MCP server, optional UI, and skills, listed in the ChatGPT Directory | [apps-sdk index](https://developers.openai.com/apps-sdk), [guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines) |
| It runs on MCP: "Plugins use the Model Context Protocol (MCP)" | [quickstart](https://developers.openai.com/apps-sdk/quickstart) |
| The transport is MCP streamable HTTP, at a "stable, publicly reachable HTTPS endpoint," typically ending in `/mcp`. Tunnels and local endpoints are not accepted for submission. | [deploy](https://developers.openai.com/apps-sdk/deploy) |
| UI is optional ("do not register a UI resource" if you only need tools). When used, it follows the MCP Apps standard (`ui://` resources, `text/html;profile=mcp-app`), and `window.openai` is described as legacy. | [quickstart](https://developers.openai.com/apps-sdk/quickstart), [reference](https://developers.openai.com/apps-sdk/reference) |
| Every tool needs `readOnlyHint`, `destructiveHint` and `openWorldHint` as explicit booleans. "Starting stateful jobs or workflows, queuing work" means `readOnlyHint: false`. | [guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines) |
| A tool that returns `structuredContent` must declare `outputSchema` | [reference](https://developers.openai.com/apps-sdk/reference) |
| Server `instructions` should keep the key details within the first 512 characters | [deploy](https://developers.openai.com/apps-sdk/deploy) |

**Our fit:** the remote host (`mcp.aetherwavestudio.com/mcp`, src/http.ts) is already streamable HTTP over public HTTPS. Our tools carry annotations today, but each one needs checking against the strict reading above. All of our generators queue work, so they must be `readOnlyHint: false`.

**Not confirmed:** limits on tool count, response size, and call timeouts. No page I read gives numbers. Our own 45 s contract (state `running` plus `get_job`) is the safe assumption.

## 2. How a tool gets recommended

- "ChatGPT and Codex decide when to call your tool based on the metadata you provide." OpenAI's method: build a golden set of direct, indirect and negative prompts, and score precision and recall after every wording change. Descriptions start with "Use this when..." and say when not to use the tool. ([optimize metadata](https://developers.openai.com/apps-sdk/guides/optimize-metadata))
- The guidelines ban descriptions that "favor or disparage other plugins" and ban "overly broad triggering." Names should be verbs, unique, and must not use "best" or "official." ([guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines))
- Users reach a plugin through the directory, the tools menu, or an @ mention. Proactive suggestions are an "experiment" and a reward for utility and satisfaction (fact 2). ([announcement](https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/), [help](https://help.openai.com/en/articles/12503483-apps-in-chatgpt-and-the-apps-sdk))
- "App availability depends on the app, your ChatGPT plan, region, workspace, role, model, and ChatGPT interface you use." ([help](https://help.openai.com/en/articles/12503483-apps-in-chatgpt-and-the-apps-sdk))
- **Not confirmed:** how directory ranking works, whether usage counts, and which plans see directory plugins.

## 3. Submission and policy

**Process** ([submission](https://developers.openai.com/apps-sdk/deploy/submission), [guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)):
- Submitted by a verified individual or organization, from the org owner or a member with "Apps Management Write."
- One remote MCP server per plugin, plus domain verification with a challenge file.
- A "fully featured demo account that includes sample data," with no MFA. The credentials go in the review form.
- Five positive test cases, three negative test cases, and a video walkthrough URL.
- A published privacy policy covering data categories, purposes, recipients, retention and user controls. Support contact details.
- A country list.
- One active review per plugin at a time. Changes to metadata need a new submission. Changes to the MCP server are scanned daily and go live after automated checks, with no resubmission.
- Review time: "we are unable to offer estimated times for reviews" ([help 20001040](https://help.openai.com/en/articles/20001040), which redirects to the submission page).

**Content:**
- "Plugins must be suitable for general audiences, including users aged 13 to 17." Mature (18+) support "will arrive once appropriate age verification and controls are in place." ([guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)) **For us:** the ChatGPT build may not offer any model or mode we gate at 18+, and image and video moderation must stay at the site's strict setting for every call.
- "Only use content or intellectual property that you own or have permission to use." I found no rule specific to AI-generated music or images. **For us:** the no-promises-about-rights line in the brief stands, and music descriptions say nothing about streaming or resale.

**Data:**
- Collect only the "minimum data required," use only chat context the model sends, use coarse location only, and do no undisclosed tracking ("timestamps, IP addresses, or query patterns"). ([guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines))
- **For us:** our privacy policy needs a paragraph on ChatGPT-linked accounts before submission. That paragraph is public copy for Andrew.

**Commerce:**
- No credit sales and no checkout links (fact 1).
- "Plugins must not serve advertisements."
- Descriptions may not advertise "pricing, subscriptions, free trials, discounts, or promotions." This rules out "50 free credits" in any tool text.
- Requiring an account is allowed, as long as auth is "transparent and explicit." Users may "sign in to an existing paid account."
- **Not confirmed:** whether a user may *create* a new account inside the sign-in pop-up. Nothing I read forbids it, and "existing" is the only word the guidelines use. This matters, because new accounts are the whole lead-generation case. I would ask OpenAI or read a listed competitor's flow before we build on it.

**Testing:** Pro users can connect a custom MCP server from the web for testing ("No - web only"). Business admins can create and publish, and Developer Mode is not needed first. ([help 12584461](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)) **Open question:** which ChatGPT plan do we test from?

## 4. Sign-in: what is built, designed and missing

| Requirement ([auth](https://developers.openai.com/apps-sdk/build/auth)) | Our state |
|---|---|
| OAuth 2.1 authorization code flow with PKCE, `code_challenge_methods_supported` including S256 | **Built and live.** The metadata says `["S256"]`, and `/oauth/authorize` rejects anything else (server/oauth-routes.ts). |
| Protected Resource Metadata at `/.well-known/oauth-protected-resource`, plus a 401 `WWW-Authenticate: Bearer resource_metadata=...` | **Built and live** on the remote host (src/http.ts) |
| Client registration through DCR (`registration_endpoint`) or CIMD (ChatGPT's client id is `https://chatgpt.com/oauth/client.json`, `client_id_metadata_document_supported`) | **DCR is built and live.** It accepts any absolute https redirect URI, so ChatGPT's callback registers today. CIMD (preferred by OpenAI) is **missing**. It is optional while DCR works. |
| Redirect URI `https://chatgpt.com/connector_platform_oauth_redirect` if the AS advertises RFC 9207 `iss`, otherwise `https://chatgpt.com/connector/oauth/{callback_id}` | **No `iss` support** (missing), so ChatGPT will use the per-connector callback. DCR accepts it. Adding `iss` is a small, optional change. |
| ChatGPT sends `resource=`, and the token's audience should match it | **Partly built.** Our tokens are opaque (`awo_`) and validated by the platform, so audience binding is not enforced. Needs a decision in the Opus review: record and check `resource` per token, or accept the gap with a written reason. |
| Mixed auth: `securitySchemes` per tool can be `noauth` or `oauth2` | **Designed only** for our case. Today the host turns away an anonymous caller before any tool. A free signed-out tool needs a per-tool `noauth` path and a rate limit per user and per IP. The docs disagree on where `securitySchemes` sits (top-level on the auth page, inside `_meta` as a "back-compat mirror" in the reference). Pin this against the live validator when we build. |
| A signed-out user signs up through the pop-up | **Built:** `/oauth/authorize` bounces a signed-out user through `/api/login?returnTo=...` and comes back to consent. **Not confirmed** that OpenAI allows a new account to be created here (section 3). |
| Attribution tag that survives the round trip | **Missing.** Nothing in the OAuth path tags the account. Proposal: tag at the consent step when the DCR client's redirect host is `chatgpt.com`. That is server-side, so it cannot be lost in the round trip, and it needs no `?via=` that `/api/login` would have to carry. Set `acquisition_source = 'chatgpt_plugin'` only when the account was created inside this flow (created_at after the authorize request started). An existing member who links is counted as a link, not a signup. This is a platform PR on a sign-in file, so it gets the Opus review. |

## 5. What carries over

The source registers 38 tool names (src/index.ts). No tool carries over byte for byte, because every description must be rewritten in the "Use this when..." form, stripped of prices and promotions, and checked against the strict annotation rules. In substance:

| Group | Count | Tools | Verdict |
|---|---|---|---|
| Read-only lookups | 13 | balance, list_image_models, list_video_models, list_master_presets, list_voices, list_characters, list_my_creations, get_job, get_user_manual, merch_garments, comic_estimate, comic_status, merch_mockup_status | **Carry over with metadata changes.** `balance` may show the number but no top-up link. |
| Spend the member's own credits | 18 | generate_image, edit_image, generate_music, generate_video, generate_speech, master_audio, reframe_image, reframe_video, remove_background, remove_background_video, upscale_image, upscale_video, upload_to_gallery, merch_mockup, merch_prepare_design, comic_create, comic_write_script, comic_draw | **Need changes:** a ChatGPT-specific 402 with no pack link, `readOnlyHint: false`, strict moderation, and no 18+ paths. Allowed by policy once signed in. |
| Multi-step builders | 2 | comic_character_reference, comic_assemble | **Need changes**, same as above. Not for a first version. |
| Should not be exposed | 5 | comic_redraw_panel (overwrites a finished book), shop_create_listing, printful_create_product, printful_list_products (commerce through our shop needs OpenAI's physical-goods approval and an external checkout), comic_export (fine in itself, but no reason to ship it before the comic set) | **Leave out.** |

38 total: 13 + 18 + 2 + 5.

**On the brief's shortlist:**
- **Prompt Machine** has no MCP tool today, and the site **charges credits for it** (`/api/prompt-machine/charge` deducts `prompt_machine`). That means it costs us something (an LLM call). It is not the zero-cost free tool the brief assumed. It works as a signed-in tool on the member's credits. As a signed-out free tool, it needs a measured cost per call and a rate limit before Andrew decides.
- **Master a track:** `POST /api/master-audio` runs on our own Python service and charges `MASTERING_CREDITS`, which is free on producer, mogul and ultimate plans and during a mastering promo. Our cost is our own compute, near zero per call. It is still synchronous with no job id, so the ChatGPT version needs the job-id change already proposed for `master_audio` recovery, or a track short enough to finish inside the timeout.
- **Album art:** this is `generate_image` with a fixed shape and model. It is signed-in only, on the member's credits, as the brief says.

**Phrases for names and descriptions:** not done yet. They depend on Search Console and VoxBot logs, which I have not pulled. They come with step 2, before any wording goes to Andrew.

## 6. Effort to a submitted first version (three tools)

**Must have, about 5 working days of desk time** (OpenAI's review time comes on top of this, and they do not estimate it):

| Item | Days |
|---|---|
| A ChatGPT tool profile on the remote host (its own path, its own TOOL_POLICY: three tools plus get_job and balance), strict annotations, "Use this when..." descriptions, golden prompt set (5 positive and 3 negative) | 1.5 |
| A 402 for ChatGPT callers with no pack link and no price | 0.5 |
| Attribution at OAuth consent (platform PR, sign-in file), plus the `resource` decision, with Opus review | 1 |
| Test in ChatGPT on the web: link, sign up, generate, find the result in the gallery | 1 |
| Submission package: demo account with no MFA and sample data, video walkthrough, privacy policy paragraph, domain verification file, country list, wording to Andrew | 1 |

**Nice to have, after v1:**
- A result card UI (MCP Apps) that shows the art or the track in the chat: 2 to 3 days.
- CIMD and RFC 9207 `iss`: 0.5 day.
- A signed-out free tool with rate limits and a cost meter: 1 to 2 days, only if Andrew approves a free tool after seeing its real cost.

## 7. Questions for Andrew (step 2 waits on these)

1. **The channel cannot sell.** Is it still worth building for signups and site visits alone? I think yes: 36% of September signups already came from ChatGPT with no integration at all.
2. **Which three tools?** My pick is album art, master a track, and Prompt Machine as a signed-in tool on the member's credits. That means no signed-out free tool in v1, because none of the three costs us exactly nothing.
3. **Which account submits?** Submission needs a verified OpenAI organization, and testing needs a ChatGPT Pro or Business seat.
4. **May I ask OpenAI** (or check a listed plugin) whether creating a new account inside the sign-in pop-up is allowed? It decides whether this is lead generation at all.
