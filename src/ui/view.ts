import "./overrides.css";
import { ItemView, Menu, Notice, WorkspaceLeaf } from "obsidian";
import { Calendar, EventSourceInput } from "@fullcalendar/core";
import { renderCalendar } from "./calendar";
import FullCalendarPlugin from "../main";
import { FCError, PLUGIN_SLUG } from "../types";
import {
	dateEndpointsToFrontmatter,
	fromEventApi,
	toEventInput,
} from "./interop";
import { renderOnboarding } from "./onboard";
import { openFileForEvent, openDailyNote } from "./actions";
import { launchCreateModal, launchEditModal, launchEventInfoModal } from "./event_modal";
import { isTask, toggleTask, unmakeTask } from "src/ui/tasks";
import { UpdateViewCallback } from "src/core/EventCache";

export const FULL_CALENDAR_VIEW_TYPE = "full-calendar-view";
export const FULL_CALENDAR_SIDEBAR_VIEW_TYPE = "full-calendar-sidebar-view";

export function getCalendarColors(color: string | null | undefined): {
	color: string;
	textColor: string;
} {
	let textVar = getComputedStyle(document.body).getPropertyValue(
		"--text-on-accent"
	);
	if (color) {
		const m = color
			.slice(1)
			.match(color.length == 7 ? /(\S{2})/g : /(\S{1})/g);
		if (m) {
			const r = parseInt(m[0], 16),
				g = parseInt(m[1], 16),
				b = parseInt(m[2], 16);
			const brightness = (r * 299 + g * 587 + b * 114) / 1000;
			if (brightness > 150) {
				textVar = "black";
			}
		}
	}

	return {
		color:
			color ||
			getComputedStyle(document.body).getPropertyValue(
				"--interactive-accent"
			),
		textColor: textVar,
	};
}

export class CalendarView extends ItemView {
	plugin: FullCalendarPlugin;
	inSidebar: boolean;
	fullCalendarView: Calendar | null = null;
	callback: UpdateViewCallback | null = null;
	
	// Vimium mode state
	vimiumMode: boolean = false;
	vimiumOverlays: Map<string, { element: HTMLElement; eventId: string }> = new Map();

	constructor(
		leaf: WorkspaceLeaf,
		plugin: FullCalendarPlugin,
		inSidebar = false
	) {
		super(leaf);
		this.plugin = plugin;
		this.inSidebar = inSidebar;
	}

	getIcon(): string {
		return "calendar-glyph";
	}

	getViewType() {
		return this.inSidebar
			? FULL_CALENDAR_SIDEBAR_VIEW_TYPE
			: FULL_CALENDAR_VIEW_TYPE;
	}

	getDisplayText() {
		return this.inSidebar ? "Full Calendar" : "Calendar";
	}

	translateSources() {
		// Get current date range from calendar view for performance optimization
		const dateRange = this.getDateRangeFromView();
		return this.plugin.cache.getAllEvents(dateRange).map(({ events, editable, color, id }): EventSourceInput => ({
			id,
			events: events.flatMap(
				(e) => toEventInput(e.id, e.event) || []
			),
			editable,
			...getCalendarColors(color),
		})
		);
	}

	private getDateRangeFromView(): { start: Date; end: Date } | undefined {
		if (!this.fullCalendarView) {
			return undefined;
		}
		
		try {
			const currentView = this.fullCalendarView.view;
			return {
				start: new Date(currentView.activeStart),
				end: new Date(currentView.activeEnd)
			};
		} catch (error) {
			return undefined;
		}
	}

