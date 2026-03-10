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
import { launchCreateModal, launchEditModal } from "./event_modal";
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
	
	// Habits view state
	isHabitsLayoutActive: boolean = false;
	
	// Performance and robustness improvements
	private dailyNoteCache: Map<string, { content: string; timestamp: number }> = new Map();
	private habitOperationQueue: Promise<void> = Promise.resolve();
	private abortController: AbortController | null = null;

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
					if (
						info.jsEvent.getModifierState("Control") ||
						info.jsEvent.getModifierState("Meta")
					) {
						await openFileForEvent(
							this.plugin.cache,
							this.app,
							info.event.id
						);
					} else {
						launchEditModal(this.plugin, info.event.id);
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
				right: 'dayGridMonth,timeGridWeek,timeGrid3Days,timeGridDay,habitsView'
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

		// Listen for view changes to handle habits view
		// Use a different approach since viewDidMount may not be available
		const checkViewType = () => {
			if (this.fullCalendarView) {
				this.handleViewChange(this.fullCalendarView.view.type, calendarEl);
			}
		};
		
		// Check view type periodically and on user interactions
		setTimeout(checkViewType, 100);
		
		// Also check on any calendar events and date changes
		this.registerDomEvent(calendarEl, 'click', () => {
			setTimeout(() => {
				checkViewType();
				// If in habits view, refresh the habits for new date
				if (this.fullCalendarView && this.fullCalendarView.view.type === 'habitsView') {
					this.refreshHabitsForCurrentDate();
				}
			}, 50);
		});

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

			// Ctrl+Up Arrow - Switch to next view (day -> 3day -> week -> month -> habits)
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
						nextView = 'habitsView';
						break;
					case 'habitsView':
						nextView = 'timeGridDay';
						break;
					default:
						nextView = 'timeGridDay';
						break;
				}
				
				console.log('Calendar: Switching to view:', nextView);
				this.fullCalendarView.changeView(nextView);
				
				// Refresh habits if switching to habits view
				if (nextView === 'habitsView') {
					setTimeout(() => this.refreshHabitsForCurrentDate(), 100);
				}
				return;
			}

			// Ctrl+Down Arrow - Switch to previous view (habits -> month -> week -> 3day -> day)
			if (event.ctrlKey && event.key === 'ArrowDown') {
				event.preventDefault();
				const currentView = this.fullCalendarView.view.type;
				console.log('Calendar: Current view:', currentView);
				
				let nextView: string;
				switch (currentView) {
					case 'habitsView':
						nextView = 'dayGridMonth';
						break;
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
						nextView = 'habitsView';
						break;
					default:
						nextView = 'dayGridMonth';
						break;
				}
				
				console.log('Calendar: Switching to view:', nextView);
				this.fullCalendarView.changeView(nextView);
				
				// Refresh habits if switching to habits view
				if (nextView === 'habitsView') {
					setTimeout(() => this.refreshHabitsForCurrentDate(), 100);
				}
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
					launchEditModal(this.plugin, overlay.eventId);
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
		// Abort any ongoing operations
		if (this.abortController) {
			this.abortController.abort();
		}
		
		// Clear caches
		this.dailyNoteCache.clear();
		
		// Wait for any pending habit operations to complete
		await this.habitOperationQueue.catch(() => {});
		
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

	handleViewChange(viewType: string, calendarEl: HTMLElement) {
		const wasHabitsView = this.isHabitsLayoutActive;
		const isNowHabitsView = viewType === 'habitsView';
		
		// Track if we're switching to/from habits view
		if (wasHabitsView !== isNowHabitsView) {
			if (isNowHabitsView) {
				this.setupHabitsLayout(calendarEl);
			} else {
				this.restoreNormalLayout(calendarEl);
			}
			
			// Force calendar reload to prevent layout bugs
			this.reloadCalendarView();
		}
		
		this.isHabitsLayoutActive = isNowHabitsView;
	}

	setupHabitsLayout(calendarEl: HTMLElement) {
		// Create wrapper for side-by-side layout
		const wrapper = calendarEl.parentElement;
		if (!wrapper) return;

		wrapper.style.display = 'flex';
		wrapper.style.gap = '10px';

		// Make calendar take 2/3 of space
		calendarEl.style.flex = '2';
		calendarEl.style.minWidth = '400px';

		// Create habits sidebar
		let habitsSection = wrapper.querySelector('.habits-section') as HTMLElement;
		if (!habitsSection) {
			habitsSection = document.createElement('div');
			habitsSection.className = 'habits-section';
			habitsSection.style.flex = '1';
			habitsSection.style.minWidth = '250px';
			habitsSection.style.padding = '15px';
			habitsSection.style.background = 'var(--background-secondary)';
			habitsSection.style.borderRadius = '6px';
			habitsSection.style.overflowY = 'auto';
			habitsSection.style.maxHeight = '100vh';
			habitsSection.style.scrollBehavior = 'smooth';
			(habitsSection.style as any).scrollbarWidth = 'thin';
			
			wrapper.appendChild(habitsSection);
		}

		// Render habits content
		this.renderHabits(habitsSection);
	}

	restoreNormalLayout(calendarEl: HTMLElement) {
		const wrapper = calendarEl.parentElement;
		if (!wrapper) return;

		// Remove flex layout
		wrapper.style.display = '';
		wrapper.style.gap = '';

		// Restore calendar full width
		calendarEl.style.flex = '';
		calendarEl.style.minWidth = '';

		// Remove habits section
		const habitsSection = wrapper.querySelector('.habits-section');
		if (habitsSection) {
			habitsSection.remove();
		}
	}

	async renderHabits(container: HTMLElement) {
		container.innerHTML = ''; // Clear previous content

		// Header
		const header = container.createEl('h3');
		header.textContent = 'Daily Habits';
		header.style.textAlign = 'center';
		header.style.marginBottom = '20px';

		// Get current date for filtering
		const currentDate = this.getCurrentDateForHabits();
		
		// Date display
		const dateDisplay = container.createEl('div');
		const displayDate = new Date(currentDate);
		dateDisplay.textContent = displayDate.toLocaleDateString('en-US', { 
			weekday: 'short', 
			month: 'short', 
			day: 'numeric' 
		});
		dateDisplay.style.textAlign = 'center';
		dateDisplay.style.fontSize = '12px';
		dateDisplay.style.color = 'var(--text-muted)';
		dateDisplay.style.marginBottom = '15px';

		// Get dynamic habits from window object
		const activeHabits = this.getActiveHabitsForDate(currentDate);
		
		// Get numbers from daily note
		const habitNumbers = await this.getHabitNumbersForDate(currentDate);
		
		if (activeHabits.length === 0) {
			const noHabits = container.createEl('p');
			noHabits.textContent = 'No habits for this date';
			noHabits.style.textAlign = 'center';
			noHabits.style.color = 'var(--text-muted)';
			return;
		}

		// Group habits by category
		const habitsByCategory = this.groupHabitsByCategory(activeHabits);

		// Render each category
		Object.entries(habitsByCategory).forEach(([category, habits]) => {
			// Category header (optional)
			if (Object.keys(habitsByCategory).length > 1) {
				const categoryHeader = container.createEl('div');
				categoryHeader.textContent = this.getCategoryDisplayName(category);
				categoryHeader.style.fontSize = '13px';
				categoryHeader.style.fontWeight = 'bold';
				categoryHeader.style.marginTop = '10px';
				categoryHeader.style.marginBottom = '8px';
				categoryHeader.style.color = 'var(--text-accent)';
			}

			// Render habits in this category
			habits.forEach(async (habit) => {
				const habitDiv = container.createEl('div');
				habitDiv.style.display = 'flex';
				habitDiv.style.alignItems = 'center';
				habitDiv.style.gap = '10px';
				habitDiv.style.marginBottom = '8px';
				habitDiv.style.padding = '8px';
				habitDiv.style.background = 'var(--background-primary)';
				habitDiv.style.borderRadius = '4px';

				const checkbox = habitDiv.createEl('input');
				checkbox.type = 'checkbox';
				checkbox.style.width = '16px';
				checkbox.style.height = '16px';

				const label = habitDiv.createEl('label');
				label.textContent = `${habit.icon} ${habit.name}`;
				label.style.fontSize = '13px';
				label.style.cursor = 'pointer';
				label.style.flex = '1';

				// Check if habit is completed in daily note (async)
				try {
					const isCompleted = await this.isHabitCompleted(habit, currentDate);
					checkbox.checked = isCompleted;
				} catch (error) {
					console.warn('Failed to load habit completion status:', error);
				}

				// Handle habit completion with better error handling
				const toggleHabit = async () => {
					const newState = checkbox.checked;
					const originalState = !newState;
					
					// Optimistic UI update
					checkbox.disabled = true;
					
					try {
						const success = await this.updateHabitInDailyNote(habit, currentDate, newState);
						if (!success) {
							// Revert on failure
							checkbox.checked = originalState;
						}
					} catch (error) {
						// Revert on error
						checkbox.checked = originalState;
					} finally {
						checkbox.disabled = false;
					}
				};

				checkbox.addEventListener('change', toggleHabit);
				
				label.addEventListener('click', (e) => {
					e.preventDefault();
					checkbox.checked = !checkbox.checked;
					toggleHabit();
				});
			});
		});

		// Render numbers section
		if (habitNumbers.length > 0) {
			const numbersHeader = container.createEl('div');
			numbersHeader.textContent = '📊 Numbers';
			numbersHeader.style.fontSize = '13px';
			numbersHeader.style.fontWeight = 'bold';
			numbersHeader.style.marginTop = '20px';
			numbersHeader.style.marginBottom = '8px';
			numbersHeader.style.color = 'var(--text-accent)';

			habitNumbers.forEach(number => {
				const numberDiv = container.createEl('div');
				numberDiv.style.display = 'flex';
				numberDiv.style.alignItems = 'center';
				numberDiv.style.gap = '10px';
				numberDiv.style.marginBottom = '8px';
				numberDiv.style.padding = '8px';
				numberDiv.style.background = 'var(--background-primary)';
				numberDiv.style.borderRadius = '4px';

				const label = numberDiv.createEl('label');
				label.textContent = `${number.name}:`;
				label.style.fontSize = '13px';
				label.style.flex = '1';

				const input = numberDiv.createEl('input');
				input.type = 'number';
				input.step = '0.25';
				input.min = '0';
				input.value = number.value.toString();
				input.style.width = '70px';
				input.style.padding = '4px 8px';
				input.style.border = '1px solid var(--background-modifier-border)';
				input.style.borderRadius = '4px';
				input.style.background = 'var(--background-primary)';
				input.style.color = 'var(--text-normal)';
				input.style.fontSize = '13px';

				// Handle number updates
				const updateNumber = async () => {
					const newValue = parseFloat(input.value) || 0;
					input.disabled = true;
					
					try {
						await this.updateHabitNumberInDailyNote(number.name, currentDate, newValue);
					} catch (error) {
						input.value = number.value.toString(); // Revert on error
					} finally {
						input.disabled = false;
					}
				};

				input.addEventListener('change', updateNumber);
				input.addEventListener('blur', updateNumber);
			});
		}

		// Status text
		const status = container.createEl('p');
		status.textContent = `📅 ${activeHabits.length} habits, ${habitNumbers.length} numbers`;
		status.style.textAlign = 'center';
		status.style.fontSize = '11px';
		status.style.color = 'var(--text-muted)';
		status.style.marginTop = '15px';
	}

	getCurrentDateForHabits(): string {
		// Get the currently selected date from calendar, fallback to today
		const calendarDate = this.fullCalendarView?.getDate() || new Date();
		// Fix timezone issue - use local date formatting instead of ISO
		const year = calendarDate.getFullYear();
		const month = String(calendarDate.getMonth() + 1).padStart(2, '0');
		const day = String(calendarDate.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`; // YYYY-MM-DD format
	}

	getActiveHabitsForDate(date: string): any[] {
		try {
			// Access habits from window object - USE ALL HABITS from habitsJson, not just core
			const habitsJson = (window as any).habitsJson || [];
			const checkboxCoreProperties = (window as any).checkboxCoreProperties || [];
			
			console.log('Debug: Loading habits for date:', date);
			console.log('Debug: habitsJson length:', habitsJson.length);
			console.log('Debug: checkboxCoreProperties length:', checkboxCoreProperties.length);
			
			const currentDate = new Date(date);
			
			// Combine all habits: habitsJson + checkboxCoreProperties
			const allHabits = [
				// Map habitsJson to habit format
				...habitsJson.map((h: any) => ({
					name: h.name,
					icon: this.getIconForCategory(h.category || 'general'),
					type: h.category || 'general',
					startDate: h.startDate,
					endDate: h.endDate
				})),
				// Include core properties
				...checkboxCoreProperties
			];
			
			console.log('Debug: All combined habits count:', allHabits.length);
			
			// Filter by date range (temporarily disabled for debugging)
			const activeHabits = allHabits.filter((habit: any) => {
				if (habit.startDate) {
					const startDate = new Date(habit.startDate);
					const endDate = habit.endDate ? new Date(habit.endDate) : new Date('2099-12-31');
					const isInRange = currentDate >= startDate && currentDate <= endDate;
					console.log('Debug: Habit', habit.name, 'startDate:', habit.startDate, 'currentDate:', date, 'isInRange:', isInRange);
					return isInRange;
				}
				console.log('Debug: Habit', habit.name, 'has no startDate, including');
				return true; // Show if no date range specified
			});

			// If no habits pass date filter, show all for debugging
			if (activeHabits.length === 0) {
				console.log('Debug: No habits passed date filter, showing all habits for debugging');
				return allHabits;
			}

			console.log('Debug: Active habits after date filter:', activeHabits.length);
			return activeHabits;
		} catch (error) {
			console.warn('Failed to load habits from window object:', error);
			return [];
		}
	}

	getIconForCategory(category: string): string {
		const categoryIcons: Record<string, string> = {
			'weeklyTrackHabits': '📊',
			'workHygine': '🔧',
			'habits': '💚',
			'discipline': '🚫',
			'sleep': '😴',
			'general': '📝'
		};
		return categoryIcons[category] || '•';
	}

	refreshHabitsForCurrentDate() {
		// Find and update the habits section
		const habitsSection = this.containerEl.querySelector('.habits-section') as HTMLElement;
		if (habitsSection) {
			console.log('Debug: Refreshing habits for new date');
			this.renderHabits(habitsSection);
		}
	}

	groupHabitsByCategory(habits: any[]): Record<string, any[]> {
		return habits.reduce((acc, habit) => {
			const category = habit.type || 'general';
			if (!acc[category]) acc[category] = [];
			acc[category].push(habit);
			return acc;
		}, {});
	}

	getCategoryDisplayName(category: string): string {
		const categoryNames: Record<string, string> = {
			'workHygine': '🔧 Work Hygiene',
			'habits': '💚 Core Habits', 
			'discipline': '🚫 Discipline',
			'sleep': '😴 Sleep',
			'general': '📝 General'
		};
		return categoryNames[category] || category;
	}

	async isHabitCompleted(habit: any, date: string): Promise<boolean> {
		try {
			const content = await this.getDailyNoteContentCached(date);
			if (!content) return false;

			const habitName = this.normalizeHabitName(habit.name);
			return this.findHabitInContent(content, habitName);
		} catch (error) {
			return false;
		}
	}

	private async getDailyNoteContentCached(date: string): Promise<string | null> {
		const cacheKey = date;
		const cached = this.dailyNoteCache.get(cacheKey);
		const now = Date.now();
		
		// Use cache if less than 30 seconds old
		if (cached && (now - cached.timestamp) < 30000) {
			return cached.content;
		}

		try {
			const dailyNote = await this.getDailyNoteForDate(date);
			if (!dailyNote) return null;

			const content = await this.plugin.app.vault.read(dailyNote);
			this.dailyNoteCache.set(cacheKey, { content, timestamp: now });
			return content;
		} catch (error) {
			return null;
		}
	}

	private normalizeHabitName(name: string): string {
		return name.replace(/💚\s*/, '').replace(/[^\w\s]/g, '').trim();
	}

	private findHabitInContent(content: string, habitName: string): boolean {
		// More robust habit matching - try multiple patterns
		const patterns = [
			// Exact match with indentation
			new RegExp(`\\s+${this.escapeRegex(habitName)}:\\s*(true|false)`, 'i'),
			// Partial match for similar names
			new RegExp(`\\s+.*${this.escapeRegex(habitName.split(' ')[0])}.*:\\s*(true|false)`, 'i')
		];

		for (const pattern of patterns) {
			const match = content.match(pattern);
			if (match) {
				return match[1].toLowerCase() === 'true';
			}
		}
		return false;
	}

	private findNumberInContent(content: string, numberName: string): number {
		// Find numeric values in numbers section (supports decimals)
		const patterns = [
			new RegExp(`\\s+${this.escapeRegex(numberName)}:\\s*(\\d+(?:\\.\\d+)?)`, 'i'),
			new RegExp(`\\s+.*${this.escapeRegex(numberName.split(' ')[0])}.*:\\s*(\\d+(?:\\.\\d+)?)`, 'i')
		];

		for (const pattern of patterns) {
			const match = content.match(pattern);
			if (match) {
				return parseFloat(match[1]);
			}
		}
		return 0;
	}

	private escapeRegex(text: string): string {
		return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	async updateHabitInDailyNote(habit: any, date: string, completed: boolean): Promise<boolean> {
		// Queue operations to prevent race conditions
		return new Promise((resolve) => {
			this.habitOperationQueue = this.habitOperationQueue.then(async () => {
				try {
					const result = await this.performHabitUpdate(habit, date, completed);
					resolve(result);
				} catch (error) {
					console.error('Failed to save habit:', error);
					this.showErrorNotice('Failed to save habit');
					resolve(false);
				}
			});
		});
	}

	private async performHabitUpdate(habit: any, date: string, completed: boolean): Promise<boolean> {
		const dailyNote = await this.getDailyNoteForDate(date);
		if (!dailyNote) {
			this.showErrorNotice('Daily note not found');
			return false;
		}

		let content = await this.plugin.app.vault.read(dailyNote);
		const habitName = this.normalizeHabitName(habit.name);
		
		// Try multiple patterns for more robust matching
		const patterns = [
			new RegExp(`(\\s+${this.escapeRegex(habitName)}:\\s*)(true|false)`, 'i'),
			new RegExp(`(\\s+.*${this.escapeRegex(habitName.split(' ')[0])}.*:\\s*)(true|false)`, 'i')
		];

		let updated = false;
		for (const pattern of patterns) {
			if (pattern.test(content)) {
				content = content.replace(pattern, `$1${completed}`);
				updated = true;
				break;
			}
		}

		if (!updated) {
			console.warn(`Habit "${habitName}" not found in daily note`);
			return false;
		}

		await this.plugin.app.vault.modify(dailyNote, content);
		
		// Invalidate cache
		this.dailyNoteCache.delete(date);
		
		return true;
	}

	private showErrorNotice(message: string) {
		if (this.plugin.app.workspace) {
			new (this.plugin.app as any).Notice(message, 3000);
		}
	}

	async getHabitNumbersForDate(date: string): Promise<Array<{name: string, value: number}>> {
		try {
			const content = await this.getDailyNoteContentCached(date);
			if (!content) return [];

			// Extract numbers from content
			const numbers = [];
			const lines = content.split('\n');
			let inNumbersSection = false;

			for (const line of lines) {
				if (line.trim().toLowerCase().startsWith('numbers:')) {
					inNumbersSection = true;
					continue;
				}
				
				// Stop if we hit another section
				if (inNumbersSection && line.match(/^[a-zA-Z]/) && line.includes(':')) {
					break;
				}

				// Extract number entries (supports decimals)
				if (inNumbersSection && line.includes(':')) {
					const match = line.match(/\s+(.+?):\s*(\d+(?:\.\d+)?)/);
					if (match) {
						numbers.push({
							name: match[1].trim(),
							value: parseFloat(match[2])
						});
					}
				}
			}

			return numbers;
		} catch (error) {
			return [];
		}
	}

	async updateHabitNumberInDailyNote(numberName: string, date: string, value: number): Promise<boolean> {
		// Queue operations to prevent race conditions
		return new Promise((resolve) => {
			this.habitOperationQueue = this.habitOperationQueue.then(async () => {
				try {
					const result = await this.performNumberUpdate(numberName, date, value);
					resolve(result);
				} catch (error) {
					console.error('Failed to save number:', error);
					this.showErrorNotice('Failed to save number');
					resolve(false);
				}
			});
		});
	}

	private async performNumberUpdate(numberName: string, date: string, value: number): Promise<boolean> {
		const dailyNote = await this.getDailyNoteForDate(date);
		if (!dailyNote) {
			this.showErrorNotice('Daily note not found');
			return false;
		}

		let content = await this.plugin.app.vault.read(dailyNote);
		
		// Find and update the number entry (supports decimals)
		const pattern = new RegExp(`(\\s+${this.escapeRegex(numberName)}:\\s*)(\\d+(?:\\.\\d+)?)`, 'i');
		
		if (pattern.test(content)) {
			content = content.replace(pattern, `$1${value}`);
			await this.plugin.app.vault.modify(dailyNote, content);
			
			// Invalidate cache
			this.dailyNoteCache.delete(date);
			
			return true;
		} else {
			console.warn(`Number "${numberName}" not found in daily note`);
			return false;
		}
	}

	async getDailyNoteForDate(date: string): Promise<any> {
		try {
			const dateObj = new Date(date);
			const year = dateObj.getFullYear();
			const month = String(dateObj.getMonth() + 1).padStart(2, '0');
			const day = String(dateObj.getDate()).padStart(2, '0');
			
			// ONLY look for Systems path - no other paths, no creation
			const systemsPath = `Systems/Periodic Notes/Daily/${year}-${month}-${day}.md`;
			const file = this.plugin.app.vault.getAbstractFileByPath(systemsPath);
			
			if (file) {
				return file;
			} else {
				console.warn('Daily note not found at:', systemsPath);
				return null;
			}
		} catch (error) {
			console.warn('Error finding daily note:', error);
			return null;
		}
	}

	getHabitPropertyName(habit: any): string {
		// Convert habit name and type to daily note property format
		// Example: habits.sleep.Wake up 7:30 max
		const category = habit.type || 'general';
		const cleanName = habit.name
			.replace(/💚\s*/, '') // Remove emoji prefix
			.replace(/[^\w\s]/g, '') // Remove special chars except spaces
			.trim();
		
		return `habits\\.${category}\\.${cleanName}`;
	}

	findOrCreateHabitsSection(content: string, category: string): { found: boolean; endIndex: number } {
		const lines = content.split('\n');
		const sectionRegex = new RegExp(`habits\\.${category}\\.?`, 'i');
		
		for (let i = 0; i < lines.length; i++) {
			if (sectionRegex.test(lines[i])) {
				// Find the end of this section (next section or end of file)
				let endIndex = i + 1;
				for (let j = i + 1; j < lines.length; j++) {
					if (lines[j].match(/^habits\./)) {
						endIndex = j;
						break;
					}
					if (lines[j].trim() === '') continue;
					endIndex = j + 1;
				}
				return { found: true, endIndex };
			}
		}
		
		return { found: false, endIndex: lines.length };
	}

	reloadCalendarView() {
		if (this.fullCalendarView) {
			// Force a complete re-render of the calendar
			this.fullCalendarView.render();
		}
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
