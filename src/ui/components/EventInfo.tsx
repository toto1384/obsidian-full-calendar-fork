import * as React from "react";
import { OFCEvent } from "src/types";

interface EventInfoProps {
	event: OFCEvent;
	calendarName?: string;
}

const DAYS_OF_WEEK: Record<string, string> = {
	U: "Sunday",
	M: "Monday",
	T: "Tuesday",
	W: "Wednesday",
	R: "Thursday",
	F: "Friday",
	S: "Saturday",
};

function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	return date.toLocaleDateString(undefined, {
		weekday: "short",
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function formatTime(timeStr: string): string {
	// timeStr is in HH:mm format
	const [hours, minutes] = timeStr.split(":").map(Number);
	const date = new Date();
	date.setHours(hours, minutes);
	return date.toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
}

export function EventInfo({ event, calendarName }: EventInfoProps) {
	return (
		<div className="ofc-event-info">
			<h2 className="ofc-event-info-title">{event.title}</h2>

			{calendarName && (
				<div className="ofc-event-info-row">
					<span className="ofc-event-info-label">Calendar:</span>
					<span className="ofc-event-info-value">{calendarName}</span>
				</div>
			)}

			{event.type === "single" && (
				<>
					<div className="ofc-event-info-row">
						<span className="ofc-event-info-label">Date:</span>
						<span className="ofc-event-info-value">
							{formatDate(event.date)}
						</span>
					</div>
					{event.endDate && (
						<div className="ofc-event-info-row">
							<span className="ofc-event-info-label">End Date:</span>
							<span className="ofc-event-info-value">
								{formatDate(event.endDate)}
							</span>
						</div>
					)}
				</>
			)}

			{event.type === "recurring" && (
				<>
					<div className="ofc-event-info-row">
						<span className="ofc-event-info-label">Repeats:</span>
						<span className="ofc-event-info-value">
							{event.daysOfWeek
								.map((d) => DAYS_OF_WEEK[d] || d)
								.join(", ")}
						</span>
					</div>
					{event.startRecur && (
						<div className="ofc-event-info-row">
							<span className="ofc-event-info-label">Starts:</span>
							<span className="ofc-event-info-value">
								{formatDate(event.startRecur)}
							</span>
						</div>
					)}
					{event.endRecur && (
						<div className="ofc-event-info-row">
							<span className="ofc-event-info-label">Until:</span>
							<span className="ofc-event-info-value">
								{formatDate(event.endRecur)}
							</span>
						</div>
					)}
				</>
			)}

			{event.type === "rrule" && (
				<div className="ofc-event-info-row">
					<span className="ofc-event-info-label">Start Date:</span>
					<span className="ofc-event-info-value">
						{formatDate(event.startDate)}
					</span>
				</div>
			)}

			{event.allDay ? (
				<div className="ofc-event-info-row">
					<span className="ofc-event-info-label">Time:</span>
					<span className="ofc-event-info-value">All day</span>
				</div>
			) : (
				<div className="ofc-event-info-row">
					<span className="ofc-event-info-label">Time:</span>
					<span className="ofc-event-info-value">
						{formatTime(event.startTime)}
						{event.endTime && ` - ${formatTime(event.endTime)}`}
					</span>
				</div>
			)}

			<div className="ofc-event-info-note">
				This is a read-only event from a remote calendar.
			</div>

			<style>{`
				.ofc-event-info {
					padding: 10px 0;
				}
				.ofc-event-info-title {
					margin: 0 0 16px 0;
					font-size: 1.4em;
					word-wrap: break-word;
					overflow-wrap: break-word;
				}
				.ofc-event-info-row {
					display: flex;
					margin-bottom: 8px;
					align-items: baseline;
				}
				.ofc-event-info-label {
					font-weight: 500;
					min-width: 100px;
					color: var(--text-muted);
				}
				.ofc-event-info-value {
					flex: 1;
				}
				.ofc-event-info-note {
					margin-top: 20px;
					padding: 10px;
					background: var(--background-secondary);
					border-radius: 4px;
					font-size: 0.9em;
					color: var(--text-muted);
				}
			`}</style>
		</div>
	);
}
