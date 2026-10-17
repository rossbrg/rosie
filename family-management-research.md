# Family-Management / Family-Calendar Market — June 2026

*Research for Home Slice: what exists, what the category coalesces on, and what to steal.*

## 1. KIN Family Calendar
- Voice-first AI family calendar, iOS-only, by a tiny indie team. "Hold to talk, tap to type" event creation; photo/screenshot→event; recurring events by voice ([kincalendar.com](https://www.kincalendar.com/)).
- Status: v1 launched ~May 2025; very early. "Free for the first 100 adopters," no published pricing model.
- Calendar architecture: own calendar today; **Google/Apple Calendar sync is a planned v2 feature, not shipped** — notable gap.
- No chores, meals, or lists. Roadmap: reminders, schedule Q&A, journaling, iPad/Watch/Mac.
- The [kincalendar-web GitHub repo](https://github.com/kinassistant/kincalendar-web) is just the Next.js landing page — not a self-hostable engine.

## 2. Jam Family Calendar
- Mobile/web SaaS family calendar ([jamfamilycalendar.com](https://www.jamfamilycalendar.com/)).
- Core: shared calendar + to-dos with delegation + shopping lists + "driver assignment" for carpools.
- Signature AI feature: **"Jam On It" email forwarding** — forward any school/sports/appointment email and events auto-populate.
- Syncs Google, Apple, Outlook, plus TeamSnap/GameChanger public calendars.
- Family model: age-tiered permissions (Little Kids / Big Kids / Teens) + caregiver access.
- Pricing hidden on site; App Store shows **$15.99/mo or $119.99/yr per family**. No meal planning, no hardware.

## 3. Hearth Display
- Premium hardware: 27" touchscreen wall display + companion app. **$699 device + membership $9/mo** ([hearthdisplay.com](https://hearthdisplay.com/products/hearth-display)).
- Own "Hearth Calendar" syncing Google/iCal/Outlook + TeamSnap + school-district calendars + ICS imports; shareable caregiver links.
- Heavy kid focus: Routines (expert-designed templates, streaks), **Stars & Rewards** gamification, recurring chores with assignees.
- Meal planning with per-person dietary customization; shared/private reusable lists.
- AI: "**Hearth Helper**" — text-based AI ingest of events and meal plans, school lunch calendar import.
- Unlimited color-coded profiles (incl. pets); privacy mode; mobile app for remote management.

## 4. Skylight Calendar
- Category-leading hardware: 10"/15"/27" devices ($299.99 for 15") + **Calendar Plus subscription $79/yr** ([myskylight.com](https://myskylight.com/calendar/)).
- Syncs Google, Outlook, Apple, Yahoo, **Cozi**; base features work without subscription.
- AI: "**Sidekick**" (Plus-only) — photo of school flyer/sports schedule/PDF → events, email forwarding, **weekly digest**, fridge-scan → recipe suggestions.
- Chores: routines + **star-powered rewards** for kids, per-member profiles, parental lock.
- Meal planning with Sidekick suggestions; color-coded lists + **AnyList integration**.
- Alexa skill; no official API or Home Assistant integration — the HA community resorts to workarounds.

## 5. Mango Display
- **Software-only, BYO screen** (Fire TV, Samsung/Android TV, iPad, Echo Show, PC, Raspberry Pi, browser) ([mangodisplay.com](https://mangodisplay.com/)).
- Free tier (2 screens); **Pro $5.99/mo or $59.99/yr** adds calendar (Google, Outlook, Apple, Cozi), to-dos, **chores & rewards charts**, meal planning, countdowns.
- Display layer, not a system of record — renders calendars/lists from elsewhere. No AI.

## 6. DAKboard
- The OG DIY dashboard (300k+ users): BYO screen or their Wall Display ([dakboard.com](https://dakboard.com/site)).
- Calendar display: Google, iCloud, Microsoft 365, Facebook Events, ICS. To-dos via **Todoist**.
- **Home Assistant + SmartThings integrations and a public API** — the most hacker-friendly of the lot.
- Free tier; **Essential $5/mo, Plus $8/mo**.
- No chores model, no meal planning, no AI — pure glanceable display, skews tech-enthusiast.

## 7. Cozyla
- Hardware undercut play: Calendar+ 2 touchscreen, 15.6" ($349.99) to 32" ($899.99) — **headline: zero subscription, AI included free** ([cozyla.com](https://www.cozyla.com/pages/calendar)).
- AI: "**Cozy**" voice assistant — voice-command event creation, meal planning, chore organization.
- Android-based open platform: installable third-party apps (Ring, YouTube), doubles as photo frame.
- Google calendar sync; chore chart, meal planner, color-coded member scheduling, kid/teen profiles.
- Positioning = "Skylight features without the $79/yr."

## 8. Riley
- **Not a family organizer** — AI baby tracker / child-development coach ($3.1M seed, True Ventures) ([rileyapp.com](https://www.rileyapp.com/)).
- Tracks sleep/feeding/diapers/vaccines; AI predicts nap windows; Q&A grounded in clinical-board-vetted sources.
- **$14.99/mo** (cheaper annual). No shared calendar/chores/meals — evidence the "parenting AI" wedge starts at the newborn end.

## 9. Maple
- "The operating system for modern families" — closest philosophically to Home Slice ([growmaple.com](https://www.growmaple.com/)).
- Core: shared calendar, to-dos/chore tracker, meal planner + recipe box, grocery lists, shared notes, **project folders**, and a **shared family email inbox**.
- AI (paid): organizes forwarded school emails into events/to-dos, meal suggestions, smart notes.
- Free tier generous; **Maple+ $5/mo ($40/yr)** unlocks external calendar sync (Google/Apple/Outlook/TeamSnap), Gmail auto-import, unlimited AI, 5-member family.
- Publishes aggressive comparison SEO vs Notion, Skylight, Hearth — they see Notion-DIY as a competitor.

## 10. Cozi (legacy leader)
- 20-year-old category anchor. Own calendar + color-coded members, shopping lists, to-dos, recipe box/meal planner, agenda emails ([cozi.com](https://www.cozi.com/)).
- **Free (ads) → Cozi Gold $39/yr**.
- 2025–26: launched **Cozi Max** — Gold + AI: forward email/PDF/flyer-photo to a unique inbound address → calendar event; AI Recipe Creator; AI weekly Meal Planner.
- Even the most conservative incumbent now ships email-ingest AI. Skylight and Mango both sync *from* Cozi — it's quasi-infrastructure.

## 11. FamilyWall
- Full-suite family app: free shared calendar, lists, tasks, chat; **Premium $44.99/yr** adds meal planning, Google/Outlook sync, location sharing, document vault, 25GB storage.
- Differentiator: **location/safety bundle** (Life360-lite) + finance tracking. No meaningful AI as of mid-2026.

## 12. OurHome
- Free chore-gamification champion: tasks assigned to one/many/**rotating**, kids earn points → redeem parent-approved rewards; grocery lists + calendar ([ourhomeapp.com](http://ourhomeapp.com/)).
- Still top-rated free chore app in 2026. Proof that chore rotation + points economy is a solved, free problem.

## 13. TimeTree
- Calendar-sharing pure-play (huge in Japan): unlimited shared calendars, per-event chat/photos — **calendar as communication medium**.
- Free with ads; **Premium $44.99/yr**. No chores/meals/rewards.

## 14. AnyList
- Best-in-class shared grocery list + recipe import from any website + meal-planning calendar that **syncs meals to Google Calendar** ([anylist.com](https://www.anylist.com/features)).
- **$14.99/yr household** — the cheapest sustainable subscription in the space. The de facto lists/recipes infrastructure layer.

## 15. AI-first family assistants
- **Ohai.ai** — alive and the segment leader. Text/voice/email-forward interface; scans emails/PDFs/photos → calendar + tasks; syncs Google/Outlook/Apple; meal planning; human backup. Free tier; **premium from $9.99/mo** ([ohai.ai](https://www.ohai.ai/)).
- **Milo (YC W20)** — **dead, early 2026**. Founder: "the technology is simply too early to be reliable in any useful way." ~$40/mo human+AI hybrid; unit economics never worked.
- **Yohana (Panasonic)** — **dead, Sept 30 2025**. Human-concierge task outsourcing; pivoted remnants into "Umi."
- **New 2025–26 crop**: **Nori** (heynori.com — voice+photo+email multimodal ingest, pay-per-AI-use credits); **Sense** (getsense.ai — narrow email→calendar converter); Goldee AI, familymind.ai, Kora, Homsy, Wimely.
- Adjacent signal: a Ford exec built her own family "chief of staff" with Claude Code — DIY-engine demand exists.

## 16. Recent shutdowns / zombies
- **Yohana** (9/2025) — human-concierge too expensive. **Milo** (early 2026) — full-autonomy AI unreliable; human-in-loop killed margins. **Picniic** — zombie.
- Pattern: what died = human-labor-subsidized concierge and trust-me-completely AI. What lives = cheap structured apps with narrow, verifiable AI ingest.

---

## Comparison table

| Product | Type | Cal sync | Chores+assignees | Meals | Lists | AI | Hardware | Price |
|---|---|---|---|---|---|---|---|---|
| KIN | iOS app | Planned (v2) | No | No | No | Voice + photo→event | No | Free (beta) |
| Jam | App/SaaS | Google/Apple/Outlook/TeamSnap | To-dos + delegation | No | Yes | Email-forward→events | No | $119.99/yr |
| Hearth | HW+app | Google/iCal/Outlook/ICS | Routines, rotation, stars | Yes | Yes | Hearth Helper ingest | $699 27" | +$86–108/yr |
| Skylight | HW+app | Google/Outlook/Apple/Yahoo/Cozi | Routines + star rewards | Yes (Plus) | Yes + AnyList | Sidekick: flyer OCR, email, digest | $300–600 | +$79/yr |
| Mango | BYO-screen | Google/Outlook/Apple/Cozi | Chore charts + rewards | Display-level | Yes | None | BYO | Free / $59.99/yr |
| DAKboard | BYO-screen | Google/iCloud/M365/ICS | No (Todoist) | No | Via Todoist | None | Optional | Free / $5–8/mo; HA + API |
| Cozyla | HW+app | Google (+more) | Chore chart | Yes | Yes | "Cozy" voice AI, free | $350–900 | $0/yr |
| Riley | App | n/a | No | No | No | Baby-data insights | No | ~$120/yr |
| Maple | App/SaaS | Google/Apple/Outlook/TeamSnap (paid) | To-dos/chores, assignees | Yes + recipes | Yes | Email→events, AI meals | No | Free / $40/yr |
| Cozi | App | Own + external | To-dos, color-coded | Yes + recipes | Yes | Max: email/flyer→event, AI meals | No | Free / $39+ |
| FamilyWall | App | Google/Outlook (paid) | Tasks | Yes (paid) | Yes | None | No | Free / $44.99/yr |
| OurHome | App | Own | **Rotation + points** | No | Yes | None | No | Free |
| TimeTree | App | Via device cal | No | No | No | None | No | Free / $44.99/yr |
| AnyList | App | Meals→Google Cal | No | **Yes (best)** | **Yes (best)** | None | No | $14.99/yr |
| Ohai.ai | AI SaaS | Google/Outlook/Apple | Tasks | Yes | Yes | Text/email/photo ingest | No | Free / $9.99+/mo |

## A. The coalesced feature set (by ubiquity)

1. **Shared family calendar with color-coding per member** — 100% of organizers. Color-per-person is the universal visual grammar.
2. **Google Calendar sync** (usually + Apple/Outlook) — universal among survivors. Common pattern: own calendar as system of record, external calendars synced in.
3. **Shared shopping/grocery lists** — near-universal.
4. **To-dos with per-member assignment** — near-universal; rotation is rarer (OurHome, Hearth).
5. **Meal planning + recipe box + meals→grocery-list** — now standard in anything calling itself a family organizer.
6. **Member profiles with kid-tier permissions / caregiver access** — standard.
7. **Email-forwarding → calendar events** — the fastest-converging feature of 2025–26: Jam, Skylight, Cozi Max, Maple, Ohai, Nori, Sense all ship it. Table stakes for "modern" entrants.
8. **Kid chore gamification (stars/points → rewards)** — standard on hardware displays and chore apps; absent from calendar-first apps.
9. **Weekly agenda digest** — Cozi agenda emails (20 yrs old), Skylight Sidekick digest, Ohai.
10. **ICS/URL calendar import (school/team calendars), TeamSnap** — common in the school-age tier.

## B. Differentiators (what each leader bet on)

- **Skylight**: hardware ubiquity + Sidekick AI + broadest sync matrix. Bet = the kitchen wall is the UI.
- **Hearth**: premium design + child-development framing. Bet = parenting pedagogy, not just logistics.
- **Cozyla**: no-subscription + open Android + free voice AI. Bet = subscription fatigue.
- **Jam**: software-only, email ingest, carpool assignment, caregiver permissions. Bet = the scheduling parent's phone.
- **Maple**: breadth — shared family email inbox + project folders ("family OS"). Bet = consolidating the whole stack.
- **Cozi**: distribution/incumbency; AI bolted onto a 20-year-old free funnel.
- **Ohai**: conversational interface + human escalation.
- **DAKboard/Mango**: BYO-screen rendering; DAKboard uniquely has Home Assistant + API.
- **OurHome/AnyList**: free/cheap single-job excellence.

## C. AI patterns emerging across the category

1. **Forward-an-email→events** — the #1 pattern, usually via a unique inbound address per family.
2. **Photo/flyer/PDF OCR→events** — "snap the school flyer."
3. **Voice→event** (KIN, Cozyla, Nori; Alexa skills as the legacy version).
4. **AI meal planning** — week plan from prefs, auto-grocery-list; fridge-scan→recipes (Skylight).
5. **Weekly digest / "what's coming" briefings.**
6. **Schedule Q&A / chat** ("what's Friday look like?").
7. **NOT emerging**: autonomous scheduling agents. Milo's post-mortem: full-autonomy family AI is "too early to be reliable." Winners do **constrained extraction with human confirmation**.

## D. Business signals

- **Software pricing converged on $40–50/yr** (Cozi $39, Maple $40, FamilyWall/TimeTree $44.99, Mango $59.99). Jam at $119.99/yr is the outlier. AnyList proves $15/yr sustains a niche.
- **Hardware = $300–700 device + ~$80–110/yr subscription**, except Cozyla's no-subscription attack (and Amazon clones below it).
- **AI is the upsell lever**: every incumbent gates AI behind the paid tier.
- **What died**: human-concierge hybrids (Yohana, Milo). **What survives**: cheap structured tools where AI does bounded ingest and the human confirms.

## E. Implications for Home Slice

**Must-have to feel complete (the coalesced core):**
1. Family calendar with two-way Google Calendar bridge and per-member color identity — the spine of every product.
2. Shared to-dos with assignees + per-person views.
3. Shopping lists (multiple, shareable).
4. Meal planning week view + recipe box + meals→grocery-list pipeline (when someone owns it).
5. Member profiles incl. caregivers (people properties + filtered views; document the caregiver-share pattern).
6. ICS import for school/team calendars through the bridge.

**Stealable differentiators (high fit with self-hosted engine + GCal bridge):**
- **Email-forwarding ingest** — unique inbound address per household → engine parses → creates Notion rows/GCal events, with confirm-before-commit (the Milo lesson). The single most-converged "modern" feature, and exactly what a self-hosted engine does well.
- **School-flyer/photo OCR→event** — same pipeline, image input.
- **Weekly family digest** — cron + template; 20 years of Cozi proves the demand; trivial for an engine.
- **Schedule Q&A over household data** — easy when everything lives in Notion databases.
- **Home Assistant/API friendliness** — only DAKboard serves this audience; natural wedge for the HA crowd.
- **Inventory + maintenance + renovation projects** — *nobody* in this market does these. Maple's "project folders" is the nearest gesture. Home Slice's genuinely uncontested ground.

**Skip or de-prioritize:**
- **Kid gamification** — needs an always-on kid-facing touchscreen; Notion isn't that. Chore rotation covers the adult version.
- **Hardware** — brutal segment; document a DAKboard/Mango/HA-dashboard recipe pointing at the GCal bridge instead.
- **Autonomous AI concierge** — Yohana and Milo are the cautionary tales. Bounded ingest + digest with human confirmation.
- **Location sharing/safety** — off-mission, Life360 owns it.

**Pricing context:** a Notion template + self-hosted engine competes against $0–50/yr software; realistic comparables are Maple ($40/yr) and Cozi Max. The value story: "own your data, no subscription, plus house systems nobody else has."
