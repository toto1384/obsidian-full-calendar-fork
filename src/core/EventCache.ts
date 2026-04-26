import { Notice, TFile } from "obsidian";
import equal from "deep-equal";

import { Calendar } from "../calendars/Calendar";
import { EditableCalendar } from "../calendars/EditableCalendar";
import EventStore, { StoredEvent } from "./EventStore";
import { CalendarInfo, OFCEvent, validateEvent } from "../types";
import RemoteCalendar from "../calendars/RemoteCalendar";
import FullNoteCalendar from "../calendars/FullNoteCalendar";

import { datetime, RRule, RRuleSet, rrulestr } from 'rrule'
import moment from "moment";

export type CalendarInitializerMap = Record<
    CalendarInfo["type"],
    (info: CalendarInfo) => Calendar | null
>;

export type CacheEntry = { event: OFCEvent; id: string; calendarId: string };

export type UpdateViewCallback = (
    info:
        | {
            type: "events";
            toRemove: string[];
            toAdd: CacheEntry[];
        }
        | { type: "calendar"; calendar: OFCEventSource }
        | { type: "resync" }
) => void;

const SECOND = 1000;
const MINUTE = 60 * SECOND;

const MILLICONDS_BETWEEN_REVALIDATIONS = 5 * MINUTE;

// TODO: Write tests for this function.
export const eventsAreDifferent = (
    oldEvents: OFCEvent[],
    newEvents: OFCEvent[]
): boolean => {
    oldEvents.sort((a, b) => a.title.localeCompare(b.title));
    newEvents.sort((a, b) => a.title.localeCompare(b.title));

    // validateEvent() will normalize the representation of default fields in events.
    oldEvents = oldEvents.flatMap((e) => validateEvent(e) || []);
    newEvents = newEvents.flatMap((e) => validateEvent(e) || []);

    console.debug("comparing events", oldEvents, newEvents);

    if (oldEvents.length !== newEvents.length) {
        return true;
    }

    const unmatchedEvents = oldEvents
        .map((e, i) => ({ oldEvent: e, newEvent: newEvents[i] }))
        .filter(({ oldEvent, newEvent }) => !equal(oldEvent, newEvent));

    if (unmatchedEvents.length > 0) {
        console.debug("unmached events when comparing", unmatchedEvents);
    }

    return unmatchedEvents.length > 0;
};

export type CachedEvent = Pick<StoredEvent, "event" | "id">;

export type OFCEventSource = {
    events: CachedEvent[];
    editable: boolean;
    color: string;
    id: string;
};

/**
 * Persistent event cache that also can write events back to disk.
 *
 * The EventCache acts as the bridge between the source-of-truth for
 * calendars (either the network or filesystem) and the FullCalendar view plugin.
 *
 * It maintains its own copy of all events which should be displayed on calendars
 * in the internal event format.
 *
 * Pluggable Calendar classes are responsible for parsing and serializing events
 * from their source, but the EventCache performs all I/O itself.
 *
 * Subscribers can register callbacks on the EventCache to be updated when events
 * change on disk.
 */
export default class EventCache {
    private calendarInfos: CalendarInfo[] = [];

    private calendarInitializers: CalendarInitializerMap;

    private store = new EventStore();
    calendars = new Map<string, Calendar>();

    private pkCounter = 0;

    private revalidating = false;
    
    // Ghost event for previewing edits
    private ghostEvent: { event: OFCEvent; calendarId: string; id: string } | null = null;
    // Track previous ghost event for efficient updates
    private previousGhostEvent: { event: OFCEvent; calendarId: string; id: string } | null = null;

    generateId(): string {
        return `${this.pkCounter++}`;
    }

    private updateViewCallbacks: UpdateViewCallback[] = [];

    initialized = false;

    lastRevalidation: number = 0;

    constructor(calendarInitializers: CalendarInitializerMap) {
        this.calendarInitializers = calendarInitializers;
    }

