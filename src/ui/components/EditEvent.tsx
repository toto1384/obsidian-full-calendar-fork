import { DateTime } from "luxon";
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { CalendarInfo, OFCEvent } from "../../types";

function makeChangeListener<T>(
	setState: React.Dispatch<React.SetStateAction<T>>,
	fromString: (val: string) => T
): React.ChangeEventHandler<HTMLInputElement | HTMLSelectElement> {
	return (e) => setState(fromString(e.target.value));
}

interface DayChoiceProps {
	code: string;
	label: string;
	isSelected: boolean;
	onClick: (code: string) => void;
}
const DayChoice = ({ code, label, isSelected, onClick }: DayChoiceProps) => (
	<button
		type="button"
		style={{
			marginLeft: "0.25rem",
			marginRight: "0.25rem",
			padding: "0",
			backgroundColor: isSelected
				? "var(--interactive-accent)"
				: "var(--interactive-normal)",
			color: isSelected ? "var(--text-on-accent)" : "var(--text-normal)",
			borderStyle: "solid",
			borderWidth: "1px",
			borderRadius: "50%",
			width: "25px",
			height: "25px",
		}}
		onClick={() => onClick(code)}
	>
		<b>{label[0]}</b>
	</button>
);

const DAY_MAP = {
	U: "Sunday",
	M: "Monday",
	T: "Tuesday",
	W: "Wednesday",
	R: "Thursday",
	F: "Friday",
	S: "Saturday",
};

const DaySelect = ({
	value: days,
	onChange,
}: {
	value: string[];
	onChange: (days: string[]) => void;
}) => {
	return (
		<div>
			{Object.entries(DAY_MAP).map(([code, label]) => (
				<DayChoice
					key={code}
					code={code}
					label={label}
					isSelected={days.includes(code)}
					onClick={() =>
						days.includes(code)
							? onChange(days.filter((c) => c !== code))
							: onChange([code, ...days])
					}
				/>
			))}
		</div>
	);
};

interface EditEventProps {
	submit: (frontmatter: OFCEvent, calendarIndex: number) => Promise<void>;
	readonly calendars: {
		id: string;
		name: string;
		type: CalendarInfo["type"];
	}[];
	defaultCalendarIndex: number;
	initialEvent?: Partial<OFCEvent>;
	open?: () => Promise<void>;
	deleteEvent?: () => Promise<void>;
	onGhostEventChange?: (event: OFCEvent | null, calendarId: string) => void;
}

