/**
 * Handles rendering the calendar given a container element, eventSources, and interaction callbacks.
 */
import {
	Calendar,
	CalendarOptions,
	EventApi,
	EventClickArg,
	EventHoveringArg,
	EventSourceInput,
} from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import googleCalendarPlugin from "@fullcalendar/google-calendar";
import iCalendarPlugin from "@fullcalendar/icalendar";
import interactionPlugin, { DateClickArg } from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import rrulePlugin from "@fullcalendar/rrule";
import timeGridPlugin from "@fullcalendar/timegrid";
import { DateTime } from "luxon";
import moment from "moment";

rrulePlugin.recurringTypes[0].expand = function (errd, fr, de) {
	// dtstart is stored as "fake UTC": its UTC components equal the intended
	// wall-clock time (e.g. UTC 23:30 represents local 23:30 regardless of DST).
	// Use getUTC* throughout so DST never shifts the hours or calendar date.
	const dtstart = errd.rruleSet._dtstart;
	const hours = dtstart.getUTCHours();
	const minutes = dtstart.getUTCMinutes();
	return errd.rruleSet
		.between(de.toDate(fr.start), de.toDate(fr.end), true)
		.map((d: Date) => {
			return new Date(
				Date.UTC(
					d.getUTCFullYear(),
					d.getUTCMonth(),
					d.getUTCDate(),
					hours,
					minutes,
				),
			);
		});
};

interface ExtraRenderProps {
	eventClick?: (info: EventClickArg) => void;
	dateClick?: (info: DateClickArg) => void;
	dayHeaderClick?: (date: Date) => void;
	select?: (
		startDate: Date,
		endDate: Date,
		allDay: boolean,
		viewType: string,
	) => Promise<void>;
	modifyEvent?: (event: EventApi, oldEvent: EventApi) => Promise<boolean>;
	eventMouseEnter?: (info: EventHoveringArg) => void;
	firstDay?: number;
	initialView?: { desktop: string; mobile: string };
	timeFormat24h?: boolean;
	openContextMenuForEvent?: (
		event: EventApi,
		mouseEvent: MouseEvent,
	) => Promise<void>;
	toggleTask?: (event: EventApi, isComplete: boolean) => Promise<boolean>;
	forceNarrow?: boolean;
}

// While Alt (Option) is held, events ignore the mouse (CSS in overrides.css),
// so a drag starts a new selection on the slots underneath, even on top of
// existing events. Installed once per window; it only toggles a body class.
const altCreateWindows = new WeakSet<Window>();
function installAltCreate(win: Window) {
	if (altCreateWindows.has(win)) return;
	altCreateWindows.add(win);
	const set = (held: boolean) =>
		win.document.body.classList.toggle("ofc-alt-held", held);
	win.addEventListener("keydown", (e) => e.key === "Alt" && set(true));
	win.addEventListener("keyup", (e) => e.key === "Alt" && set(false));
	win.addEventListener("mousemove", (e) => set(e.altKey));
	win.addEventListener("blur", () => set(false));
}

