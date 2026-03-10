import { z, ZodError } from "zod";
import { DateTime, Duration } from "luxon";

const stripTime = (date: DateTime) => {
    // Strip time from luxon dateTime.
    return DateTime.fromObject(
        {
            year: date.year,
            month: date.month,
            day: date.day,
        },
        { zone: "utc" }
    );
};

export const ParsedDate = z.string();
// z.string().transform((val, ctx) => {
//     const parsed = DateTime.fromISO(val, { zone: "utc" });
//     if (parsed.invalidReason) {
//         ctx.addIssue({
//             code: z.ZodIssueCode.custom,
//             message: parsed.invalidReason,
//         });
//         return z.NEVER;
//     }
//     return stripTime(parsed);
// });

export const ParsedTime = z.string();
// z.string().transform((val, ctx) => {
//     let parsed = DateTime.fromFormat(val, "h:mm a");
//     if (parsed.invalidReason) {
//         parsed = DateTime.fromFormat(val, "HH:mm");
//     }

//     if (parsed.invalidReason) {
//         ctx.addIssue({
//             code: z.ZodIssueCode.custom,
//             message: parsed.invalidReason,
//         });
//         return z.NEVER;
//     }

//     return Duration.fromISOTime(
//         parsed.toISOTime({
//             includeOffset: false,
//             includePrefix: false,
//         })
//     );
// });

export const TimeSchema = z.discriminatedUnion("allDay", [
    z.object({ allDay: z.literal(true) }),
    z.object({
        allDay: z.literal(false),
        startTime: ParsedTime,
        endTime: ParsedTime.nullable().default(null),
    }),
]);

export const CommonSchema = z.object({
    title: z.string(),
    id: z.string().optional(),
});


// export const EventSchema = z.object({
//     type: z.literal("single"),
//     date: ParsedDate,
//     endDate: ParsedDate.nullable().default(null),
//     completed: ParsedDate.or(z.literal(false))
//         .or(z.literal(null))
//         .optional(),
// }).or(z.object({
//     type: z.literal("recurring"),
//     daysOfWeek: z.array(z.enum(["U", "M", "T", "W", "R", "F", "S"])),
//     startRecur: ParsedDate.optional(),
//     endRecur: ParsedDate.optional(),
// })).or(z.object({
//     type: z.literal("rrule"),
//     startDate: ParsedDate,
//     rrule: z.string(),
//     skipDates: z.array(ParsedDate).optional(),
// }))


export const EventSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("single"),
        date: ParsedDate,
        endDate: ParsedDate.nullable().default(null),
        completed: ParsedDate.or(z.literal(false))
            .or(z.literal(null))
            .optional(),
    }),
    z.object({
        type: z.literal("recurring"),
        daysOfWeek: z.array(z.enum(["U", "M", "T", "W", "R", "F", "S"])),
        startRecur: ParsedDate.optional(),
        endRecur: ParsedDate.optional(),
    }),
    z.object({
        type: z.literal("rrule"),
        startDate: ParsedDate,
        rrule: z.string(),
        skipDates: z.array(ParsedDate).optional(),
        // Original timezone for proper DST handling in recurring events
        originalTz: z.string().optional(),
        // Original wall-clock time (before timezone conversion) for DST-aware expansion
        originalStartTime: z.string().optional(),
    }),
]);

type EventType = z.infer<typeof EventSchema>;

// const event: EventType ={ type:'rrule',rrule:} 
type TimeType = z.infer<typeof TimeSchema>;
type CommonType = z.infer<typeof CommonSchema>;

export type OFCEvent = CommonType & TimeType & EventType;

export function parseEvent(obj: unknown): OFCEvent {
    if (typeof obj !== "object") {
        throw new Error("value for parsing was not an object.");
    }

    // If no time properties are specified, default to all-day
    const hasTimeProps = obj && typeof obj === "object" &&
        ("allDay" in obj || "startTime" in obj || "endTime" in obj);

    const objectWithDefaults = {
        type: "single",
        allDay: hasTimeProps ? false : true,
        ...obj
    };

    return {
        ...CommonSchema.parse(objectWithDefaults),
        ...TimeSchema.parse(objectWithDefaults),
        ...EventSchema.parse(objectWithDefaults),
    };
}

export function validateEvent(obj: unknown): OFCEvent | null {
    try {
        return parseEvent(obj);
    } catch (e) {
        console.log(e)
        console.debug("Parsing failed with errors", { obj, message: e, });
        return null;
    }
}
type Json =
    | { [key: string]: Json }
    | Json[]
    | string
    | number
    | true
    | false
    | null;

export function serializeEvent(obj: OFCEvent): Json {
    return { ...obj };
}
