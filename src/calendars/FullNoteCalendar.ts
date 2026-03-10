import { TFile, TFolder, parseYaml, stringifyYaml } from "obsidian";
import { rrulestr } from "rrule";
import { EventPathLocation } from "../core/EventStore";
import { ObsidianInterface } from "../ObsidianAdapter";
import { OFCEvent, EventLocation, validateEvent } from "../types";
import { EditableCalendar, EditableEventResponse } from "./EditableCalendar";
import { DateTime } from "luxon";

const basenameFromEvent = (event: OFCEvent): string => {
    const formattedTitle = event.title.replace('.', ',').replace('/', ",").replace("\\", ",")
    switch (event.type) {
        case undefined:
        case "single":
            return `${formattedTitle} ${event.date} ${event.allDay ? "allDay" : event.startTime.replace(':', ",")}`;
        case "recurring":
            return `${formattedTitle} (Every ${event.daysOfWeek.join(",")}) ${event.allDay ? "allDay" : event.startTime.replace(':', ",")}`;
        case "rrule":
            return `${formattedTitle} (${rrulestr(event.rrule).toText()}) ${event.startDate} ${event.allDay ? "allDay" : event.startTime.replace(':', ",")}`;
    }
};

const filenameForEvent = (event: OFCEvent) => `${basenameFromEvent(event)}.md`;

const FRONTMATTER_SEPARATOR = "---";

/**
 * @param page Contents of a markdown file.
 * @returns Whether or not this page has a frontmatter section.
 */
function hasFrontmatter(page: string): boolean {
    return (
        page.indexOf(FRONTMATTER_SEPARATOR) === 0 &&
        page.slice(3).indexOf(FRONTMATTER_SEPARATOR) !== -1
    );
}

/**
 * Return only frontmatter from a page.
 * @param page Contents of a markdown file.
 * @returns Frontmatter section of a page.
 */
function extractFrontmatter(page: string): string | null {
    if (hasFrontmatter(page)) {
        return page.split(FRONTMATTER_SEPARATOR)[1];
    }
    return null;
}

/**
 * Remove frontmatter from a page.
 * @param page Contents of markdown file.
 * @returns Contents of a page without frontmatter.
 */
function extractPageContents(page: string): string {
    if (hasFrontmatter(page)) {
        // Frontmatter lives between the first two --- linebreaks.
        return page.split("---").slice(2).join("---");
    } else {
        return page;
    }
}

function replaceFrontmatter(page: string, newFrontmatter: string): string {
    return `---\n${newFrontmatter}---${extractPageContents(page)}`;
}

type PrintableAtom = Array<number | string> | number | string | boolean;

function stringifyYamlAtom(v: PrintableAtom): string {
    let result = "";
    if (Array.isArray(v)) {
        result += "[";
        result += v.map(stringifyYamlAtom).join(",");
        result += "]";
    } else {
        result += `${v}`;
    }
    return result;
}

function stringifyYamlLine(
    k: string | number | symbol,
    v: PrintableAtom
): string {
    return `${String(k)}: ${stringifyYamlAtom(v)}`;
}

function newFrontmatter(fields: Partial<OFCEvent>): string {
    return (
        "---\n" +
        stringifyYaml(fields) +
        // Object.entries(fields)
        //     .filter(([_, v]) => v !== undefined)
        //     .map(([k, v]) => stringifyYamlLine(k, v))
        //     .join("\n") +
        "\n---\n"
    );
}