    /**
     * Flush the cache and initialize calendars from the initializer map.
     */
    reset(infos: CalendarInfo[]): void {
        this.lastRevalidation = 0;
        this.initialized = false;
        this.calendarInfos = infos;
        this.pkCounter = 0;
        this.calendars.clear();
        this.store.clear();
        this.resync();
        this.init();
    }

    init() {
        this.calendarInfos
            .flatMap((s) => {
                const cal = this.calendarInitializers[s.type](s);
                return cal || [];
            })
            .forEach((cal) => this.calendars.set(cal.id, cal));
    }

    /**
     * Populate the cache with events.
     * Optional dateRange parameter for performance optimization.
     */
    async populate(dateRange?: { start: Date; end: Date }): Promise<void> {
        if (!this.initialized || this.calendars.size === 0) {
            this.init();
        }
        
        // Process calendars in parallel for better performance
        const calendarPromises = Array.from(this.calendars.values()).map(async (calendar) => {
            try {
                const results = await calendar.getEvents(dateRange);
                results.forEach(([event, location]) =>
                    this.store.add({
                        calendar,
                        location,
                        id: event.id || this.generateId(),
                        event,
                    })
                );
            } catch (error) {
                console.warn(`Failed to load events from calendar ${calendar.id}:`, error);
            }
        });
        
        await Promise.allSettled(calendarPromises);
        this.initialized = true;
        this.revalidateRemoteCalendars();
    }

    resync(): void {
        for (const callback of this.updateViewCallbacks) {
            callback({ type: "resync" });
        }
    }

    /**
     * Reload all events by clearing the cache and repopulating from all sources.
     */
    async reloadAll(): Promise<void> {
        console.log("Reloading all events...");

        // Clear the store completely
        this.store.clear();

        // Repopulate local calendars only (non-remote)
        for (const calendar of this.calendars.values()) {
            // Skip remote calendars - they will be handled by revalidateRemoteCalendars
            if (calendar instanceof RemoteCalendar) {
                continue;
            }
            const results = await calendar.getEvents();
            results.forEach(([event, location]) =>
                this.store.add({
                    calendar,
                    location,
                    id: event.id || this.generateId(),
                    event,
                })
            );
        }

        // Notify views of the complete refresh for local calendars
        this.resync();

        // Force revalidation of remote calendars (will update view via updateCalendar callback)
        this.revalidateRemoteCalendars(true);

        console.log("All events reloaded successfully");
    }

    /**
     * Get all events from the cache in a FullCalendar-friendly format.
     * Optional dateRange parameter for performance optimization.
     * @returns EventSourceInputs for FullCalendar.
     */
    getAllEvents(dateRange?: { start: Date; end: Date }): OFCEventSource[] {
        const result: OFCEventSource[] = [];
        const eventsByCalendar = this.store.eventsByCalendar;
        for (const [calId, calendar] of this.calendars.entries()) {
            const events = eventsByCalendar.get(calId) || [];
            const eventsList = events.map(({ event, id }) => ({ event, id })); // make sure not to leak location data past the cache.
            
            result.push({
                editable: calendar instanceof EditableCalendar,
                events: eventsList,
                color: calendar.color,
                id: calId,
            });
        }
        
        return result;
    }

    /**
     * Set a ghost event for preview purposes
     */
    setGhostEvent(event: OFCEvent | null, calendarId: string): void {
        // Store previous ghost event for efficient removal
        this.previousGhostEvent = this.ghostEvent;
        
        // Prepare arrays for efficient update
        const toRemove: string[] = [];
        const toAdd: CacheEntry[] = [];
        
        // Remove previous ghost event if it exists
        if (this.previousGhostEvent) {
            toRemove.push(this.previousGhostEvent.id);
        }
        
        if (event && calendarId) {
            const id = `ghost-${Date.now()}`;
            this.ghostEvent = { event, calendarId, id };
            
            // Add new ghost event with 👻 prefix
            const ghostEventWithPrefix = { ...event, title: `👻 ${event.title}` };
            toAdd.push({ event: ghostEventWithPrefix, id, calendarId });
        } else {
            this.ghostEvent = null;
        }
        
        // Use efficient events update instead of resync
        if (toRemove.length > 0 || toAdd.length > 0) {
            this.updateViews(toRemove, toAdd);
        }
    }

