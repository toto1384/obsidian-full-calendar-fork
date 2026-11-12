import { MarkdownView, Notice, Plugin, TFile, normalizePath } from "obsidian";
import {
	CalendarView,
	FULL_CALENDAR_SIDEBAR_VIEW_TYPE,
	FULL_CALENDAR_VIEW_TYPE,
	getCalendarColors,
} from "./ui/view";
import { renderCalendar } from "./ui/calendar";
import { ColorMode, toEventInput } from "./ui/interop";
import {
	DEFAULT_SETTINGS,
	FullCalendarSettings,
	FullCalendarSettingTab,
} from "./ui/settings";
import { EventSourceInput } from "@fullcalendar/core";
import { OFCEvent, PLUGIN_SLUG } from "./types";
import EventCache from "./core/EventCache";
import { ObsidianIO } from "./ObsidianAdapter";
import { launchCreateModal } from "./ui/event_modal";
import FullNoteCalendar from "./calendars/FullNoteCalendar";
import DailyNoteCalendar from "./calendars/DailyNoteCalendar";
import ICSCalendar from "./calendars/ICSCalendar";
import CalDAVCalendar from "./calendars/CalDAVCalendar";
import TasksCalendar from "./calendars/TasksCalendar";

export default class FullCalendarPlugin extends Plugin {
	settings: FullCalendarSettings = DEFAULT_SETTINGS;
	cache: EventCache = new EventCache({
		local: (info) =>
			info.type === "local"
				? new FullNoteCalendar(
					new ObsidianIO(this.app),
					info.color,
					info.directory
				)
				: null,
		dailynote: (info) =>
			info.type === "dailynote"
				? new DailyNoteCalendar(
					new ObsidianIO(this.app),
					info.color,
					info.heading
				)
				: null,
		ical: (info) =>
			info.type === "ical" ? new ICSCalendar(info.color, info.url) : null,
		caldav: (info) =>
			info.type === "caldav"
				? new CalDAVCalendar(
					info.color,
					info.name,
					{
						type: "basic",
						username: info.username,
						password: info.password,
					},
					info.url,
					info.homeUrl
				)
				: null,
		tasks: (info) =>
			info.type === "tasks"
				? new TasksCalendar(this.app, info.color)
				: null,
		FOR_TEST_ONLY: () => null,
	});


	translateSources(cache: EventCache, dateRange?: { start: Date; end: Date }) {
		return cache.getAllEvents(dateRange).map(({ events, editable, color, id }): EventSourceInput => ({
			id,
			events: events.flatMap(
				(e) => this.eventInput(e.id, e.event, id) || []
			),
			editable,
			...getCalendarColors(color),
		})
		);
	};
	renderCalendar = renderCalendar;

	renderCalendarFromCache = async (
		container: HTMLElement,
		settings?: Parameters<typeof renderCalendar>[2]
	) => {
		if (!this.cache.initialized) {
			await this.cache.populate();
		}

		const cal = renderCalendar(
			container,
			this.translateSources(this.cache),
			settings
		);

		// The markdown preview view has its own scrollbar that conflicts with
		// FullCalendar's internal time-grid scroller. Hide the outer one.
		const markdownPreview = container.closest(
			".markdown-preview-view"
		) as HTMLElement | null;
		if (markdownPreview) markdownPreview.style.overflowY = "hidden";

		return cal;
	};
	processFrontmatter = toEventInput;

	/**
	 * The event's own category, else the default category of its calendar.
	 */
	categoryFor(event: OFCEvent, calendarId: string): string | undefined {
		return (
			event.category ||
			this.cache.calendars.get(calendarId)?.defaultCategory
		);
	}

	/**
	 * Convert an event for FullCalendar, colored by the current color mode.
	 */
	eventInput(id: string, event: OFCEvent, calendarId: string) {
		const colorMode = this.settings.colorMode;
		if (colorMode !== "category") {
			return toEventInput(id, event);
		}
		const name = this.categoryFor(event, calendarId);
		const categoryColor = this.settings.categories.find(
			(c) => c.name === name
		)?.color;
		return toEventInput(id, event, { colorMode, categoryColor });
	}

	async setColorMode(colorMode: ColorMode) {
		this.settings.colorMode = colorMode;
		await this.saveData(this.settings);
		this.redrawViews();
	}

	/**
	 * Save category settings that only change colors. This does not reset
	 * the event cache.
	 */
	async saveCategories() {
		await this.saveData(this.settings);
		this.redrawViews();
	}

	redrawViews() {
		[FULL_CALENDAR_VIEW_TYPE, FULL_CALENDAR_SIDEBAR_VIEW_TYPE].forEach(
			(type) =>
				this.app.workspace
					.getLeavesOfType(type)
					.forEach((l) => (l.view as CalendarView).redrawEvents())
		);
	}

	/**
	 * Rename a category in settings and in the frontmatter of local events.
	 * Returns the number of event notes changed.
	 */
	async renameCategory(oldName: string, newName: string): Promise<number> {
		const category = this.settings.categories.find(
			(c) => c.name === oldName
		);
		if (category) {
			category.name = newName;
		}
		this.settings.calendarSources.forEach((s) => {
			if (s.defaultCategory === oldName) {
				s.defaultCategory = newName;
			}
		});

		const directories = this.settings.calendarSources.flatMap((s) =>
			s.type === "local" ? [normalizePath(s.directory) + "/"] : []
		);
		const files = this.app.vault
			.getMarkdownFiles()
			.filter(
				(f) =>
					directories.some((d) => f.path.startsWith(d)) &&
					this.app.metadataCache.getFileCache(f)?.frontmatter
						?.category === oldName
			);
		for (const file of files) {
			// processFrontMatter exists at runtime but not in this
			// version of the Obsidian typings.
			await (this.app.fileManager as any).processFrontMatter(
				file,
				(fm: Record<string, unknown>) => {
					fm.category = newName;
				}
			);
		}

		await this.saveSettings();
		return files.length;
	}
	getCalendarColors = getCalendarColors;

