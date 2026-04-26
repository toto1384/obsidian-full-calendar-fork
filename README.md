# Full Calendar Plugin (Community Fork)

> **This is a community fork of the original [Full Calendar plugin](https://github.com/obsidian-community/obsidian-full-calendar) by the Obsidian community.**
>
> The original plugin is a solid foundation, but development has slowed and several quality-of-life features were missing for daily use. This fork exists to make the plugin genuinely usable as a daily driver — with faster performance, better keyboard support, smarter event handling, and tighter integration with the rest of the Obsidian ecosystem.
>
> All credit for the original work goes to the upstream contributors. This fork is maintained independently and is not affiliated with the official plugin.

---

## What's New in This Fork

### Live Event Preview
While editing an event, a ghost preview (👻) now appears on the calendar in real time — so you can see exactly where your event will land before saving.

### Tasks Plugin Integration *(Experimental)*
If you use the [Tasks plugin](https://github.com/obsidian-tasks-group/obsidian-tasks), you can now display your due tasks directly on the calendar. Enable it in settings and pick a color for them.

> **Note:** This feature relies on an unofficial internal API exposed by the Tasks plugin. The API is not officially supported — it was discovered and shared by the community via a GitHub issue on the Tasks repo. **For this feature to work, you also need to install a forked version of the Tasks plugin that implements the API.** The standard Tasks plugin from the community store will not work. Use with that in mind.

### Per-Event Colors
You can now assign a custom color to any individual event, overriding the calendar's default color. A color picker is available in the event edit form.

### Keyboard Shortcuts
Everything is now keyboard-accessible:

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Save event |
| `Ctrl+Backspace` | Delete event |
| `Ctrl+[` / `Ctrl+]` | Shift event ±15 min |
| `Ctrl+-` / `Ctrl++` | Adjust end time ±15 min |
| `Ctrl+Q` through `Ctrl+L` | Select calendar (up to 18) |
| `Ctrl+←` / `Ctrl+→` | Previous / next period |
| `Ctrl+↑` / `Ctrl+↓` | Cycle calendar views |

### Click a Day to Open Its Daily Note
Clicking on a day header or an empty calendar slot now opens (or creates) the corresponding daily note.

### Time Slot Color Coding
The time grid is now color-coded by time of day to make schedules easier to scan at a glance:
- **Morning** (7am–1pm) — green
- **Afternoon** (1pm–5pm) — blue
- **Evening** (5pm–11pm) — yellow

### Zoom Controls
Use the `+` and `−` buttons in the toolbar to zoom the time grid in or out.

### Reload Button
A `↻` button in the toolbar lets you manually force-refresh all calendars.

### Habit Completion on Day Headers *(requires compatible habit tracker)*
If you use a compatible habit tracker plugin, a colored pie indicator appears on each day header showing your habit completion rate for that day.

## Improvements Over the Original

- **Faster calendar loading** — Events are now loaded in parallel and filtered to the visible date range, so large vaults load much faster.
- **Better ICS timezone support** — Events from remote ICS feeds now display in your local timezone correctly, including daylight saving time.
- **Smarter recurring event editing** — Editing a single occurrence of a recurring event no longer modifies the whole series. The edited date is skipped in the original series and saved as its own event.
- **Smarter file naming** — Event files are now named `{Title} {Date} {Time}.md`, making them easier to find and sort in your vault.
- **All-day events detected automatically** — Events with no time information are now correctly treated as all-day events.
- **Event duration shown on calendar** — Events longer than 30 minutes now display their duration (e.g. `1h 30m`) directly on the calendar block.
- **Auto-refresh** — The calendar silently refreshes every 30 seconds to stay up to date.
- **Non-editable event details** — Clicking on a read-only event (e.g. from an ICS feed) now shows a details panel instead of doing nothing.

---

![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22obsidian-full-calendar%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json)

Keep your calendar in your vault! This plugin integrates the [FullCalendar](https://github.com/fullcalendar/fullcalendar) library into your Obsidian Vault so that you can keep your ever-changing daily schedule and special events and plans alongside your tasks and notes, and link freely between all of them. Each event is stored as a separate note with special frontmatter so you can take notes, form connections and add context to any event on your calendar.

Full Calendar can pull events from frontmatter on notes, or from event lists in daily notes. Full Calendar also supports read-only ICS and CalDAV remote calendars.

You can find the full documentation [here](https://obsidian-community.github.io/obsidian-full-calendar/)!

![Sample Calendar](https://raw.githubusercontent.com/obsidian-community/obsidian-full-calendar/main/docs/assets/sample-calendar.png)

The FullCalendar library is released under the [MIT license](https://github.com/fullcalendar/fullcalendar/blob/master/LICENSE.txt) by [Adam Shaw](https://github.com/arshaw). It's an awesome piece of work, and it would not have been possible to make something like this plugin so easily without it.

[![Support me on Ko-Fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/M4M1GQ84A)

## Installation

Full Calendar is available from the Obsidian Community Plugins list -- just search for "Full Calendar" paste this link into your browser: `obsidian://show-plugin?id=obsidian-full-calendar`.

### Manual Installation

You can also head over to the [releases page](https://github.com/obsidian-community/obsidian-full-calendar/releases) and unzip the latest release inside of the `.obsidian/plugins` directory inside your vault.
