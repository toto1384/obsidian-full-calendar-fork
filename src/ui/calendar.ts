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
import { DateClickArg } from "@fullcalendar/interaction";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import rrulePlugin from "@fullcalendar/rrule";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import googleCalendarPlugin from "@fullcalendar/google-calendar";
import iCalendarPlugin from "@fullcalendar/icalendar";
import moment from "moment";
import { DateTime } from "luxon";
import { getTzInfo } from "./tzRegistry";


// There is an issue with FullCalendar RRule support around DST boundaries which is fixed by this monkeypatch:
// https://github.com/fullcalendar/fullcalendar/issues/5273#issuecomment-1360459342
// We preserve the wall-clock time from dtstart for all occurrences.
// For events with original timezone info, we properly convert the wall-clock time
// from the original timezone to local time for each occurrence date.
rrulePlugin.recurringTypes[0].expand = function(errd, fr, de) {
	const dtstart = errd.rruleSet._dtstart;

	// Check if we have original timezone info for this event
	const tzInfo = getTzInfo(dtstart);
	console.log(`RRule expand: dtstart=${dtstart.getTime()}, tzInfo=${tzInfo ? JSON.stringify(tzInfo) : 'not found'}`);

	return errd.rruleSet
		.between(de.toDate(fr.start), de.toDate(fr.end), true)
		.map((d: Date) => {
			if (tzInfo) {
				// Parse the original wall-clock time
				const [hours, minutes] = tzInfo.originalStartTime.split(':').map(Number);

				// Create a DateTime in the original timezone for this occurrence date
				const dtInOriginalTz = DateTime.fromObject({
					year: d.getFullYear(),
					month: d.getMonth() + 1, // Luxon months are 1-indexed
					day: d.getDate(),
					hour: hours,
					minute: minutes,
				}, { zone: tzInfo.originalTz });

				// Convert to local timezone
				const localDt = dtInOriginalTz.setZone('local');

				console.log(`RRule expand with TZ: ${tzInfo.originalStartTime} ${tzInfo.originalTz} on ${d.toDateString()} -> ${localDt.toISO()} local`);

				return localDt.toJSDate();
			}

			// Fallback: preserve wall-clock time from dtstart (original behavior)
			const hours = dtstart.getHours();
			const minutes = dtstart.getMinutes();

			return new Date(
				d.getFullYear(),
				d.getMonth(),
				d.getDate(),
				hours,
				minutes
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
		viewType: string
	) => Promise<void>;
	modifyEvent?: (event: EventApi, oldEvent: EventApi) => Promise<boolean>;
	eventMouseEnter?: (info: EventHoveringArg) => void;
	firstDay?: number;
	initialView?: { desktop: string; mobile: string };
	timeFormat24h?: boolean;
	openContextMenuForEvent?: (
		event: EventApi,
		mouseEvent: MouseEvent
	) => Promise<void>;
	toggleTask?: (event: EventApi, isComplete: boolean) => Promise<boolean>;
	forceNarrow?: boolean;
}

export function renderCalendar(
	containerEl: HTMLElement,
	eventSources: EventSourceInput[],
	settings?: Omit<CalendarOptions, "select"> & ExtraRenderProps
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



		slotDuration: '00:15:00',
		slotLabelInterval: '01:00:00',
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
			slotLabelFormat: {
				hour: "numeric",
				minute: "2-digit",
				hour12: false,
			},
		}),
		eventSources,
		eventClick,
		dateClick,

		slotLaneClassNames: (arg) => {
			// Only apply to time grid views and when we have a valid date
			if (!arg || !arg.date || !arg.view) {
				return [];
			}

			// Only apply to timeGrid views (day, week, 3-day)
			const viewType = arg.view.type;
			if (!viewType.startsWith('timeGrid')) {
				return [];
			}

			const hour = arg.date.getHours();

			// 7am to 1pm (07:00-13:00) - Morning/Green
			if (hour >= 7 && hour < 13) {
				return ['ofc-morning-slot'];
			}
			// 1pm to 5pm (13:00-17:00) - Afternoon/Blue
			else if (hour >= 13 && hour < 17) {
				return ['ofc-afternoon-slot'];
			}
			// 5pm to 11pm (17:00-23:00) - Evening/Yellow
			else if (hour >= 17 && hour < 23) {
				return ['ofc-evening-slot'];
			}

			// Return empty array for other times (11pm-7am)
			return [];
		},

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
				el.addEventListener('click', (e) => {
					e.preventDefault();
					dayHeaderClick(date);
				});
				el.style.cursor = 'pointer';
			}

			// Add habits percent to day header with retry mechanism
			const addHabitsPercent = () => {
				try {
					const dateFile = moment(date).format('YYYY-MM-DD');
					if ((window as any).habitUtils && (window as any).habitUtils.habitsPercentByName) {
						const habitsResult = (window as any).habitUtils.habitsPercentByName(dateFile);
						if (habitsResult && habitsResult.habitsPercent !== undefined && habitsResult.habitsPercent !== null) {
							const percent = Math.round(habitsResult.habitsPercent);

							// Make parent relative for absolute positioning
							el.style.position = 'relative';
							el.style.paddingLeft = '18px'; // Make room for the circle

							// Create circle indicator
							const circleContainer = document.createElement('span');
							circleContainer.style.position = 'absolute';
							circleContainer.style.left = '2px';
							circleContainer.style.top = '50%';
							circleContainer.style.transform = 'translateY(-50%)';
							circleContainer.style.width = '12px';
							circleContainer.style.height = '12px';

							const circle = document.createElement('div');
							circle.style.width = '12px';
							circle.style.height = '12px';
							circle.style.borderRadius = '50%';
							circle.style.position = 'relative';
							circle.style.overflow = 'hidden';
							circle.style.backgroundColor = 'rgba(255, 255, 255, 0.3)';

							// Determine color based on percentage
							let fillColor;
							if (percent >= 65) {
								fillColor = '#22c55e'; // Green
							} else if (percent >= 40) {
								fillColor = '#eab308'; // Yellow
							} else {
								fillColor = '#ef4444'; // Red
							}

							// Create fill section based on percentage
							const fill = document.createElement('div');
							fill.style.position = 'absolute';
							fill.style.top = '0';
							fill.style.left = '0';
							fill.style.width = '100%';
							fill.style.height = `${percent}%`;
							fill.style.backgroundColor = fillColor;
							fill.style.borderRadius = '50%';
							fill.style.transform = `rotate(${(percent / 100) * 360}deg)`;
							fill.style.transformOrigin = 'center bottom';

							// Better approach: use conic-gradient for accurate percentage display
							circle.style.background = `conic-gradient(${fillColor} 0deg ${(percent / 100) * 360}deg, rgba(255, 255, 255, 0.3) ${(percent / 100) * 360}deg 360deg)`;

							circleContainer.appendChild(circle);
							el.appendChild(circleContainer);
						}
						return true; // Success
					}
					return false; // Function not available yet
				} catch (error) {
					console.warn('Failed to get habits percent for date:', date, error);
					return true; // Don't retry on actual errors
				}
			};

			// Try immediately first
			if (!addHabitsPercent()) {
				// If not available, retry every 5 seconds for 1 minute
				let attempts = 0;
				const maxAttempts = 12; // 12 * 5 seconds = 60 seconds
				const retryInterval = setInterval(() => {
					attempts++;
					if (addHabitsPercent() || attempts >= maxAttempts) {
						clearInterval(retryInterval);
					}
				}, 5000);
			}
		},

		eventDidMount: ({ event, el, textColor }) => {
			// Add data attribute for vimium mode matching
			el.setAttribute('data-fc-event-id', event.id);

			el.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				if (!isMobile) openContextMenuForEvent && openContextMenuForEvent(event, e);
			});

			// Depending on the view, we should put the checkbox in a different spot.
			const container =
				el.querySelector(".fc-event-time") ||
				el.querySelector(".fc-event-title") ||
				el.querySelector(".fc-list-event-title");

			if (event.start && event.end && moment(event.end).diff(event.start, "minutes") > 30) {
				const duration = document.createElement("p");
				duration.textContent = calculateDuration(event.start, event.end)
				duration.style.fontSize = "10px";
				duration.style.position = 'absolute';
				duration.style.bottom = "0";
				duration.style.right = "0";

				el.querySelector('.fc-event-main-frame')?.append(duration)

			}
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
								(e.target as HTMLInputElement).checked
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

		longPressDelay: settings?.longPressDelay,
	});

	setInterval(() => {
		cal?.refetchEvents()
	}, 30000);

	function calculateDuration(start: Date, end: Date) {
		const duration = moment(end).diff(moment(start), 'minutes');
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
	return cal;
}