    /**
     * Clear the ghost event
     */
    clearGhostEvent(): void {
        if (this.ghostEvent) {
            // Use efficient removal instead of full resync
            this.updateViews([this.ghostEvent.id], []);
            this.ghostEvent = null;
            this.previousGhostEvent = null;
        }
    }

    /**
     * Check if an event is part of an editable calendar.
     * @param id ID of event to check
     * @returns
     */
    isEventEditable(id: string): boolean {
        const calId = this.store.getEventDetails(id)?.calendarId;
        if (!calId) {
            return false;
        }
        const cal = this.getCalendarById(calId);
        return cal instanceof EditableCalendar;
    }

    getEventById(s: string): OFCEvent | null {
        return this.store.getEventById(s);
    }

    getCalendarById(c: string): Calendar | undefined {
        return this.calendars.get(c);
    }

    /**
     * Get calendar and location information for a given event in an editable calendar.
     * Throws an error if event is not found or if it does not have a location in the Vault.
     * @param eventId ID of event in question.
     * @returns Calendar and location for an event.
     */
    getInfoForEditableEvent(eventId: string) {
        const details = this.store.getEventDetails(eventId);
        if (!details) {
            throw new Error(`Event ID ${eventId} not present in event store.`);
        }
        const { calendarId, location } = details;
        const calendar = this.calendars.get(calendarId);
        if (!calendar) {
            throw new Error(`Calendar ID ${calendarId} is not registered.`);
        }
        if (!(calendar instanceof EditableCalendar)) {
            // console.warn("Cannot modify event of type " + calendar.type);
            throw new Error(`Read-only events cannot be modified.`);
        }
        if (!location) {
            throw new Error(
                `Event with ID ${eventId} does not have a location in the Vault.`
            );
        }
        return { calendar, location };
    }

    /**
     * Get calendar name for a given event (works for any event, including read-only).
     * @param eventId ID of event in question.
     * @returns Calendar name or undefined if not found.
     */
    getCalendarNameForEvent(eventId: string): string | undefined {
        const details = this.store.getEventDetails(eventId);
        if (!details) {
            return undefined;
        }
        const calendar = this.calendars.get(details.calendarId);
        return calendar?.name;
    }

    ///
    // View Callback functions
    ///

    /**
     * Register a callback for a view.
     * @param eventType event type (currently just "update")
     * @param callback
     * @returns reference to callback for de-registration.
     */
    on(eventType: "update", callback: UpdateViewCallback) {
        switch (eventType) {
            case "update":
                this.updateViewCallbacks.push(callback);
                break;
        }
        return callback;
    }

    /**
     * De-register a callback for a view.
     * @param eventType event type
     * @param callback callback to remove
     */
    off(eventType: "update", callback: UpdateViewCallback) {
        switch (eventType) {
            case "update":
                this.updateViewCallbacks.remove(callback);
                break;
        }
    }

    /**
     * Push updates to all subscribers.
     * @param toRemove IDs of events to remove from the view.
     * @param toAdd Events to add to the view.
     */
    private updateViews(toRemove: string[], toAdd: CacheEntry[]) {
        const payload = {
            toRemove,
            toAdd,
        };

        for (const callback of this.updateViewCallbacks) {
            callback({ type: "events", ...payload });
        }
    }

    private updateCalendar(calendar: OFCEventSource) {
        for (const callback of this.updateViewCallbacks) {
            callback({ type: "calendar", calendar });
        }
    }

    ///
    // Functions to update the cache from the view layer.
    ///