function modifyFrontmatterString(
    page: string,
    modifications: Partial<OFCEvent>
): string {
    const frontmatter = extractFrontmatter(page)?.split("\n");
    let newFrontmatter: string[] = [];

    let obj = stringifyYaml({ ...parseYaml(extractFrontmatter(page)!) ?? {}, ...modifications ?? {} })

    if (!frontmatter) {
        newFrontmatter = Object.entries(modifications)
            .filter(([k, v]) => v !== undefined)
            .map(([k, v]) => stringifyYamlLine(k, v));
        page = "\n" + page;
    } else {
        console.log("aaaa", parseYaml(extractFrontmatter(page)!))

        // const linesAdded: Set<string | number | symbol> = new Set();
        // // Modify rows in-place.
        // for (let i = 0; i < frontmatter.length; i++) {
        //     const line: string = frontmatter[i];
        //     const obj: Record<any, any> | null = parseYaml(line);
        //     if (!obj) {
        //         continue;
        //     }

        //     const keys = Object.keys(obj) as [keyof OFCEvent];
        //     if (keys.length !== 1) {
        //         throw new Error("One YAML line parsed to multiple keys.");
        //     }
        //     const key = keys[0];
        //     linesAdded.add(key);
        //     const newVal: PrintableAtom | undefined = modifications[key];
        //     if (newVal !== undefined) {
        //         newFrontmatter.push(stringifyYamlLine(key, newVal));
        //     } else {
        //         // Just push the old line if we don't have a modification.
        //         newFrontmatter.push(line);
        //     }
        // }

        // // Add all rows that were not originally in the frontmatter.
        // newFrontmatter.push(
        //     ...(Object.keys(modifications) as [keyof OFCEvent])
        //         .filter((k) => !linesAdded.has(k))
        //         .filter((k) => modifications[k] !== undefined)
        //         .map((k) =>
        //             stringifyYamlLine(k, modifications[k] as PrintableAtom)
        //         )
        // );
    }
    return replaceFrontmatter(page, obj + "\n");
}

export default class FullNoteCalendar extends EditableCalendar {
    app: ObsidianInterface;
    private _directory: string;

    constructor(app: ObsidianInterface, color: string, directory: string) {
        super(color);
        this.app = app;
        this._directory = directory;
    }
    get directory(): string {
        return this._directory;
    }

    get type(): "local" {
        return "local";
    }

    get identifier(): string {
        return this.directory;
    }

    get name(): string {
        return this.directory;
    }

    async getEventsInFile(file: TFile): Promise<EditableEventResponse[]> {
        const metadata = this.app.getMetadata(file);
        let event = validateEvent(metadata?.frontmatter);
        if (!event) {
            return [];
        }
        if (!event.title) {
            event.title = file.basename;
        }
        return [[event, { file, lineNumber: undefined }]];
    }

    private async getEventsInFolderRecursive(
        folder: TFolder
    ): Promise<EditableEventResponse[]> {
        const events = await Promise.all(
            folder.children.map(async (file) => {
                if (file instanceof TFile) {
                    return await this.getEventsInFile(file);
                } else if (file instanceof TFolder) {
                    return await this.getEventsInFolderRecursive(file);
                } else {
                    return [];
                }
            })
        );
        return events.flat();
    }

    async getEvents(dateRange?: { start: Date; end: Date }): Promise<EditableEventResponse[]> {
        const eventFolder = this.app.getAbstractFileByPath(this.directory);
        if (!eventFolder) {
            throw new Error(`Cannot get folder ${this.directory}`);
        }
        if (!(eventFolder instanceof TFolder)) {
            throw new Error(`${eventFolder} is not a directory.`);
        }
        
        // If no date range provided, fall back to full loading (for remote calendars, etc.)
        if (!dateRange) {
            return this.getAllEvents(eventFolder);
        }
        
        return this.getEventsInDateRange(eventFolder, dateRange);
    }

    private async getAllEvents(eventFolder: TFolder): Promise<EditableEventResponse[]> {
        const events: EditableEventResponse[] = [];
        for (const file of eventFolder.children) {
            if (file instanceof TFile) {
                const results = await this.getEventsInFile(file);
                events.push(...results);
            }
        }
        return events;
    }