	async onOpen() {
		await this.plugin.loadSettings();
		if (!this.plugin.cache) {
			new Notice("Full Calendar event cache not loaded.");
			return;
		}
		if (!this.plugin.cache.initialized) {
			// Initialize calendar first to get date range
			const sources: EventSourceInput[] = this.translateSources();
			
			// Then populate with date range for better performance
			const dateRange = this.getDateRangeFromView();
			await this.plugin.cache.populate(dateRange);
		}

		const container = this.containerEl.children[1];
		container.empty();
		let calendarEl = container.createEl("div");

		if (
			this.plugin.settings.calendarSources.filter(
				(s) => s.type !== "FOR_TEST_ONLY"
			).length === 0
		) {
			renderOnboarding(this.app, this.plugin, calendarEl);
			return;
		}

		const sources: EventSourceInput[] = this.translateSources();

		if (this.fullCalendarView) {
			this.fullCalendarView.destroy();
			this.fullCalendarView = null;
		}
		const isMobile = window.innerWidth < 500;
		const isNarrow = this.inSidebar || isMobile;
		const calendar = renderCalendar(calendarEl, sources, {
			forceNarrow: this.inSidebar,
			longPressDelay: 500,
			eventLongPressDelay: 500,
			selectLongPressDelay: 500,
			eventClick: async (info) => {
				try {
					// Check if event is editable first
					const isEditable = this.plugin.cache.isEventEditable(info.event.id);

					if (
						info.jsEvent.getModifierState("Control") ||
						info.jsEvent.getModifierState("Meta")
					) {
						if (isEditable) {
							await openFileForEvent(
								this.plugin.cache,
								this.app,
								info.event.id
							);
						} else {
							// For read-only events, show info modal instead
							launchEventInfoModal(this.plugin, info.event.id);
						}
					} else {
						if (isEditable) {
							launchEditModal(this.plugin, info.event.id);
						} else {
							// Show info modal for read-only events
							launchEventInfoModal(this.plugin, info.event.id);
						}
					}
				} catch (e) {
					if (e instanceof Error) {
						console.warn(e);
						new Notice(e.message);
					}
				}
			},
			dateClick: async (info) => {
				try {
					await openDailyNote(info.date, this.app);
				} catch (e) {
					if (e instanceof Error) {
						console.warn(e);
						new Notice(e.message);
					}
				}
			},
			dayHeaderClick: async (date) => {
				try {
					await openDailyNote(date, this.app);
				} catch (e) {
					if (e instanceof Error) {
						console.warn(e);
						new Notice(e.message);
					}
				}
			},
			select: (async (start, end, allDay, viewType) => {
				if (viewType === "dayGridMonth") {
					// Month view will set the end day to the next day even on a single-day event.
					// This is problematic when moving an event created in the month view to the
					// time grid to give it a time.

					// The fix is just to subtract 1 from the end date before processing.
					end.setDate(end.getDate() - 1);
				}
				const partialEvent = dateEndpointsToFrontmatter(
					start,
					end,
					allDay
				);
				try {
					if (
						this.plugin.settings.clickToCreateEventFromMonthView ||
						viewType !== "dayGridMonth"
					) {
						launchCreateModal(this.plugin, partialEvent);
					} else {
						this.fullCalendarView?.changeView("timeGridDay");
						this.fullCalendarView?.gotoDate(start);
					}
				} catch (e) {
					if (e instanceof Error) {
						console.error(e);
						new Notice(e.message);
					}
				}
			}),
			modifyEvent: async (newEvent, oldEvent) => {
				try {
					const didModify = await this.plugin.cache.updateEventWithId(
						oldEvent.id,
						fromEventApi(newEvent)
					);
					return !!didModify;
				} catch (e: any) {
					console.error(e);
					new Notice(e.message);
					return false;
				}
			},

			eventMouseEnter: async (info) => {
				try {
					const location = this.plugin.cache.getInfoForEditableEvent(
						info.event.id
					).location;
					if (location) {
						this.app.workspace.trigger("hover-link", {
							event: info.jsEvent,
							source: PLUGIN_SLUG,
							hoverParent: calendarEl,
							targetEl: info.jsEvent.target,
							linktext: location.path,
							sourcePath: location.path,
						});
					}
				} catch (e) { }
			},
			firstDay: this.plugin.settings.firstDay,
			initialView: this.plugin.settings.initialView as any,
			timeFormat24h: this.plugin.settings.timeFormat24h,
			openContextMenuForEvent: async (e, mouseEvent) => {
				const menu = new Menu();
				if (!this.plugin.cache) {
					return;
				}
				const event = this.plugin.cache.getEventById(e.id);
				if (!event) {
					return;
				}

				if (this.plugin.cache.isEventEditable(e.id)) {
					if (!isTask(event)) {
						menu.addItem((item) =>
							item
								.setTitle("Turn into task")
								.onClick(async () => {
									await this.plugin.cache.processEvent(
										e.id,
										(e) => toggleTask(e, false)
									);
								})
						);
					} else {
						menu.addItem((item) =>
							item
								.setTitle("Remove checkbox")
								.onClick(async () => {
									await this.plugin.cache.processEvent(
										e.id,
										unmakeTask
									);
								})
						);
					}
					menu.addSeparator();
					menu.addItem((item) =>
						item.setTitle("Go to note").onClick(() => {
							if (!this.plugin.cache) {
								return;
							}
							openFileForEvent(this.plugin.cache, this.app, e.id);
						})
					);
					menu.addItem((item) =>
						item.setTitle("Delete").onClick(async () => {
							if (!this.plugin.cache) {
								return;
							}
							await this.plugin.cache.deleteEvent(e.id);
							new Notice(`Deleted event "${e.title}".`);
						})
					);
				} else {
					menu.addItem((item) => {
						item.setTitle(
							"No actions available on remote events"
						).setDisabled(true);
					});
				}

				menu.showAtMouseEvent(mouseEvent);
			},
			customButtons: {
				addZoom: {
					text: '+',
					click: function() {
						increment(true)
					}
				},
				decreaseZoom: {
					text: '-',
					click: function() {
						increment(false)
					}
				},
				reload: {
					text: '↻',
					hint: 'Reload all events',
					click: async () => {
						await this.reloadAllEvents();
					}
				}
			},
			headerToolbar: {
				left: isNarrow ? "" : 'prev,next,today,addZoom,decreaseZoom,reload',
				center: 'title',
				right: 'dayGridMonth,timeGridWeek,timeGrid3Days,timeGridDay'
			},
			footerToolbar: {
				left: isNarrow ? 'prev,next,today,addZoom,decreaseZoom,reload' : ''
			},
			toggleTask: async (e, isDone) => {
				const event = this.plugin.cache.getEventById(e.id);
				if (!event) {
					return false;
				}
				if (event.type !== "single") {
					return false;
				}

				try {
					await this.plugin.cache.updateEventWithId(
						e.id,
						toggleTask(event, isDone)
					);
				} catch (e) {
					if (e instanceof FCError) {
						new Notice(e.message);
					}
					return false;
				}
				return true;
			},


		});

		this.fullCalendarView = calendar;

		// @ts-ignore
		window.fc = this.fullCalendarView;

		// Add keyboard shortcuts for calendar navigation
		this.registerDomEvent(document, "keydown", (event: KeyboardEvent) => {
			// Only handle shortcuts when this calendar view is active
			if (!this.fullCalendarView) {
				return;
			}

			// Ctrl+Left Arrow - Previous period
			if (event.ctrlKey && event.key === 'ArrowLeft') {
				event.preventDefault();
				console.log('Calendar: Previous period');
				this.fullCalendarView.prev();
				return;
			}

			// Ctrl+Right Arrow - Next period
			if (event.ctrlKey && event.key === 'ArrowRight') {
				event.preventDefault();
				console.log('Calendar: Next period');
				this.fullCalendarView.next();
				return;
			}

			// Ctrl+Up Arrow - Switch to next view (day -> 3day -> week -> month)
			if (event.ctrlKey && event.key === 'ArrowUp') {
				event.preventDefault();
				const currentView = this.fullCalendarView.view.type;
				console.log('Calendar: Current view:', currentView);

				let nextView: string;
				switch (currentView) {
					case 'timeGridDay':
						nextView = 'timeGrid3Days';
						break;
					case 'timeGrid3Days':
						nextView = 'timeGridWeek';
						break;
					case 'timeGridWeek':
						nextView = 'dayGridMonth';
						break;
					case 'dayGridMonth':
						nextView = 'timeGridDay';
						break;
					default:
						nextView = 'timeGridDay';
						break;
				}

				console.log('Calendar: Switching to view:', nextView);
				this.fullCalendarView.changeView(nextView);
				return;
			}

			// Ctrl+Down Arrow - Switch to previous view (month -> week -> 3day -> day)
			if (event.ctrlKey && event.key === 'ArrowDown') {
				event.preventDefault();
				const currentView = this.fullCalendarView.view.type;
				console.log('Calendar: Current view:', currentView);

				let nextView: string;
				switch (currentView) {
					case 'dayGridMonth':
						nextView = 'timeGridWeek';
						break;
					case 'timeGridWeek':
						nextView = 'timeGrid3Days';
						break;
					case 'timeGrid3Days':
						nextView = 'timeGridDay';
						break;
					case 'timeGridDay':
						nextView = 'dayGridMonth';
						break;
					default:
						nextView = 'dayGridMonth';
						break;
				}

				console.log('Calendar: Switching to view:', nextView);
				this.fullCalendarView.changeView(nextView);
				return;
			}

			// Ctrl+/ - Toggle vimium mode
			if (event.ctrlKey && event.key === '/') {
				event.preventDefault();
				console.log('Calendar: Toggling vimium mode');
				this.toggleVimiumMode();
				return;
			}

			// Handle vimium mode letter selections
			if (this.vimiumMode && event.ctrlKey && event.key.length === 1) {
				const letter = event.key.toLowerCase();
				if (this.vimiumOverlays.has(letter)) {
					event.preventDefault();
					const overlay = this.vimiumOverlays.get(letter)!;
					console.log('Calendar: Opening event via vimium mode:', overlay.eventId);
					// Check if event is editable before opening
					if (this.plugin.cache.isEventEditable(overlay.eventId)) {
						launchEditModal(this.plugin, overlay.eventId);
					} else {
						launchEventInfoModal(this.plugin, overlay.eventId);
					}
					this.clearVimiumMode();
					return;
				}
			}

			// Escape key to exit vimium mode
			if (this.vimiumMode && event.key === 'Escape') {
				event.preventDefault();
				this.clearVimiumMode();
				return;
			}
		});

		this.registerDomEvent(this.containerEl, "mouseenter", () => {
			this.plugin.cache.revalidateRemoteCalendars();
		});

		if (this.callback) {
			this.plugin.cache.off("update", this.callback);
			this.callback = null;
		}

		this.callback = this.plugin.cache.on("update", (payload) => {
			if (payload.type === "resync") {
				this.fullCalendarView?.removeAllEventSources();
				const sources = this.translateSources();
				sources.forEach((source) =>
					this.fullCalendarView?.addEventSource(source)
				);
				return;
			} else if (payload.type === "events") {
				const { toRemove, toAdd } = payload;
				toRemove.forEach((id) => {
					const event = this.fullCalendarView?.getEventById(id);
					if (event) {
						event.remove();
					}
				});
				toAdd.forEach(({ id, event, calendarId }) => {
					const eventInput = toEventInput(id, event);
					this.fullCalendarView?.addEvent(
						eventInput!,
						calendarId
					);
				});
			} else if (payload.type == "calendar") {
				const {
					calendar: { id, events, editable, color },
				} = payload;
				this.fullCalendarView?.getEventSourceById(id)?.remove();
				this.fullCalendarView?.addEventSource({
					id,
					events: events.flatMap(
						({ id, event }) => toEventInput(id, event) || []
					),
					editable,
					...getCalendarColors(color),
				});
			}
		});

		const increment = async (increment: boolean) => {
			const elements = document.querySelectorAll('.fc-timegrid-slot');

			const currentHeight = window.getComputedStyle(elements[0]).height;
			const heightInPx = parseFloat(currentHeight);

			// Find existing style tag or create new one
			let style = document.getElementById('fc-height-override');
			if (!style) {
				style = document.createElement('style');
				style.id = 'fc-height-override';
				document.head.appendChild(style);
			}

			// Update the CSS rule
			style.textContent = `.fc-timegrid-slot { height: ${heightInPx + (increment ? 16 : -16)}px !important; }`;

			this.fullCalendarView?.destroy()
			this.fullCalendarView?.render()

		}
	}

