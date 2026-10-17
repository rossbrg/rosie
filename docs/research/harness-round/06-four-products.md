# 06: Product teardown (Benji, Centriq, Mini Castle, Home Maint List)

Researched 2026-10-17 from public pages only: no sign-ups, no installs. **[I]** marks an inference. "Not stated" means I looked and the public pages don't say.
The pages were read through a summarizing fetch tool, so short quotes may be paraphrased.

---

## 1. Benji, "The Life OS" (https://benji.so/)

**What it is.** A single app for many parts of life. Its pitch is "Replace a dozen apps with one." It covers todos and projects, habits, routines, a planner, pomodoros, goals, health, food, journaling, finances, trips, and "Household chores" (https://benji.so/).
**Status / pricing.** Active. Pro costs $10/mo or $96/yr, with a 7-day free trial and no card needed (https://benji.so/#pricing).
- Platforms are listed as web, iOS, Android, Mac, Windows and Linux (https://benji.so/). However, the iOS page says the App Store release is "coming soon" and points to a TestFlight beta or a home-screen web app (https://benji.so/downloads/ios).
- The changelog returned an error ("Status 410") (https://benji.so/changelog).
- The blog's last product posts are from March 2025, for example "Introducing Benji Alpha". Since then there are about 40 generic productivity posts dated 18-19 June 2026 (https://benji.so/blog). **[I]** That looks like an SEO push, and the pace of product work is hard to judge.
- The founder posted on HN: "2 years ago I launched Benji ... (but rewrote it from scra[tch])" (https://news.ycombinator.com/item?id=40872858). The page itself would not load, so this comes from the search snippet.

**Data model.** Todos, lists, projects, habits (grouped into lists such as "Home", "Personal" and "Work", and by routine), routines, planner time blocks, goals, journal entries and trackers. The gallery shows habit grids, heatmaps and letter-grade "habit scores" (https://benji.so/gallery). Lists, habits and planners can be shared "with family or collaborators" (https://benji.so/).
**Recurring / reminders.**
- The comparison page says "your habits are more than just recurring tasks" and that a cleaning routine should not be a todo list (https://benji.so/vs/todoist).
- **[I]** Recurring chores are therefore modeled as habits or routines with streaks, not as an asset-plus-schedule maintenance model.
- Reminders are confirmed only for habits and medications. The todo comparison table lists email, location and push reminders, but the support cells didn't render (https://benji.so/vs/todoist).
- There are no appliance records, service intervals or overdue escalation (https://benji.so/, https://benji.so/gallery).

**AI / agent.** "AI assistant & integrations" appears as one line in the Pro plan. No page explains it. "API Soon" is in the footer (https://benji.so/).
**Onboarding.** A free trial that opens straight into the web app. No home templates are described (https://benji.so/).
**Reviews.** None found on the App Store, Reddit or Product Hunt. Searches for "Life OS" bring up unrelated Product Hunt products (for example https://www.producthunt.com/products/life-os-6). The site shows no testimonials (https://benji.so/).

**Borrow for Rosie**
- A fast capture "launcher" with keyboard shortcuts for logging (https://benji.so/). This is a good fit for Rosie's future "tell Rosie" input box.
- A timeline or history view of changes over time (https://benji.so/). Rosie's completion log can double as a home history.
- Shared lists between two people without separate accounts per list (https://benji.so/).

**Avoid**
- Breadth over depth. Chores are one bullet among about 30 features, and nothing understands an appliance or a service interval. Rosie should stay narrow.
- Streaks and letter grades for chores (https://benji.so/gallery). Missing a "flush water heater" streak means nothing; an overdue date does.

---

## 2. Centriq (https://mycentriq.com/centriq-app/): **shut down. Confirmed.**

**Status.** Dead. On 2026-10-17, the URL above returned a 302 redirect to `globaldispatchespodcast.com`, which is now a Vietnamese football-streaming and betting site (checked directly).
- Google Play: AppBrain lists it as "Unpublished", last seen 29 Oct 2025. The last update was v5.1 on 8 Apr 2025. It had about 50k+ installs and a 2.96/5 rating from 267 ratings. The developer was Centriq Technology LLC (https://www.appbrain.com/app/centriq/com.centriqhome.centriq).
- **Shutdown date: 31 Jan 2026 [I, best-supported].** One source says users were told in December 2025 that it was being "retired and sold", got "about six weeks of notice", and "On January 31, 2026, Centriq deleted everything" (https://www.smarthomeadmin.com/blog/home-management-app-shutdowns).
  - Another page agrees on 31 Jan 2026 and says Homer shipped a Centriq CSV importer on 18 Dec 2025 (https://realestateledger.io/comparisons/homezada-vs-centriq).
  - Some competitor pages say 31 Jan **2025** instead (https://homebeacon.app/alternatives/centriq-alternative, https://realestateledger.io/guides/home-maintenance-schedule-app). That conflicts with the April 2025 app update.
  - All of these sources are competitor SEO pages. I found no primary shutdown notice.
- **What users lost.** Centriq was acquired "in 2021 and again in 2022" (https://www.smarthomeadmin.com/blog/home-management-app-shutdowns).
  - The export was a CSV of text fields only. Photos, receipts and uploads had to be saved one at a time, and Centriq's own images and manuals could not be exported (same source; also https://domidocs.com/homeowners-guide/centriq-alternative/).
  - After the cutoff, accounts were deleted. This is the "Centriq'd" scenario Ross's earlier doc mentions.
- **Business model.** It was free to consumers and paid for by affiliate links (Amazon parts, HomeAdvisor) and partnerships (https://www.thisoldhouse.com/smart-homes/keep-track-of-home-maintenance-with-the-centriq-home-app).
  - HomeServe USA took an equity stake and licensed the platform in 2019 (https://www.contractingbusiness.com/residential-hvac/homeserve-usa-invests-technology-company-centriq).
  - It won the NAHB 2016 "Platinum Game Changer" award (same source).

**Data model.** Property, then room (or function, such as HVAC or AV), then item or appliance (make, model, serial). Each item could hold manuals, notes, photos, videos and receipts (https://www.thisoldhouse.com/smart-homes/keep-track-of-home-maintenance-with-the-centriq-home-app, https://www.biggerpockets.com/renewsblog/free-app-home-maintenance).
**Recurring / reminders.** These were weak. In 2017, maintenance schedules were only "planned" (This Old House, above). A later listing mentions "maintenance timelines" but no alerts (https://www.probuilder.com/products/product/55260497/home-management). It did send recall notifications (BiggerPockets, above).
**AI / onboarding.** Its signature feature was onboarding: photograph the rating plate or UPC, and the app identified make and model. Manuals, how-to videos and parts links then attached automatically, at first with roughly 24-hour human or OCR turnaround (BiggerPockets and This Old House, above). **[I]** It was an early form of "scan to enrich", not generative AI.
**Reviews.** 2.96/5 on Google Play (AppBrain, above). This Old House praised the scan-to-manual flow in 2017.

**Borrow for Rosie**
- Plate photo to model and serial to manual link as the way to create an item. Today a vision LLM can do this instantly, as a *proposal* the user approves.
- Group items by room **and** by system (HVAC, plumbing), not just one hierarchy.
- Recall checks keyed on model number are a cheap, high-value alert. **[I]** The CPSC data source still needs to be verified.

**Avoid**
- Content Rosie can't export. Centriq-hosted manuals and images were lost with the service. Rosie should store copies of the files it relies on and keep exports complete (files included), or keep the data in an open format from day one.
- A free product funded by affiliates or partners. That incentive led to two acquisitions and then deletion.

---

## 3. Mini Castle / "Minicastle" (https://www.minicastle.app/)

**What it is.** "Digital Power Tools for Fearless Homeowners." It tracks repairs, projects and inventory (https://www.minicastle.app/). On iOS it is sold as "Minicastle: Home Manager" by Shiny Buildings, Inc.; the listing still mentions its former name, "Camelot" (https://apps.apple.com/app/id6751024112).
**Status / pricing.** Active and small.
- iOS versions shipped from 1.2.3 (24 Nov 2025) through 1.5.1 (14 Sep, which added web cloud sync). It is rated 5.0 from only 3 ratings (https://apps.apple.com/app/id6751024112).
- Web pricing: Free forever, which gives unlimited areas, issues, inventory and co-owners but only 1 project. "Minicastle Max" costs $24.99/yr and adds unlimited projects (https://www.minicastle.app/).
- iOS in-app purchases: $3.99, $15, $24.99, or $92.99 lifetime (App Store, above).
- A March 2024 changelog listed "Pro" at $85/yr and limited the free plan to one house (https://minicastle.productlane.com/changelog/2024-03-30-what-s-new-march-2024). **[I]** Pricing has changed several times.

**Data model.** Building (home, condo, farm, vehicle) contains:
- **Areas** (rooms or systems).
- **Issues**: tasks, each with photos, status, priority, cost, dates, hours and links.
- **Recurring Issues**.
- **Projects**, which group issues and roll up cost and time.
- **Inventory**: equipment, appliances and systems, with "relationships, costs, and quantities".
- **Links**: files, receipts and manuals.
- **Co-Owners**: unlimited.
Sources: https://www.minicastle.app/ and https://apps.apple.com/app/id6751024112.

**Recurring / reminders.**
- "Recurring Issues" for routine maintenance let you "set it and forget it". A Calendar shows scheduled issues **and warranty expirations**, and "Digests & Reports" send reminders (https://www.minicastle.app/).
- Due dates sync to the device calendar (App Store, above).
- Not stated publicly: whether recurrence repeats from the completion date or on a fixed schedule, and how often digests are sent. The docs pages I checked don't cover it (https://docs.minicastle.app/questions/).

**AI / agent.** None mentioned (https://www.minicastle.app/, App Store).
**Onboarding.** "Set up in minutes", with no card needed (https://www.minicastle.app/).
- There is a dismissible onboarding checklist (2024 changelog, above).
- The Homeowner's Guide is a pre-built checklist that you **add item by item to your issue board**, or copy as a Google Sheet. It has four sections: routine maintenance (1x or 2x/yr), chores (weekly or monthly), upgrades, and winter prep (https://www.minicastle.app/guides/homeowners-guide).
- It works offline without a login (App Store).
- CSV export is available per tab, on desktop only (https://docs.minicastle.app/questions/).

**Reviews.** "clean, intuitive, and actually fun to use"; "replaced spreadsheets and linked files". A user asked for multi-device access, and the developer replied that it now exists (App Store reviews, above). Only 3 ratings, so treat this as anecdote.

**Borrow for Rosie**
- Inventory items that can *link* to tasks and to each other ("relationships"). Example: a mini-split, its 4 indoor heads, and the "vacuum inserts" schedule.
- Warranty expirations shown on the same calendar as maintenance.
- A suggestion library that the user *adds* from, instead of a firehose of auto-created tasks. This fits Rosie's propose-and-approve agent pattern.
- An emailed digest as the main reminder channel, plus calendar sync (ICS) for free.

**Avoid**
- Calling chores and repairs one "Issue" type with a recurrence flag on top. **[I]** That blurs the distinction between a schedule and an occurrence. Rosie should keep Schedule, then Occurrence, then Completion separate.

---

## 4. Home Maint List (https://homemaintlist.com/)

**What it is.** "a todo list where you can schedule tasks, get reminders, and obtain expert knowledge" (https://homemaintlist.com/). It is a hobby or side project credited to "Codewalkers", a personal tech blog by the same author, which also links to their "Reserve My Meal" (https://codewalkers.net).
**Status / pricing.** It is online, and the Codewalkers footer reads © 2026 (https://codewalkers.net). The homepage shows no copyright or "last updated" date (https://homemaintlist.com/). Everything is free: it will "never ask you for any payment details" (https://homemaintlist.com/).
**Data model.** User, then **House** ("unlimited houses"; task lists are "unique to each house"), then **Task**. Users can edit the schedule of library tasks and add custom tasks (https://homemaintlist.com/).
- Each library task page has a default schedule, a description, "Things You'll Need", "Time Involved", numbered steps, an embedded YouTube video, and comments (https://homemaintlist.com/tasks/replace-ac-furnace-filter).
- There are no item or appliance records and no sharing (homepage).

**Recurring / reminders.** Schedules are **anchored to the calendar**, not to completion. Examples: "Every 4 months on the 15th", "The 5th of every month", "Every year on January 20" (https://homemaintlist.com/tasks).
- There are views for past-due and upcoming tasks.
- "We'll remind you when things are due". The channel isn't stated; **[I]** probably email, since it's a web-only site (https://homemaintlist.com/).

**AI / agent.** None.
**Onboarding.** Register, add a house, and start from a 28-task library. Examples include filters, water softener salt, smoke/CO tests, water heater flush, disposal, fireplace, roof, power wash and carpets. There is no filtering by home type, pool or septic (https://homemaintlist.com/tasks).
**Reviews.** None found. Searches return unrelated checklist pages and apps (search on "homemaintlist").

**Borrow for Rosie**
- Task "how-to cards" with time involved, things needed, steps and a video link. Attach one to each Schedule so the reminder email is useful on its own.
- Spread annual tasks across specific dates (fireplace in September, roof in September, water heater in March) so they don't all come due at once. Rosie should support "every year on Mar 10" *and* "every 3 months after the last completion".

**Avoid**
- Calendar-only recurrence. If the filter change slips by 6 weeks, the next one should usually be due 4 months after it was *done*, not on the next "15th".

---

## Across the four

- **Nobody ships an agent.** Benji's "AI assistant" is one undocumented line, and the other three have no AI. Rosie's "tell it in plain language, approve a proposed change" loop is genuinely differentiated. Centriq's photo-of-the-rating-plate onboarding is the closest precedent, and it is exactly the kind of thing to rebuild as an LLM *proposal*.
- **Two data-model camps.** Asset-centric apps (Centriq, Minicastle inventory) know *what* you own but are weak on schedules. Task-centric apps (Home Maint List, Benji habits) know *when* but not *what*. Rosie's Item, Schedule, Occurrence (with owner) and Completion model bridges both. None of the four visibly models per-occurrence owners or overdue escalation.
- **Recurrence semantics matter.** Home Maint List uses fixed calendar dates, and Benji treats chores as streaky habits. Rosie needs both "fixed date" and "N after last completion" anchors, chosen per schedule.
- **Starter libraries work best as suggestions you opt into.** Home Maint List has 28 tasks and Minicastle has a checklist you add from. Nobody tailors the list by home features (mini-splits, softener, septic). That is an easy win for Rosie's agent: ask a few questions, then propose schedules.
- **Durability is a feature.** Centriq ran for about 10 years **[I]** (it won an award in 2016 and closed in 2026), was acquired twice, gave about 6 weeks' notice, and its export left out attachments. Rosie should keep the data in Ross's own store, and make complete exports (files included) a first-class feature.