    private async getEventsInDateRange(eventFolder: TFolder, dateRange: { start: Date; end: Date }): Promise<EditableEventResponse[]> {
        // Expand range by 1 month on each side
        const start = DateTime.fromJSDate(dateRange.start).minus({ months: 1 });
        const end = DateTime.fromJSDate(dateRange.end).plus({ months: 1 });
        
        const events: EditableEventResponse[] = [];
        const files = eventFolder.children.filter((file) => file instanceof TFile) as TFile[];
        
        // Process files in parallel batches for better performance
        const batchSize = 20;
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(async (file) => {
                    try {
                        const results = await this.getEventsInFile(file);
                        // Filter events by date range
                        return results.filter(([event]) => this.isEventInDateRange(event, start, end));
                    } catch (error) {
                        return [];
                    }
                })
            );
            events.push(...batchResults.flat());
        }
        
        return events;
    }

    private isEventInDateRange(event: OFCEvent, rangeStart: DateTime, rangeEnd: DateTime): boolean {
        try {
            switch (event.type) {
                case "single":
                    const eventDate = DateTime.fromISO(event.date);
                    if (event.endDate) {
                        const endDate = DateTime.fromISO(event.endDate);
                        return eventDate <= rangeEnd && endDate >= rangeStart;
                    }
                    return eventDate >= rangeStart && eventDate <= rangeEnd;
                    
                case "recurring":
                    // For recurring events, check if the recurrence period overlaps with our range
                    const startDate = event.startRecur ? DateTime.fromISO(event.startRecur) : rangeStart.minus({ years: 1 });
                    const endDate = event.endRecur ? DateTime.fromISO(event.endRecur) : rangeEnd.plus({ years: 1 });
                    return startDate <= rangeEnd && endDate >= rangeStart;
                    
                case "rrule":
                    // For rrule events, check the start date
                    const rruleStart = DateTime.fromISO(event.startDate);
                    const rruleEnd = rangeEnd.plus({ years: 1 });
                    return rruleStart <= rangeEnd && rruleEnd >= rangeStart;
                    
                default:
                    return false;
            }
        } catch (error) {
            return false;
        }
    }

    async createEvent(event: OFCEvent): Promise<EventLocation> {
        const path = `${this.directory}/${filenameForEvent(event)}`;
        if (this.app.getAbstractFileByPath(path)) {
            throw new Error(`Event at ${path} already exists.`);
        }
        const file = await this.app.create(path, newFrontmatter(event));
        return { file, lineNumber: undefined };
    }

    getNewLocation(
        location: EventPathLocation,
        event: OFCEvent
    ): EventLocation {
        const { path, lineNumber } = location;
        if (lineNumber !== undefined) {
            throw new Error("Note calendar cannot handle inline events.");
        }
        const file = this.app.getFileByPath(path);
        if (!file) {
            throw new Error(
                `File ${path} either doesn't exist or is a folder.`
            );
        }

        const updatedPath = `${file.parent.path}/${filenameForEvent(event)}`;
        return { file: { path: updatedPath }, lineNumber: undefined };
    }

    async modifyEvent(
        location: EventPathLocation,
        event: OFCEvent,
        updateCacheWithLocation: (loc: EventLocation) => void
    ): Promise<void> {
        const { path } = location;
        const file = this.app.getFileByPath(path);
        if (!file) {
            throw new Error(
                `File ${path} either doesn't exist or is a folder.`
            );
        }
        const newLocation = this.getNewLocation(location, event);

        updateCacheWithLocation(newLocation);

        if (file.path !== newLocation.file.path) {
            await this.app.rename(file, newLocation.file.path);
        }
        await this.app.rewrite(file, (page) =>
            modifyFrontmatterString(page, event)
        );

        return;
    }

    async move(
        fromLocation: EventPathLocation,
        toCalendar: EditableCalendar,
        updateCacheWithLocation: (loc: EventLocation) => void
    ): Promise<void> {
        const { path, lineNumber } = fromLocation;
        if (lineNumber !== undefined) {
            throw new Error("Note calendar cannot handle inline events.");
        }
        if (!(toCalendar instanceof FullNoteCalendar)) {
            throw new Error(
                `Event cannot be moved to a note calendar from a calendar of type ${toCalendar.type}.`
            );
        }
        const file = this.app.getFileByPath(path);
        if (!file) {
            throw new Error(`File ${path} not found.`);
        }
        const destDir = toCalendar.directory;
        const newPath = `${destDir}/${file.name}`;
        updateCacheWithLocation({
            file: { path: newPath },
            lineNumber: undefined,
        });
        await this.app.rename(file, newPath);
    }

    deleteEvent({ path, lineNumber }: EventPathLocation): Promise<void> {
        if (lineNumber !== undefined) {
            throw new Error("Note calendar cannot handle inline events.");
        }
        const file = this.app.getFileByPath(path);
        if (!file) {
            throw new Error(`File ${path} not found.`);
        }
        return this.app.delete(file);
    }
}