	async activateView() {
		const leaves = this.app.workspace
			.getLeavesOfType(FULL_CALENDAR_VIEW_TYPE)
			.filter((l) => (l.view as CalendarView).inSidebar === false);
		if (leaves.length === 0) {
			const leaf = this.app.workspace.getLeaf("tab");
			await leaf.setViewState({
				type: FULL_CALENDAR_VIEW_TYPE,
				active: true,
			});
		} else {
			await Promise.all(
				leaves.map((l) => (l.view as CalendarView).onOpen())
			);
		}
	}
	async onload() {
		await this.loadSettings();

		// Build sources with tasks if enabled
		let sources = [...this.settings.calendarSources];
		if (this.settings.showTasksCalendar) {
			sources.push({
				type: "tasks" as const,
				color: this.settings.tasksCalendarColor,
			});
		}
		this.cache.reset(sources);

		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				this.cache.fileUpdated(file);
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) {
					console.debug("FILE RENAMED", file.path);
					this.cache.deleteEventsAtPath(oldPath);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile) {
					console.debug("FILE DELETED", file.path);
					this.cache.deleteEventsAtPath(file.path);
				}
			})
		);

		// @ts-ignore
		window.cache = this.cache;

		this.registerView(
			FULL_CALENDAR_VIEW_TYPE,
			(leaf) => new CalendarView(leaf, this, false)
		);

		this.registerView(
			FULL_CALENDAR_SIDEBAR_VIEW_TYPE,
			(leaf) => new CalendarView(leaf, this, true)
		);


		this.addRibbonIcon(
			"calendar-glyph",
			"Open Full Calendar",
			async (_: MouseEvent) => {
				await this.activateView();
			}
		);

		this.addSettingTab(new FullCalendarSettingTab(this.app, this));

		this.addCommand({
			id: "full-calendar-new-event",
			name: "New Event",
			callback: () => {
				launchCreateModal(this, {});
			},
		});

		this.addCommand({
			id: "full-calendar-reset",
			name: "Reset Event Cache",
			callback: () => {
				this.cache.reset(this.settings.calendarSources);
				this.app.workspace.detachLeavesOfType(FULL_CALENDAR_VIEW_TYPE);
				this.app.workspace.detachLeavesOfType(
					FULL_CALENDAR_SIDEBAR_VIEW_TYPE
				);
				new Notice("Full Calendar has been reset.");
			},
		});

		this.addCommand({
			id: "full-calendar-toggle-color-mode",
			name: "Toggle calendar/category colors",
			callback: async () => {
				await this.setColorMode(
					this.settings.colorMode === "category"
						? "calendar"
						: "category"
				);
			},
		});

		this.addCommand({
			id: "full-calendar-revalidate",
			name: "Revalidate remote calendars",
			callback: () => {
				this.cache.revalidateRemoteCalendars(true);
			},
		});

		// Keyboard equivalent of the ↻ reload-events button in the calendar view.
		this.addCommand({
			id: "full-calendar-reload-events",
			name: "Reload all events",
			callback: async () => {
				try {
					new Notice("Reloading all events...");
					await this.cache.reloadAll();
					new Notice("Events reloaded successfully");
				} catch (error) {
					console.error("Failed to reload events:", error);
					new Notice("Failed to reload events");
				}
			},
		});

		this.addCommand({
			id: "full-calendar-open",
			name: "Open Calendar",
			callback: () => {
				this.activateView();
			},
		});

		this.addCommand({
			id: "full-calendar-open-sidebar",
			name: "Open in sidebar",
			callback: () => {
				if (
					this.app.workspace.getLeavesOfType(
						FULL_CALENDAR_SIDEBAR_VIEW_TYPE
					).length
				) {
					return;
				}
				this.app.workspace.getRightLeaf(false).setViewState({
					type: FULL_CALENDAR_SIDEBAR_VIEW_TYPE,
				});
			},
		});

		(this.app.workspace as any).registerHoverLinkSource(PLUGIN_SLUG, {
			display: "Full Calendar",
			defaultMod: true,
		});
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(FULL_CALENDAR_VIEW_TYPE);
		this.app.workspace.detachLeavesOfType(FULL_CALENDAR_SIDEBAR_VIEW_TYPE);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		new Notice("Resetting the event cache with new settings...");
		await this.saveData(this.settings);

		// Build calendar sources with optional tasks calendar
		let sources = [...this.settings.calendarSources];
		if (this.settings.showTasksCalendar) {
			sources.push({
				type: "tasks" as const,
				color: this.settings.tasksCalendarColor,
			});
		}

		this.cache.reset(sources);
		await this.cache.populate();
		this.cache.resync();
	}

	/**
	 * Obsidian calls this when data.json changes on disk (a script, Sync).
	 * Reload it, so the next save does not write the old settings back.
	 */
	async onExternalSettingsChange() {
		await this.loadSettings();

		let sources = [...this.settings.calendarSources];
		if (this.settings.showTasksCalendar) {
			sources.push({
				type: "tasks" as const,
				color: this.settings.tasksCalendarColor,
			});
		}

		this.cache.reset(sources);
		await this.cache.populate();
		this.redrawViews();
	}
}