    /**
     * Add an event to a given calendar.
     * @param calendarId ID of calendar to add event to.
     * @param event Event details
     * @returns Returns true if successful, false otherwise.
     */
    async addEvent(calendarId: string, event: OFCEvent): Promise<boolean> {
        const calendar = this.calendars.get(calendarId);
        if (!calendar) {
            throw new Error(`Calendar ID ${calendarId} is not registered.`);
        }
        if (!(calendar instanceof EditableCalendar)) {
            console.error(
                `Event cannot be added to non-editable calendar of type ${calendar.type}`
            );
            throw new Error(`Cannot add event to a read-only calendar`);
        }
        const location = await calendar.createEvent(event);
        const id = this.store.add({
            calendar,
            location,
            id: event.id || this.generateId(),
            event,
        });

        this.updateViews([], [{ event, id, calendarId: calendar.id }]);
        return true;
    }

    /**
     * Delete an event by its ID.
     * @param eventId ID of event to be deleted.
     */
    async deleteEvent(eventId: string): Promise<void> {
        const { calendar, location } = this.getInfoForEditableEvent(eventId);
        const event = this.getEventById(eventId)
        // cannot delete events if they are recurring, have to go to note and delete that
        if (event?.type === 'single') {
            this.store.delete(eventId);
            await calendar.deleteEvent(location);
            this.updateViews([eventId], []);
        }
    }

    /**
     * Update an event with a given ID.
     * @param eventId ID of event to update.
     * @param newEvent new event contents
     * @returns true if update was successful, false otherwise.
     */
    async updateEventWithId(
        eventId: string,
        newEvent: OFCEvent
    ): Promise<boolean> {
        const { calendar, location: oldLocation } =
            this.getInfoForEditableEvent(eventId);
        const { path, lineNumber } = oldLocation;
        console.debug("updating event with ID", eventId);

        let oldEvent: OFCEvent | undefined | null;

        await calendar.modifyEvent({ path, lineNumber }, newEvent, (newLocation) => {
            oldEvent = this.store.delete(eventId);

            // if(newEvent as OFCEvent).date !=oldEvent) - modify if updated
            this.store.add({
                calendar,
                location: newLocation,
                id: eventId,
                event: newEvent,
            });
        }
        );

        let newE: { newId: string, newEvent: OFCEvent } | undefined;

        if (newEvent.type === 'single') {

            let startTimeVal = 10;
            if (!newEvent.allDay) {
                const num = Number(newEvent.startTime.split(':')[0])
                if (!isNaN(num)) startTimeVal = num
            }

            const newSkipDate = startTimeVal < 5 ? moment(newEvent.date).subtract(1, "day").format('YYYY-MM-DD') : newEvent.date

            if (oldEvent && oldEvent.type === 'recurring') {
                const rrDaysOfWeek = oldEvent?.daysOfWeek.map((i: string) => {
                    switch (i) {
                        case 'U': return RRule.SU
                        case 'M': return RRule.MO
                        case 'T': return RRule.TU
                        case 'W': return RRule.WE
                        case 'R': return RRule.TH
                        case 'F': return RRule.FR
                        case 'S': return RRule.SA
                    }
                })
                const rule = new RRule({
                    freq: RRule.WEEKLY,
                    interval: 1,
                    byweekday: rrDaysOfWeek as any,
                    dtstart: new Date(oldEvent.startRecur!),
                    until: oldEvent.endRecur ? new Date(oldEvent.endRecur!) : undefined
                })


                const newRecurringEvent = {
                    ...oldEvent,
                    type: 'rrule',
                    rrule: rule.toString(),
                    startDate: oldEvent.startRecur,
                    skipDates: [newSkipDate]
                } as any

                console.log("🚀 ~ EventCache ~ newRecurringEvent:", newRecurringEvent)

                const newRecurringLocation = await calendar.createEvent(newRecurringEvent)

                const newId = this.generateId()
                this.store.add({
                    calendar,
                    location: newRecurringLocation,
                    id: newId,
                    event: newRecurringEvent
                })
                newE = { newId, newEvent: newRecurringEvent };
                // this.updateViews([], [{ id: newId, calendarId: calendar.id, event: newRecurringEvent },]);

            } else if (oldEvent && oldEvent.type === 'rrule') {

                const newRecurringEvent = {
                    ...oldEvent,
                    skipDates: [...(oldEvent.skipDates ?? []), newSkipDate]
                } as any


                const newRecurringLocation = await calendar.createEvent(newRecurringEvent)

                const newId = this.generateId()
                this.store.add({
                    calendar,
                    location: newRecurringLocation,
                    id: newId,
                    event: newRecurringEvent
                })

                newE = { newId, newEvent: newRecurringEvent };

                // this.updateViews([], [{ id: newId, calendarId: calendar.id, event: newRecurringEvent },]);
            }

        }


        this.updateViews(
            [eventId],
            [{ id: eventId, calendarId: calendar.id, event: newEvent }, ...(newE ? [{ id: newE.newId, calendarId: calendar.id, event: newE.newEvent }] : [])]
        );
        return true;
    }