export function renderCalendar(
	containerEl: HTMLElement,
	eventSources: EventSourceInput[],
	settings?: Omit<CalendarOptions, "select"> & ExtraRenderProps,
): Calendar {
	const isMobile = window.innerWidth < 500;
	const isNarrow = settings?.forceNarrow || isMobile;
	const {
		eventClick,
		dateClick,
		dayHeaderClick,
		select,
		modifyEvent,
		eventMouseEnter,
		openContextMenuForEvent,
		toggleTask,
	} = settings || {};
	const modifyEventCallback =
		modifyEvent &&
		(async ({
			event,
			oldEvent,
			revert,
		}: {
			event: EventApi;
			oldEvent: EventApi;
			revert: () => void;
		}) => {
			const success = await modifyEvent(event, oldEvent);
			if (!success) {
				revert();
			}
		});

	const cal = new Calendar(containerEl, {
		plugins: [
			// View plugins
			dayGridPlugin,
			timeGridPlugin,
			listPlugin,
			// Drag + drop and editing
			interactionPlugin,
			// Remote sources
			googleCalendarPlugin,
			iCalendarPlugin,
			rrulePlugin,
		],
		googleCalendarApiKey: "AIzaSyDIiklFwJXaLWuT_4y6I9ZRVVsPuf4xGrk",
		initialView:
			settings?.initialView?.[isNarrow ? "mobile" : "desktop"] ||
			(isNarrow ? "timeGrid3Days" : "timeGridWeek"),
		nowIndicator: true,
		scrollTimeReset: false,
		dayMaxEvents: true,

		slotDuration: "00:15:00",
		slotLabelInterval: "01:00:00",
		// slotHeight: 18,
		// slotMinHeight: 15,
		customButtons: settings?.customButtons,

		headerToolbar: settings?.headerToolbar,
		footerToolbar: settings?.footerToolbar,

		initialDate: settings?.initialDate,
		eventLongPressDelay: settings?.eventLongPressDelay,
		selectLongPressDelay: settings?.selectLongPressDelay,

		views: {
			timeGridDay: {
				type: "timeGrid",
				duration: { days: 1 },
				buttonText: "1",
				eventLimit: 3,
			},
			timeGrid3Days: {
				type: "timeGrid",
				duration: { days: 3 },
				eventLimit: 3,
				buttonText: "3",
			},
			timeGridYear: {
				type: "dayGrid",
				duration: { days: 365 },
				buttonText: "Year",
				dayMaxEvents: 3,
			},
			habitsView: {
				type: "timeGrid",
				duration: { days: 1 },
				buttonText: "HB",
				eventLimit: 3,
			},
		},
		firstDay: settings?.firstDay,
		...(settings?.timeFormat24h && {
			eventTimeFormat: {
				hour: "numeric",
				minute: "2-digit",
				hour12: false,
			},
			// Hour only ("01", "13") to keep the time strip narrow
			slotLabelFormat: {
				hour: "2-digit",
				hour12: false,
			},
		}),
		eventSources,
		eventClick,
		dateClick,

		selectable: select && true,
		selectMirror: select && true,
		select:
			select &&
			(async (info) => {
				await select(info.start, info.end, info.allDay, info.view.type);
				info.view.calendar.unselect();
			}),

		editable: modifyEvent && true,
		eventDrop: modifyEventCallback,
		eventResize: modifyEventCallback,

		eventMouseEnter,

		dayHeaderDidMount: ({ el, date }) => {
			if (dayHeaderClick) {
				el.addEventListener("click", (e) => {
					e.preventDefault();
					dayHeaderClick(date);
				});
				el.style.cursor = "pointer";
			}
		},

		eventDidMount: ({ event, el, textColor }) => {
			el.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				if (!isMobile)
					openContextMenuForEvent &&
						openContextMenuForEvent(event, e);
			});

			// Depending on the view, we should put the checkbox in a different spot.
			const container =
				el.querySelector(".fc-event-time") ||
				el.querySelector(".fc-event-title") ||
				el.querySelector(".fc-list-event-title");

			if (
				!event.allDay &&
				event.start &&
				event.end &&
				moment(event.end).diff(event.start, "minutes") > 30
			) {
				const duration = document.createElement("p");
				duration.textContent = calculateDuration(
					event.start,
					event.end,
				);
				duration.style.fontSize = "10px";
				duration.style.position = "absolute";
				duration.style.bottom = "0";
				duration.style.right = "0";
				// Same color as the event, so the title under it is hidden
				duration.style.margin = "0";
				duration.style.padding = "0 3px";
				duration.style.borderRadius = "3px";
				duration.style.backgroundColor =
					getComputedStyle(el).backgroundColor;

				el.querySelector(".fc-event-main-frame")?.append(duration);
			}
			if (!isMobile) addOverflowPopover(el, event.title);
			if (toggleTask) {
				if (event.extendedProps.isTask) {
					const checkbox = document.createElement("input");
					checkbox.type = "checkbox";
					checkbox.checked =
						event.extendedProps.taskCompleted !== false;
					checkbox.onclick = async (e) => {
						e.stopPropagation();
						if (e.target) {
							let ret = await toggleTask(
								event,
								(e.target as HTMLInputElement).checked,
							);
							if (!ret) {
								(e.target as HTMLInputElement).checked = !(
									e.target as HTMLInputElement
								).checked;
							}
						}
					};
					// Make the checkbox more visible against different color events.
					if (textColor == "black") {
						checkbox.addClass("ofc-checkbox-black");
					} else {
						checkbox.addClass("ofc-checkbox-white");
					}

					if (checkbox.checked) {
						el.addClass("ofc-task-completed");
					}

					container?.addClass("ofc-has-checkbox");
					container?.prepend(checkbox);
				}
			}
		},

		eventWillUnmount: ({ el }) => (el as any).ofcHidePopover?.(),

		longPressDelay: settings?.longPressDelay,
	});

	function calculateDuration(start: Date, end: Date) {
		const duration = moment(end).diff(moment(start), "minutes");
		const hours = Math.floor(duration / 60);
		const minutes = duration % 60;

		if (hours > 0 && minutes > 0) {
			return `${hours}h ${minutes}m`;
		} else if (hours > 0) {
			return `${hours}h`;
		} else {
			return `${minutes}m`;
		}
	}

	cal.render();
	if (select) installAltCreate(containerEl.ownerDocument.defaultView ?? window);

	// If the container has zero size at render time (e.g. rendered inside a
	// hidden tab), FullCalendar skips slot-height calculations and the time
	// grid never appears. Watch for the first time the container gains real
	// dimensions and force a layout recalculation.
	if (containerEl.offsetWidth === 0 || containerEl.offsetHeight === 0) {
		const observer = new ResizeObserver(() => {
			if (containerEl.offsetWidth > 0 && containerEl.offsetHeight > 0) {
				observer.disconnect();
				cal.updateSize();
			}
		});
		observer.observe(containerEl);
	}

	return cal;
}

