import { App, Modal, Notice, TFile } from "obsidian";
import * as React from "react";
import { EditableCalendar } from "src/calendars/EditableCalendar";
import FullCalendarPlugin from "src/main";
import { OFCEvent } from "src/types";
import { openFileForEvent } from "./actions";
import { EditEvent } from "./components/EditEvent";
import { EventInfo } from "./components/EventInfo";
import ReactModal from "./ReactModal";

type RecurringDeleteChoice = "this" | "all" | null;

// Google-Calendar-style chooser shown when deleting a recurring event.
class RecurringDeleteModal extends Modal {
    private occurrenceDate: string | null;
    private onChoose: (choice: RecurringDeleteChoice) => void;
    private chose = false;

    constructor(
        app: App,
        occurrenceDate: string | null,
        onChoose: (choice: RecurringDeleteChoice) => void
    ) {
        super(app);
        this.occurrenceDate = occurrenceDate;
        this.onChoose = onChoose;
    }

    onOpen() {
        this.titleEl.setText("Delete recurring event");
        this.contentEl.createEl("p", {
            text: this.occurrenceDate
                ? "Delete only this occurrence, or the entire event?"
                : "Delete the entire event?",
        });
        const row = this.contentEl.createDiv({ cls: "modal-button-container" });
        const pick = (label: string, choice: RecurringDeleteChoice, cls?: string) => {
            const b = row.createEl("button", { text: label });
            if (cls) b.addClass(cls);
            b.onclick = () => {
                this.chose = true;
                this.close();
                this.onChoose(choice);
            };
        };
        if (this.occurrenceDate) {
            pick("This occurrence", "this", "mod-cta");
        }
        pick("Entire event", "all", "mod-warning");
        const cancel = row.createEl("button", { text: "Cancel" });
        cancel.onclick = () => this.close();
    }

    onClose() {
        this.contentEl.empty();
        if (!this.chose) {
            this.onChoose(null);
        }
    }
}

/**
 * Delete an event. For a recurring/rrule event this opens a chooser to delete
 * just the clicked occurrence (adds a skip date) or the whole series; a single
 * event is deleted directly. `occurrenceDate` (YYYY-MM-DD) enables the
 * per-occurrence option and is omitted when the clicked day isn't known.
 */
export function deleteEventWithPrompt(
    plugin: FullCalendarPlugin,
    eventId: string,
    occurrenceDate: string | null,
    title: string,
    onDone?: () => void
) {
    const event = plugin.cache.getEventById(eventId);
    const isRecurring =
        event && (event.type === "recurring" || event.type === "rrule");

    if (!isRecurring) {
        plugin.cache
            .deleteEvent(eventId)
            .then(() => {
                new Notice(`Deleted event "${title}".`);
                onDone?.();
            })
            .catch((e) =>
                new Notice("Error when deleting event: " + e.message)
            );
        return;
    }

    new RecurringDeleteModal(plugin.app, occurrenceDate, async (choice) => {
        try {
            if (choice === "all") {
                await plugin.cache.deleteEventSeries(eventId);
                new Notice(`Deleted event "${title}".`);
                onDone?.();
            } else if (choice === "this" && occurrenceDate) {
                await plugin.cache.skipRecurringInstance(eventId, occurrenceDate);
                new Notice(`Deleted this occurrence (${occurrenceDate}).`);
                onDone?.();
            }
        } catch (e) {
            if (e instanceof Error) {
                new Notice("Error when deleting event: " + e.message);
                console.error(e);
            }
        }
    }).open();
}

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
                defaultCategory: cal.defaultCategory,
            };
        });

    const modal = new ReactModal(plugin.app, async (closeModal) =>
        React.createElement(EditEvent, {
            initialEvent: partialEvent,
            calendars,
            categories: plugin.settings.categories.map((c) => c.name),
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

export function launchEditModal(
    plugin: FullCalendarPlugin,
    eventId: string,
    occurrenceDate: string | null = null
) {
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
                defaultCategory: cal.defaultCategory,
            };
        });

    const calIdx = calendars.findIndex(({ id }) => id === calId);

    const modal = new ReactModal(plugin.app, async (closeModal) =>
        React.createElement(EditEvent, {
            initialEvent: eventToEdit,
            calendars,
            categories: plugin.settings.categories.map((c) => c.name),
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
                plugin.cache.clearGhostEvent(); // Clear ghost before deleting
                closeModal();
                // Recurring events open a chooser (this occurrence / whole
                // series); single events are deleted directly.
                deleteEventWithPrompt(
                    plugin,
                    eventId,
                    occurrenceDate,
                    eventToEdit.title
                );
            },
            onGhostEventChange: () => {
                // Ghost preview is only shown while creating a new event.
                // During editing it renders a 👻 duplicate on top of the real
                // event, so suppress it here.
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

    const calendarName = plugin.cache.getCalendarNameForEvent(eventId);
    const calendarId = plugin.cache.getCalendarIdForEvent(eventId);
    const categoryName = calendarId
        ? plugin.categoryFor(event, calendarId)
        : event.category;

    let onOpenSource: (() => void) | undefined;
    if (event.taskPath) {
        onOpenSource = async () => {
            const file = plugin.app.vault.getAbstractFileByPath(event.taskPath!);
            if (!(file instanceof TFile)) {
                new Notice(`Could not find note: ${event.taskPath}`);
                return;
            }
            const leaf = plugin.app.workspace.getLeaf(false);
            await leaf.openFile(file);
            if (event.taskLineNumber !== undefined) {
                const view = leaf.view as any;
                const editor = view?.editor;
                if (editor) {
                    const line = event.taskLineNumber;
                    editor.setCursor({ line, ch: 0 });
                    editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
                }
            }
            modal.close();
        };
    }

    const modal = new ReactModal(plugin.app, async () =>
        React.createElement(EventInfo, {
            event,
            calendarName,
            categoryName,
            onOpenSource,
        })
    );
    modal.open();
}