    /**
     * Transform an event that's already in the event store.
     *
     * A more "type-safe" wrapper around updateEventWithId(),
     * use this function if the caller is only modifying few
     * known properties of an event.
     * @param id ID of event to transform.
     * @param process function to transform the event.
     * @returns true if the update was successful.
     */
    processEvent(
        id: string,
        process: (e: OFCEvent) => OFCEvent
    ): Promise<boolean> {
        const event = this.store.getEventById(id);
        if (!event) {
            throw new Error("Event does not exist");
        }
        const newEvent = process(event);
        console.debug("process", newEvent, process);
        return this.updateEventWithId(id, newEvent);
    }

    async moveEventToCalendar(
        eventId: string,
        newCalendarId: string
    ): Promise<void> {
        const event = this.store.getEventById(eventId);
        const details = this.store.getEventDetails(eventId);
        if (!details || !event) {
            throw new Error(
                `Tried moving unknown event ID ${eventId} to calendar ${newCalendarId}`
            );
        }
        const { calendarId: oldCalendarId, location } = details;

        const oldCalendar = this.calendars.get(oldCalendarId);
        if (!oldCalendar) {
            throw new Error(`Source calendar ${oldCalendarId} did not exist.`);
        }
        const newCalendar = this.calendars.get(newCalendarId);
        if (!newCalendar) {
            throw new Error(`Source calendar ${newCalendarId} does not exist.`);
        }

        // TODO: Support moving around events between all sorts of editable calendars.
        if (
            !(
                oldCalendar instanceof FullNoteCalendar &&
                newCalendar instanceof FullNoteCalendar &&
                location
            )
        ) {
            throw new Error(
                `Both calendars must be Full Note Calendars to move events between them.`
            );
        }

        await oldCalendar.move(location, newCalendar, (newLocation) => {
            this.store.delete(eventId);
            this.store.add({
                calendar: newCalendar,
                location: newLocation,
                id: eventId,
                event,
            });
        });
    }

    ///
    // Filesystem hooks
    ///

    /**
     * Delete all events located at a given path and notify subscribers.
     * @param path path of file that has been deleted
     */
    deleteEventsAtPath(path: string) {
        this.updateViews([...this.store.deleteEventsAtPath(path)], []);
    }

