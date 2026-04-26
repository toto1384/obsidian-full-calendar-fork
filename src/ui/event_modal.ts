import { Notice } from "obsidian";
import * as React from "react";
import { EditableCalendar } from "src/calendars/EditableCalendar";
import FullCalendarPlugin from "src/main";
import { OFCEvent } from "src/types";
import { openFileForEvent } from "./actions";
import { EditEvent } from "./components/EditEvent";
import { EventInfo } from "./components/EventInfo";
import ReactModal from "./ReactModal";

export function launchCreateModal(
    plugin: FullCalendarPlugin,
    partialEvent: Partial<OFCEvent>
) {
    const calendars = [...plugin.cache.calendars.entries()]
        .filter(([_, cal]) => cal instanceof EditableCalendar)
        .map(([id, cal]) => {
            return {
                id,
                type: cal.type,
                name: cal.name,
            };
        });

    const modal = new ReactModal(plugin.app, async (closeModal) =>
        React.createElement(EditEvent, {
            initialEvent: partialEvent,
            calendars,
            defaultCalendarIndex: 0,
            submit: async (data, calendarIndex) => {
                const calendarId = calendars[calendarIndex].id;
                try {
                    plugin.cache.clearGhostEvent(); // Clear ghost before saving
                    await plugin.cache.addEvent(calendarId, data);
                } catch (e) {
                    if (e instanceof Error) {
                        new Notice("Error when creating event: " + e.message);
                        console.error(e);
                    }
                }
                closeModal();
            },
            onGhostEventChange: (event, calendarId) => {
                console.log('Modal onGhostEventChange callback called:', { event: !!event, calendarId });
                plugin.cache.setGhostEvent(event, calendarId);
            },
        })
    );
    
    // Clear ghost event when modal is closed
    const originalOnClose = modal.onClose;
    modal.onClose = function() {
        plugin.cache.clearGhostEvent();
        originalOnClose.call(this);
    };
    
    modal.open();
}

export function launchEditModal(plugin: FullCalendarPlugin, eventId: string) {
    const eventToEdit = plugin.cache.getEventById(eventId);
    if (!eventToEdit) {
        throw new Error("Cannot edit event that doesn't exist.");
    }
    const calId = plugin.cache.getInfoForEditableEvent(eventId).calendar.id;

    const calendars = [...plugin.cache.calendars.entries()]
        .filter(([_, cal]) => cal instanceof EditableCalendar)
        .map(([id, cal]) => {
            return {
                id,
                type: cal.type,
                name: cal.name,
            };
        });

    const calIdx = calendars.findIndex(({ id }) => id === calId);

    const modal = new ReactModal(plugin.app, async (closeModal) =>
        React.createElement(EditEvent, {
            initialEvent: eventToEdit,
            calendars,
            defaultCalendarIndex: calIdx,
            submit: async (data, calendarIndex) => {
                try {
                    plugin.cache.clearGhostEvent(); // Clear ghost before saving
                    if (calendarIndex !== calIdx) {
                        await plugin.cache.moveEventToCalendar(
                            eventId,
                            calendars[calendarIndex].id
                        );
                    }
                    await plugin.cache.updateEventWithId(eventId, data);
                } catch (e) {
                    if (e instanceof Error) {
                        new Notice("Error when updating event: " + e.message);
                        console.error(e);
                    }
                }
                closeModal();
            },
            open: async () => {
                openFileForEvent(plugin.cache, plugin.app, eventId);
            },
            deleteEvent: async () => {
                try {
                    plugin.cache.clearGhostEvent(); // Clear ghost before deleting
                    await plugin.cache.deleteEvent(eventId);
                    closeModal();
                } catch (e) {
                    if (e instanceof Error) {
                        new Notice("Error when deleting event: " + e.message);
                        console.error(e);
                    }
                }
            },
            onGhostEventChange: (event, calendarId) => {
                console.log('Modal onGhostEventChange callback called:', { event: !!event, calendarId });
                plugin.cache.setGhostEvent(event, calendarId);
            },
        })
    );

    // Clear ghost event when modal is closed
    const originalOnClose = modal.onClose;
    modal.onClose = function() {
        plugin.cache.clearGhostEvent();
        originalOnClose.call(this);
    };

    modal.open();
}

export function launchEventInfoModal(plugin: FullCalendarPlugin, eventId: string) {
    const event = plugin.cache.getEventById(eventId);
    if (!event) {
        throw new Error("Event not found.");
    }

    // Get calendar name for display
    const calendarName = plugin.cache.getCalendarNameForEvent(eventId);

    const modal = new ReactModal(plugin.app, async () =>
        React.createElement(EventInfo, {
            event,
            calendarName,
        })
    );
    modal.open();
}