	onResize(): void {
		if (this.fullCalendarView) {
			this.fullCalendarView.render();
		}
	}

	async onunload() {
		if (this.fullCalendarView) {
			this.fullCalendarView.destroy();
			this.fullCalendarView = null;
		}
		if (this.callback) {
			this.plugin.cache.off("update", this.callback);
			this.callback = null;
		}
	}

	toggleVimiumMode(): void {
		if (this.vimiumMode) {
			this.clearVimiumMode();
		} else {
			this.activateVimiumMode();
		}
	}

	activateVimiumMode(): void {
		console.log('Calendar: Activating vimium mode');
		this.vimiumMode = true;
		
		if (!this.fullCalendarView) {
			console.log('Calendar: No fullCalendarView available');
			return;
		}
		
		// Get only events visible in the current view
		const currentView = this.fullCalendarView.view;
		const viewStart = currentView.activeStart;
		const viewEnd = currentView.activeEnd;
		
		// Filter events to only those visible in the current view period
		const allEvents = this.fullCalendarView.getEvents();
		const visibleEvents = allEvents.filter(event => {
			if (!event.start) return false;
			
			// Check if event overlaps with the current view period
			const eventEnd = event.end || event.start;
			return (event.start < viewEnd) && (eventEnd > viewStart);
		});
		
		console.log(`Calendar: Found ${allEvents.length} total events, ${visibleEvents.length} visible in current view`);
		const letters = 'abcdefghijklmnopqrstuvwxyz';
		
		this.vimiumOverlays.clear();
		
		// Get all fc-event elements currently visible
		const eventElements = Array.from(document.querySelectorAll('.fc-event')) as HTMLElement[];
		console.log(`Calendar: Found ${eventElements.length} DOM event elements`);
		
		visibleEvents.forEach((event, index) => {
			if (index >= letters.length) return; // Skip if we run out of letters
			
			const letter = letters[index];
			console.log(`Calendar: Processing event ${index}: ${event.id} (${event.title}) -> ${letter}`);
			
			// Use the data attribute for reliable matching
			const eventElement = document.querySelector(`[data-fc-event-id="${event.id}"]`) as HTMLElement;
			
			if (eventElement) {
				console.log(`Calendar: Found element for event ${event.id}`);
				
				// Create overlay element
				const overlay = document.createElement('div');
				overlay.textContent = letter.toUpperCase();
				overlay.style.cssText = `
					position: absolute;
					background: #ff6b35;
					color: white;
					font-weight: bold;
					font-size: 12px;
					padding: 2px 6px;
					border-radius: 3px;
					z-index: 1000;
					pointer-events: none;
					box-shadow: 0 2px 4px rgba(0,0,0,0.3);
					top: 2px;
					left: 2px;
				`;
				
				// Position relative to event
				eventElement.style.position = 'relative';
				eventElement.appendChild(overlay);
				
				this.vimiumOverlays.set(letter, {
					element: overlay,
					eventId: event.id
				});
				
				// Remove the matched element from the array to avoid duplicate matches
				const elementIndex = eventElements.indexOf(eventElement);
				if (elementIndex > -1) {
					eventElements.splice(elementIndex, 1);
				}
			} else {
				console.log(`Calendar: Could not find element for event ${event.id} (${event.title})`);
			}
		});
		
		console.log(`Calendar: Vimium mode activated with ${this.vimiumOverlays.size} overlays`);
	}

	clearVimiumMode(): void {
		console.log('Calendar: Clearing vimium mode');
		this.vimiumMode = false;

		// Remove all overlay elements
		this.vimiumOverlays.forEach((overlay) => {
			overlay.element.remove();
		});

		this.vimiumOverlays.clear();
	}

	async reloadAllEvents(): Promise<void> {
		try {
			new Notice("Reloading all events...");

			if (!this.plugin.cache) {
				new Notice("Event cache not available");
				return;
			}

			// Reload all events using the new cache method
			await this.plugin.cache.reloadAll();

			new Notice("Events reloaded successfully");
		} catch (error) {
			console.error("Failed to reload events:", error);
			new Notice("Failed to reload events");
		}
	}
}