export const EditEvent = ({
	initialEvent,
	submit,
	open,
	deleteEvent,
	calendars,
	defaultCalendarIndex,
	onGhostEventChange,
}: EditEventProps) => {
	const [date, setDate] = useState(
		initialEvent
			? initialEvent.type === "single"
				? initialEvent.date
				: initialEvent.type === "recurring"
					? initialEvent.startRecur
					: initialEvent.type === "rrule"
						? initialEvent.startDate
						: ""
			: ""
	);
	const [endDate, setEndDate] = useState(
		initialEvent && initialEvent.type === "single"
			? initialEvent.endDate
			: undefined
	);

	let initialStartTime = "";
	let initialEndTime = "";
	if (initialEvent) {
		// @ts-ignore
		const { startTime, endTime } = initialEvent;
		initialStartTime = startTime || "";
		initialEndTime = endTime || "";
	}

	const [expanded, setExpanded] = useState(true)

	const [startTime, setStartTime] = useState(initialStartTime);
	const [endTime, setEndTime] = useState(initialEndTime);
	const [title, setTitle] = useState(initialEvent?.title || "");
	const [isRecurring, setIsRecurring] = useState(
		initialEvent?.type === "recurring" || false
	);
	const [endRecur, setEndRecur] = useState("");

	const [daysOfWeek, setDaysOfWeek] = useState<string[]>(
		(initialEvent?.type === "recurring" ? initialEvent.daysOfWeek : []) ||
		[]
	);

	const [allDay, setAllDay] = useState(initialEvent?.allDay || false);

	const [calendarIndex, setCalendarIndex] = useState(defaultCalendarIndex);

	const [complete, setComplete] = useState(
		initialEvent?.type === "single" &&
			initialEvent.completed !== null &&
			initialEvent.completed !== undefined
			? initialEvent.completed
			: false
	);

	const [isTask, setIsTask] = useState(
		initialEvent?.type === "single" &&
		initialEvent.completed !== undefined &&
		initialEvent.completed !== null
	);

	const [eventColor, setEventColor] = useState(initialEvent?.color || "");

	const titleRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (titleRef.current) {
			titleRef.current.focus();
		}
	}, [titleRef]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			// Cmd+Enter / Ctrl+Enter to save
			console.log(event.key, event.ctrlKey, event.metaKey, event.shiftKey);
			if (event.ctrlKey && event.key === 'Enter') {
				event.preventDefault();
				const form = document.querySelector('form') as HTMLFormElement;
				if (form) {
					form.requestSubmit();
				}
				return;
			}

			// Ctrl+Backspace to delete event
			if (event.ctrlKey && event.key === 'Backspace' && deleteEvent) {
				event.preventDefault();
				deleteEvent();
				return;
			}

			// Ctrl+- to decrement end time by 15 minutes
			if (event.ctrlKey && event.key === '-') {
				event.preventDefault();
				if (endTime) {
					const [hours, minutes] = endTime.split(':').map(Number);
					const totalMinutes = hours * 60 + minutes - 15;
					const newHours = Math.floor((totalMinutes + 24 * 60) / 60) % 24; // Handle negative wrap-around
					const newMinutes = ((totalMinutes % 60) + 60) % 60; // Handle negative minutes
					const newTime = `${newHours.toString().padStart(2, '0')}:${newMinutes.toString().padStart(2, '0')}`;
					setEndTime(newTime);
				}
				return;
			}

			// Ctrl++ to increment end time by 15 minutes
			if (event.ctrlKey && (event.key === '+' || event.key === '=')) {
				event.preventDefault();
				if (endTime) {
					const [hours, minutes] = endTime.split(':').map(Number);
					const totalMinutes = hours * 60 + minutes + 15;
					const newHours = Math.floor(totalMinutes / 60) % 24;
					const newMinutes = totalMinutes % 60;
					const newTime = `${newHours.toString().padStart(2, '0')}:${newMinutes.toString().padStart(2, '0')}`;
					setEndTime(newTime);
				}
				return;
			}

			// Ctrl+] to move whole event forward by 15 minutes
			if (event.ctrlKey && event.key === ']') {
				event.preventDefault();
				if (startTime && endTime) {
					// Move start time
					const [startHours, startMinutes] = startTime.split(':').map(Number);
					const newStartTotalMinutes = startHours * 60 + startMinutes + 15;
					const newStartHours = Math.floor(newStartTotalMinutes / 60) % 24;
					const newStartMinutes = newStartTotalMinutes % 60;
					const newStartTime = `${newStartHours.toString().padStart(2, '0')}:${newStartMinutes.toString().padStart(2, '0')}`;

					// Move end time
					const [endHours, endMinutes] = endTime.split(':').map(Number);
					const newEndTotalMinutes = endHours * 60 + endMinutes + 15;
					const newEndHours = Math.floor(newEndTotalMinutes / 60) % 24;
					const newEndMinutes = newEndTotalMinutes % 60;
					const newEndTime = `${newEndHours.toString().padStart(2, '0')}:${newEndMinutes.toString().padStart(2, '0')}`;

					setStartTime(newStartTime);
					setEndTime(newEndTime);
				}
				return;
			}

			// Ctrl+[ to move whole event backward by 15 minutes
			if (event.ctrlKey && event.key === '[') {
				event.preventDefault();
				if (startTime && endTime) {
					// Move start time
					const [startHours, startMinutes] = startTime.split(':').map(Number);
					const newStartTotalMinutes = startHours * 60 + startMinutes - 15;
					const newStartHours = Math.floor((newStartTotalMinutes + 24 * 60) / 60) % 24; // Handle negative wrap-around
					const newStartMinutes = ((newStartTotalMinutes % 60) + 60) % 60; // Handle negative minutes
					const newStartTime = `${newStartHours.toString().padStart(2, '0')}:${newStartMinutes.toString().padStart(2, '0')}`;

					// Move end time
					const [endHours, endMinutes] = endTime.split(':').map(Number);
					const newEndTotalMinutes = endHours * 60 + endMinutes - 15;
					const newEndHours = Math.floor((newEndTotalMinutes + 24 * 60) / 60) % 24; // Handle negative wrap-around
					const newEndMinutes = ((newEndTotalMinutes % 60) + 60) % 60; // Handle negative minutes
					const newEndTime = `${newEndHours.toString().padStart(2, '0')}:${newEndMinutes.toString().padStart(2, '0')}`;

					setStartTime(newStartTime);
					setEndTime(newEndTime);
				}
				return;
			}

			// Calendar selection shortcuts using QWERTY keys
			if (event.ctrlKey) {
				const key = event.key.toLowerCase();

				// Define QWERTY key mapping for calendars
				const qwertyKeys = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'];
				const keyIndex = qwertyKeys.indexOf(key);

				if (keyIndex !== -1 && keyIndex < calendars.length) {
					event.preventDefault();
					setCalendarIndex(keyIndex);
					return;
				}
			}
		};

		document.addEventListener('keydown', handleKeyDown);

		return () => {
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [calendars, setCalendarIndex, deleteEvent, endTime, setEndTime]);

	// Debounced ghost event update function
	const updateGhostEvent = React.useCallback(() => {
		if (!onGhostEventChange) return;
		if (!calendars[calendarIndex]?.id) return;

		const ghostEvent: OFCEvent = {
			title: title || "Untitled Event",
			...(eventColor ? { color: eventColor } : {}),
			...(allDay
				? { allDay: true }
				: { allDay: false, startTime: startTime || "", endTime }),
			...(isRecurring
				? {
					type: "recurring",
					daysOfWeek: daysOfWeek as (
						| "U"
						| "M"
						| "T"
						| "W"
						| "R"
						| "F"
						| "S"
					)[],
					startRecur: date || undefined,
					endRecur: endRecur || undefined,
				}
				: {
					type: "single",
					date: date || "",
					endDate: endDate || null,
					completed: isTask ? complete : null,
				}),
		};

		const calendarId = calendars[calendarIndex].id;
		console.log('Creating ghost event:', { ghostEvent, calendarId, calendarIndex });
		onGhostEventChange(ghostEvent, calendarId);
	}, [allDay, startTime, endTime, isRecurring, daysOfWeek, date, endRecur, endDate, isTask, complete, calendarIndex, calendars, onGhostEventChange, eventColor]);

	// Debounced update for title changes
	useEffect(() => {
		console.log('Title changed, debouncing ghost event update');

		const debounceTimer = setTimeout(() => {
			console.log('Debounced title ghost event update executing');
			if (!onGhostEventChange || !calendars[calendarIndex]?.id) return;

			const ghostEvent: OFCEvent = {
				title: title || "Untitled Event",
				...(eventColor ? { color: eventColor } : {}),
				...(allDay
					? { allDay: true }
					: { allDay: false, startTime: startTime || "", endTime }),
				...(isRecurring
					? {
						type: "recurring",
						daysOfWeek: daysOfWeek as (
							| "U"
							| "M"
							| "T"
							| "W"
							| "R"
							| "F"
							| "S"
						)[],
						startRecur: date || undefined,
						endRecur: endRecur || undefined,
					}
					: {
						type: "single",
						date: date || "",
						endDate: endDate || null,
						completed: isTask ? complete : null,
					}),
			};

			const calendarId = calendars[calendarIndex].id;
			console.log('Creating debounced ghost event:', { ghostEvent, calendarId });
			onGhostEventChange(ghostEvent, calendarId);
		}, 1500);

		return () => {
			console.log('Clearing debounce timer for title');
			clearTimeout(debounceTimer);
		};
	}, [title]);

	// Immediate update for non-title changes
	useEffect(() => {
		console.log('Non-title field changed, immediate ghost event update');
		updateGhostEvent();
	}, [allDay, startTime, endTime, isRecurring, daysOfWeek, date, endRecur, endDate, isTask, complete, calendarIndex, calendars, eventColor]);

	// Clean up ghost event when component unmounts
	useEffect(() => {
		return () => {
			if (onGhostEventChange) {
				onGhostEventChange(null, "");
			}
		};
	}, [onGhostEventChange]);

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		await submit(
			{
				...{ title },
				color: eventColor || undefined,
				...(allDay
					? { allDay: true }
					: { allDay: false, startTime: startTime || "", endTime }),
				...(isRecurring
					? {
						type: "recurring",
						daysOfWeek: daysOfWeek as (
							| "U"
							| "M"
							| "T"
							| "W"
							| "R"
							| "F"
							| "S"
						)[],
						startRecur: date || undefined,
						endRecur: endRecur || undefined,
					}
					: {
						type: "single",
						date: date || "",
						endDate: endDate || null,
						completed: isTask ? complete : null,
					}),
			},
			calendarIndex
		);
	};


	const sliderRef = useRef(null);
	const [isDragging, setIsDragging] = useState(null);

	// Convert time string (HH:MM) to minutes from midnight
	const timeToMinutes = (timeStr: any) => {
		if (!timeStr) return 0;
		const [hours, minutes] = timeStr.split(':').map(Number);
		return hours * 60 + minutes;
	};

	// Convert minutes from midnight to time string (HH:MM)
	const minutesToTime = (minutes: any) => {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
	};

	const startMinutes = timeToMinutes(startTime);
	const endMinutes = timeToMinutes(endTime);
	const maxMinutes = 24 * 60; // 24 hours

	// Calculate positions as percentages
	const startPos = (startMinutes / maxMinutes) * 100;
	const endPos = (endMinutes / maxMinutes) * 100;


	const handleMouseDown = (handle: any, e: any) => {
		e.preventDefault();
		setIsDragging(handle);
	};

	const handleTouchStart = (handle: any, e: any) => {
		e.preventDefault();
		setIsDragging(handle);
	};

	const getClientX = (e: any) => {
		return e.touches ? e.touches[0].clientX : e.clientX;
	};

	const handleMove = React.useCallback((e) => {
		if (!isDragging || !sliderRef.current) return;

		const rect = (sliderRef.current as any).getBoundingClientRect();
		const clientX = getClientX(e);
		const percentage = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
		const rawMinutes = (percentage / 100) * maxMinutes;

		// Snap to 15-minute intervals
		const minutes = Math.round(rawMinutes / 15) * 15;
		const timeStr = minutesToTime(minutes);

		if (isDragging === 'start') {
			if (minutes < endMinutes) {
				setStartTime(timeStr);
			}
		} else if (isDragging === 'end') {
			if (minutes > startMinutes) {
				setEndTime(timeStr);
			}
		}
	}, [isDragging, endMinutes, startMinutes, setStartTime, setEndTime, maxMinutes]);

	const handleEnd = React.useCallback(() => {
		setIsDragging(null);
	}, []);

	// Add event listeners for both mouse and touch
	React.useEffect(() => {
		if (isDragging) {
			// Mouse events
			document.addEventListener('mousemove', handleMove);
			document.addEventListener('mouseup', handleEnd);

			// Touch events
			document.addEventListener('touchmove', handleMove, { passive: false });
			document.addEventListener('touchend', handleEnd);

			return () => {
				document.removeEventListener('mousemove', handleMove);
				document.removeEventListener('mouseup', handleEnd);
				document.removeEventListener('touchmove', handleMove);
				document.removeEventListener('touchend', handleEnd);
			};
		}
	}, [isDragging, handleMove, handleEnd]);

	return (
		<>
			<div>
				<p style={{ float: "right" }}>
					{<button onClick={() => setExpanded(!expanded)}>Expand</button>}
				</p>
				<p style={{ float: "right" }}>
					{open && <button onClick={open}>Open Note</button>}
				</p>
			</div>

			{<form style={{ visibility: expanded ? 'visible' : 'hidden', height: expanded ? undefined : 0 }} onSubmit={handleSubmit}>
				<p>
					<input
						ref={titleRef}
						type="text"
						id="title"
						value={title}
						placeholder={"Add title"}
						required
						onChange={makeChangeListener(setTitle, (x) => x)}
					/>
				</p>
				<p>
					{false && <select
						id="calendar"
						value={calendarIndex}
						onChange={makeChangeListener(
							setCalendarIndex,
							parseInt
						)}
					>
						{calendars
							.flatMap((cal) =>
								cal.type === "local" || cal.type === "dailynote"
									? [cal]
									: []
							)
							.map((cal, idx) => (
								<option
									key={idx}
									value={idx}
									disabled={
										!(
											initialEvent?.title === undefined ||
											calendars[calendarIndex].type ===
											cal.type
										)
									}
								>
									{cal.type === "local"
										? cal.name.split('/').pop() || cal.name
										: "Daily Note"}
								</option>
							))}
					</select>}
					<div style={{ marginTop: "0.5rem", display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
						{calendars
							.flatMap((cal) =>
								cal.type === "local" || cal.type === "dailynote"
									? [cal]
									: []
							)
							.map((cal, idx) => (
								<button
									key={idx}
									type="button"
									style={{
										fontSize: "10px",
										padding: "2px 6px",
										borderRadius: "3px",
										border: "1px solid var(--background-modifier-border)",
										backgroundColor: calendarIndex === idx
											? "var(--interactive-accent)"
											: "var(--interactive-normal)",
										color: calendarIndex === idx
											? "var(--text-on-accent)"
											: "var(--text-normal)",
										cursor: "pointer",
										minWidth: "auto",
										height: "20px",
										lineHeight: "1"
									}}
									onClick={() => setCalendarIndex(idx)}
									title={`${cal.type === "local" ? cal.name : "Daily Note"} (Ctrl+${['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'][idx] || '•'})`}
									disabled={
										!(
											initialEvent?.title === undefined ||
											calendars[calendarIndex].type ===
											cal.type
										)
									}
								>
									{['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'][idx] || '•'} {cal.type === "local" ? cal.name.split('/').pop() || cal.name : "Daily"}
								</button>
							))}
					</div>
				</p>
				<p>
					{!isRecurring && (
						<input
							type="date"
							id="date"
							value={date}
							required={!isRecurring}
							// @ts-ignore
							onChange={makeChangeListener(setDate, (x) => x)}
						/>
					)}

					{allDay ? (
						<></>
					) : (
						<>
							<div style={{ marginTop: "0.5rem", marginBottom: "0.5rem" }}>
								<div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
									<div style={{ display: "flex", flexDirection: "column", flex: "1" }}>
										<label htmlFor="startTime" style={{ fontSize: "12px", marginBottom: "0.25rem" }}>Start Time</label>
										<input
											type="time"
											id="startTime"
											value={startTime}
											required
											style={{
												fontSize: "16px",
												padding: "8px 12px",
												border: "1px solid var(--background-modifier-border)",
												borderRadius: "4px",
												width: "100%"
											}}
											onChange={makeChangeListener(
												setStartTime,
												(x) => x
											)}
										/>
									</div>
									<div style={{ display: "flex", flexDirection: "column", flex: "1" }}>
										<label htmlFor="endTime" style={{ fontSize: "12px", marginBottom: "0.25rem" }}>End Time</label>
										<input
											type="time"
											id="endTime"
											value={endTime}
											required
											style={{
												fontSize: "16px",
												padding: "8px 12px",
												border: "1px solid var(--background-modifier-border)",
												borderRadius: "4px",
												width: "100%"
											}}
											onChange={makeChangeListener(
												setEndTime,
												(x) => x
											)}
										/>
									</div>
								</div>
							</div>


							{/* Slider Container */}
							<div style={{ position: 'relative', marginTop: 20, marginBottom: 20 }}>
								{/* Track */}
								<div
									ref={sliderRef}
									style={{
										position: 'relative',
										height: '8px',
										backgroundColor: '#e5e7eb',
										borderRadius: '4px',
										cursor: 'pointer'
									}}
								>
									{/* Active Range */}
									<div
										style={{
											position: 'absolute',
											height: '8px',
											backgroundColor: '#3b82f6',
											borderRadius: '4px',
											left: `${startPos}%`,
											width: `${endPos - startPos}%`
										}}
									/>

									{/* Start Handle */}
									<div
										style={{
											position: 'absolute',
											width: '20px',
											height: '20px',
											backgroundColor: 'white',
											border: '2px solid #3b82f6',
											borderRadius: '50%',
											cursor: 'grab',
											transform: 'translateY(-6px)',
											boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
											left: `${startPos}%`,
											marginLeft: '-10px',
											transition: 'box-shadow 0.2s'
										}}
										onTouchStart={(e) => handleTouchStart('start', e)}
										onMouseDown={(e) => handleMouseDown('start', e)}
										onMouseEnter={(e) => (e.target as any).style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)'}
										onMouseLeave={(e) => (e.target as any).style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}
									/>

									{/* End Handle */}
									<div
										style={{
											position: 'absolute',
											width: '20px',
											height: '20px',
											backgroundColor: 'white',
											border: '2px solid #3b82f6',
											borderRadius: '50%',
											cursor: 'grab',
											transform: 'translateY(-6px)',
											boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
											left: `${endPos}%`,
											marginLeft: '-10px',
											transition: 'box-shadow 0.2s'
										}}
										onMouseDown={(e) => handleMouseDown('end', e)}
										onTouchStart={(e) => handleTouchStart('end', e)}
										onMouseEnter={(e) => (e.target as any).style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)'}
										onMouseLeave={(e) => (e.target as any).style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}
									/>
								</div>

								{/* Time Markers */}
								<div style={{
									display: 'flex',
									justifyContent: 'space-between',
									marginTop: '8px',
									fontSize: '12px',
									color: '#6b7280'
								}}>
									<span>12 AM</span>
									<span>6 AM</span>
									<span>12 PM</span>
									<span>6 PM</span>
									<span>12 AM</span>
								</div>
							</div>

							{/* Hidden inputs for form compatibility */}
							<input type="hidden" name="startTime" value={startTime} />
							<input type="hidden" name="endTime" value={endTime} />

						</>
					)}
				</p >
				<p>
					<label htmlFor="allDay">All day event </label>
					<input
						id="allDay"
						checked={allDay}
						onChange={(e) => setAllDay(e.target.checked)}
						type="checkbox"
					/>
				</p>
				<p>
					<label htmlFor="recurring">Recurring Event </label>
					<input
						id="recurring"
						checked={isRecurring}
						onChange={(e) => setIsRecurring(e.target.checked)}
						type="checkbox"
					/>
				</p>

				{
					isRecurring && (
						<>
							<DaySelect
								value={daysOfWeek}
								onChange={setDaysOfWeek}
							/>
							<p>
								Starts recurring
								<input
									type="date"
									id="startDate"
									value={date}
									// @ts-ignore
									onChange={makeChangeListener(setDate, (x) => x)}
								/>
								and stops recurring
								<input
									type="date"
									id="endDate"
									value={endRecur}
									onChange={makeChangeListener(
										setEndRecur,
										(x) => x
									)}
								/>
							</p>
						</>
					)
				}
				<p>
					<label htmlFor="task">Task Event </label>
					<input
						id="task"
						checked={isTask}
						onChange={(e) => {
							setIsTask(e.target.checked);
						}}
						type="checkbox"
					/>
				</p>

				{
					isTask && (
						<>
							<label htmlFor="taskStatus">Complete? </label>
							<input
								id="taskStatus"
								checked={
									!(complete === false || complete === undefined)
								}
								onChange={(e) =>
									setComplete(
										e.target.checked
											? DateTime.now().toISO()
											: false
									)
								}
								type="checkbox"
							/>
						</>
					)
				}

				<p style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
					<label htmlFor="eventColor">Event Color </label>
					<input
						type="color"
						id="eventColor"
						value={eventColor || "#3788d8"}
						onChange={(e) => setEventColor(e.target.value)}
						style={{
							width: "40px",
							height: "24px",
							padding: "0",
							border: "1px solid var(--background-modifier-border)",
							borderRadius: "4px",
							cursor: "pointer"
						}}
					/>
					{eventColor && (
						<button
							type="button"
							onClick={() => setEventColor("")}
							style={{
								fontSize: "10px",
								padding: "2px 6px",
								backgroundColor: "var(--interactive-normal)",
								border: "1px solid var(--background-modifier-border)",
								borderRadius: "3px",
								cursor: "pointer"
							}}
						>
							Clear
						</button>
					)}
				</p>

				<p
					style={{
						display: "flex",
						justifyContent: "space-between",
						width: "100%",
					}}
				>
					<button type="submit"> Save Event </button>
					<span>
						{deleteEvent && (
							<button
								type="button"
								style={{
									backgroundColor:
										"var(--interactive-normal)",
									color: "var(--background-modifier-error)",
									borderColor:
										"var(--background-modifier-error)",
									borderWidth: "1px",
									borderStyle: "solid",
								}}
								onClick={deleteEvent}
							>
								Delete Event
							</button>
						)}
					</span>
				</p>
			</form >}
		</>
	);
};