    /**
     * Main hook into the filesystem.
     * This callback should be called whenever a file has been updated or created.
     * @param file File which has been updated
     * @returns nothing
     */
    async fileUpdated(file: TFile): Promise<void> {
        console.debug("fileUpdated() called for file", file.path);

        // Get all calendars that contain events stored in this file.
        const calendars = [...this.calendars.values()].flatMap((c) =>
            c instanceof EditableCalendar && c.containsPath(file.path) ? c : []
        );

        // If no calendars exist, return early.
        if (calendars.length === 0) {
            return;
        }

        const idsToRemove: string[] = [];
        const eventsToAdd: CacheEntry[] = [];

        for (const calendar of calendars) {
            const oldEvents = this.store.getEventsInFileAndCalendar(
                file,
                calendar
            );
            // TODO: Relying on calendars for file I/O means that we're potentially
            // reading the file from disk multiple times. Could be more effecient if
            // we break the abstraction layer here.
            console.debug("get events in file", file.path);
            const newEvents = await calendar.getEventsInFile(file);

            const oldEventsMapped = oldEvents.map(({ event }) => event);
            const newEventsMapped = newEvents.map(([event, _]) => event);
            console.debug("comparing events", file.path, oldEvents, newEvents);
            // TODO: It's possible events are not different, but the location has changed.
            const eventsHaveChanged = eventsAreDifferent(
                oldEventsMapped,
                newEventsMapped
            );

            // If no events have changed from what's in the cache, then there's no need to update the event store.
            if (!eventsHaveChanged) {
                console.debug(
                    "events have not changed, do not update store or view."
                );
                return;
            }
            console.debug(
                "events have changed, updating store and views...",
                oldEvents,
                newEvents
            );

            const newEventsWithIds = newEvents.map(([event, location]) => ({
                event,
                id: event.id || this.generateId(),
                location,
                calendarId: calendar.id,
            }));

            // If events have changed in the calendar, then remove all the old events from the store and add in new ones.
            const oldIds = oldEvents.map((r: StoredEvent) => r.id);
            oldIds.forEach((id: string) => {
                this.store.delete(id);
            });
            newEventsWithIds.forEach(({ event, id, location }) => {
                this.store.add({
                    calendar,
                    location,
                    id,
                    event,
                });
            });

            idsToRemove.push(...oldIds);
            eventsToAdd.push(...newEventsWithIds);
        }

        this.updateViews(idsToRemove, eventsToAdd);
    }

    /**
     * Revalidate calendars asynchronously. This is not a blocking function: as soon as new data
     * is available for any remote calendar, its data will be updated in the cache and any subscribing views.
     */
    revalidateRemoteCalendars(force = false) {
        console.log('start revalidation')
        const prom: Promise<any[]> = new Promise((resolve, reject) => {

            if (this.revalidating) {
                console.warn("Revalidation already in progress.");
                return;
            }
            const now = Date.now();

            if (
                !force &&
                now - this.lastRevalidation < MILLICONDS_BETWEEN_REVALIDATIONS
            ) {
                console.debug("Last revalidation was too soon.");
                return;
            }

            const remoteCalendars = [...this.calendars.values()].flatMap((c) =>
                c instanceof RemoteCalendar ? c : []
            );

            console.warn("Revalidating remote calendars...");
            this.revalidating = true;
            const promises = remoteCalendars.map((calendar) => {
                return calendar
                    .revalidate()
                    .then(() => calendar.getEvents())
                    .then((events) => {
                        console.log('ss2')
                        const deletedEvents = [
                            ...this.store.deleteEventsInCalendar(calendar),
                        ];
                        const newEvents = events.map(([event, location]) => ({
                            event,
                            id: event.id || this.generateId(),
                            location,
                            calendarId: calendar.id,
                        }));
                        newEvents.forEach(({ event, id, location }) => {
                            this.store.add({
                                calendar,
                                location,
                                id,
                                event,
                            });
                        });
                        console.log('ss3')
                        this.updateCalendar({
                            id: calendar.id,
                            editable: false,
                            color: calendar.color,
                            events: newEvents,
                        });
                        console.log('ss4')
                    });
            });
            Promise.allSettled(promises).then((results) => {
                this.revalidating = false;
                this.lastRevalidation = Date.now();
                console.debug("All remote calendars have been fetched.");
                const errors = results.flatMap((result) =>
                    result.status === "rejected" ? result.reason : []
                );

                resolve(errors)
            });

        })
        console.log('end revalidation')
        prom.then(errors => {
            if (errors.length > 0) {
                new Notice(
                    "A remote calendar failed to load. Check the console for more details."
                );
                errors.forEach((reason) => {
                    console.error(`Revalidation failed with reason: ${reason}`);
                });
            }
        })
    }

    get _storeForTest() {
        return this.store;
    }
}