/** True when part of the event's text is cut off or under the duration label. */
function isTextHidden(el: HTMLElement): boolean {
	const cut = (e: Element | null) =>
		!!e &&
		(e.scrollHeight > e.clientHeight + 1 ||
			e.scrollWidth > e.clientWidth + 1);
	// Not the event box itself: its resize handles stick out 4px, so it always looks cut
	if (
		cut(el.querySelector(".fc-event-title")) ||
		cut(el.querySelector(".fc-event-time"))
	) {
		return true;
	}
	// Time label hidden by CSS on short events (15-30 min)
	const time = el.querySelector(".fc-event-time");
	if (time?.textContent && time.getClientRects().length === 0) {
		return true;
	}
	const title = el.querySelector(".fc-event-title");
	const duration = el.querySelector(".fc-event-main-frame > p");
	if (title && duration) {
		const range = document.createRange();
		range.selectNodeContents(title);
		const text = range.getBoundingClientRect();
		const label = duration.getBoundingClientRect();
		return text.bottom > label.top + 1 && text.right > label.left + 1;
	}
	return false;
}

/** On hover, shows the event's time and full title, only when some of it is hidden. */
function addOverflowPopover(el: HTMLElement, title: string) {
	let popover: HTMLElement | null = null;
	const hide = () => {
		popover?.remove();
		popover = null;
	};
	el.addEventListener("mouseenter", () => {
		hide();
		if (!el.isConnected || !isTextHidden(el)) return;
		popover = document.body.createDiv({ cls: "ofc-event-popover" });
		const time = el.querySelector(".fc-event-time")?.textContent;
		if (time) popover.createDiv({ cls: "ofc-event-popover-time", text: time });
		popover.createDiv({ text: title });

		const rect = el.getBoundingClientRect();
		const box = popover.getBoundingClientRect();
		let left = rect.right + 6;
		if (left + box.width > window.innerWidth - 8) {
			left = Math.max(8, rect.left - box.width - 6);
		}
		const top = Math.min(rect.top, window.innerHeight - box.height - 8);
		popover.style.left = `${left}px`;
		popover.style.top = `${Math.max(8, top)}px`;
	});
	el.addEventListener("mouseleave", hide);
	el.addEventListener("mousedown", hide);
	// The event can be removed while hovered (drag, rerender): eventWillUnmount calls this
	(el as any).ofcHidePopover = hide;
}
