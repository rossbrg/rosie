# Reference links from Notion

*Copied 2026-10-17 from the Notion [Home Slice](https://app.notion.com/p/2bd3845658d78074b874f3b9f40e705f) page (last edited 2026-10-01) and the harness-related parts of the Notion "Coding" page. The "Covered in" column says which research doc in this folder already studied each one.*

## Home Slice product list

### Family calendars, displays and planners

| Link | Covered in |
|---|---|
| [KIN family calendar](https://github.com/kinassistant/kincalendar-web) | family-management-research |
| [Jam family calendar](https://www.jamfamilycalendar.com/) | family-management-research |
| [Hearth Display](https://hearthdisplay.com/pages/features) | family-management-research, family-display-owner-reports, apple-design-reference-notes |
| [Skylight Calendar](https://myskylight.com/calendar/) | family-management-research, family-display-owner-reports |
| [Mango Display](https://mangodisplay.com/) | family-management-research |
| [DAKboard](https://dakboard.com/site) | family-management-research, family-display-owner-reports |
| [Cozyla](https://www.cozyla.com/) | family-management-research, family-display-owner-reports |
| [Riley baby tracker](https://www.rileyapp.com/) | family-management-research |
| [Maple family planner](https://www.growmaple.com/) | family-management-research, apple-design-reference-notes |
| [HA-Family-Hub](https://jvarhol.github.io/HA-Family-Hub/) ([GitHub](https://github.com/JVarhol/HA-Family-Hub)) | quick note below (added 2026-10-27) |

### Other products (home, chores, life OS)

| Link | Covered in |
|---|---|
| [Benji, "the life OS"](https://benji.so/) | not yet |
| [Centriq home app](https://mycentriq.com/centriq-app/) | not yet |
| [Mini Castle](https://www.minicastle.app/) | not yet |
| [Homer](https://www.homer.co/) | home-slice-proposal |
| [Tody cleaning routines](https://todyapp.com/) | apple-design-reference-notes |
| [Under My Roof](https://undermyroof.app/) | apple-design-reference-notes |
| [micasa, your house in a terminal](https://micasa.dev/) ([GitHub](https://github.com/cpcloud/micasa), [Show HN](https://news.ycombinator.com/item?id=47075124)) | home-slice-proposal |
| [Home Maint List](https://homemaintlist.com/) | not yet |

### Quick notes on later additions

**HA-Family-Hub** (added 2026-10-27, read from its public site and README only). A free, GPL-3.0 Home Assistant custom integration that turns a wall tablet into a Skylight-style family display: a week or month calendar with a column per person, a "Right Now" bar showing who is home and what is next, meal planning with a recipe box, chores with a star economy and rewards, goals, and morning, afternoon and night routines, with per-person permissions. It installs through HACS as a custom repository. Shared data lives in Home Assistant `todo` and `calendar` entities on the family's own instance, with no cloud service. The backend sends event reminders and a daily digest through Home Assistant `notify` targets and promises the same reminder never fires twice. There is no AI or agent. It is small and young (v1.63.0, 3 stars).

- **Borrow for Rosie:** the daily digest as one calm summary instead of many pings; a "never fires twice" guarantee on every reminder; a "Right Now" glance (what is due today and who owns it) as the top of Rosie's page; and its "your data stays on your instance" stance, which matches Rosie's own store on the VM.
- **Skip:** stars, rewards and kid routines (no school-age kids in the household, and streak-style scoring doesn't fit maintenance); storing records in Home Assistant entities (Rosie owns its own SQLite store, and reminders go by email and push, not Home Assistant).

## Agent and harness links from the Coding page

Saved for the harness research round; none studied yet.

- [How to build a coding agent: free workshop](https://ghuntley.com/agent/) (Geoffrey Huntley)
- Ralph loops: [Ralph Wiggum loop from first principles](https://www.youtube.com/watch?v=4Nna09dG_c0), [Ralph-driven development](https://lukeparker.dev/stop-chatting-with-ai-start-loops-ralph-driven-development), [Don't waste your back pressure](https://banay.me/dont-waste-your-backpressure/), [Advanced context engineering for coding agents](https://www.youtube.com/watch?v=42AzKZRNhsk), [humanlayer Ralph PR](https://github.com/humanlayer/humanlayer/pull/513)
- [Using linters to direct agents](https://factory.ai/news/using-linters-to-direct-agents) (Factory)
- [Claude Skills, the SOP for your agent](https://www.youtube.com/watch?v=1WImBwiA7RA)
- [Building software on top of LLMs](https://simonwillison.net/2025/May/15/building-on-llms/) (Simon Willison)
- [Phoenix](https://phoenix.arize.com/): open-source evals and tracing for agents
- [Swamp Club](https://swamp.club/): agents that build their own tools
