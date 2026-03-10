# Claude Code Reference: Obsidian Full Calendar Plugin

This file contains important information about the project structure and key files for development reference.

## Project Overview
This is an Obsidian plugin that displays calendar events from:
- Local folders (notes with frontmatter)
- Daily notes
- ICS calendar feeds
- CalDAV calendars

Events are stored as Markdown files with YAML frontmatter in specified folders.

## Key Architecture Components

### Core System
- **EventCache** (`src/core/EventCache.ts`) - Central event management system
  - Manages all calendar sources
  - Handles event CRUD operations
  - Maintains ghost events for preview
  - Notifies views of changes via callbacks

- **EventStore** (`src/core/EventStore.ts`) - Internal event storage
  - Maps events to calendars and locations
  - Handles event indexing and retrieval

### Calendar Types
- **EditableCalendar** (`src/calendars/EditableCalendar.ts`) - Base class for editable calendars
- **FullNoteCalendar** (`src/calendars/FullNoteCalendar.ts`) - Local folder-based events
  - Events stored as individual markdown files
  - `name` property returns full folder path
- **DailyNoteCalendar** (`src/calendars/DailyNoteCalendar.ts`) - Daily note integration
- **ICSCalendar** (`src/calendars/ICSCalendar.ts`) - Remote ICS feeds
- **CalDAVCalendar** (`src/calendars/CalDAVCalendar.ts`) - CalDAV integration

### UI Components

#### Event Management
- **EditEvent** (`src/ui/components/EditEvent.tsx`) - Main event editing form
  - Handles all event properties (title, date, time, recurring, etc.)
  - Supports keyboard shortcuts for calendar selection and actions
  - Creates ghost events for live preview
  - Time selectors with drag interface

- **event_modal.ts** (`src/ui/event_modal.ts`) - Modal launcher functions
  - `launchCreateModal()` - New event creation
  - `launchEditModal()` - Edit existing events
  - Handles ghost event callbacks and cleanup

#### Calendar Display
- **view.ts** (`src/ui/view.ts`) - Main calendar view integration
- **calendar.ts** (`src/ui/calendar.ts`) - Calendar rendering
- **ReactModal.ts** (`src/ui/ReactModal.ts`) - Modal wrapper for React components

### Plugin Entry Point
- **main.ts** (`src/main.ts`) - Main plugin class
  - Initializes EventCache with calendar type handlers
  - Manages file watching and updates
  - Exposes global cache reference

## Event Data Flow

1. **Event Creation/Edit**:
   - User opens modal via `launchCreateModal()` or `launchEditModal()`
   - `EditEvent` component renders form with current values
   - Form changes trigger ghost event updates
   - On submit: `EventCache.addEvent()` or `updateEventWithId()`
   - Calendar files are updated on disk
   - Views are notified of changes

2. **Event Loading**:
   - Plugin watches file system changes
   - `EventCache.fileUpdated()` called on changes
   - Calendar parses file content (e.g., `FullNoteCalendar.getEventsInFile()`)
   - Events stored in `EventStore`
   - Views updated via callbacks

3. **Calendar Display**:
   - Views call `EventCache.getAllEvents()`
   - Returns events grouped by calendar with metadata
   - Ghost events included if active
   - FullCalendar renders events

## Ghost Event System (Recent Addition)

### Purpose
Provides live preview of events while editing, showing how the final event will appear in the calendar.

### Implementation
- `EventCache.ghostEvent` - Stores temporary preview event
- `EditEvent` component creates ghost on form changes
- `getAllEvents()` includes ghost events with 👻 prefix
- Cleaned up on modal close/save/delete

### Key Methods
- `EventCache.setGhostEvent(event, calendarId)` - Create/update ghost
- `EventCache.clearGhostEvent()` - Remove ghost
- `EditEvent.onGhostEventChange` prop - Callback for ghost updates

## Important File Locations

### Configuration
- `src/types/schema.ts` - Event type definitions and validation
- `src/ui/settings.ts` - Plugin settings and configuration

### Event Parsing
- `src/calendars/parsing/` - Calendar format parsers
  - `ics.ts` - ICS file parsing
  - `caldav/` - CalDAV integration

### Utilities
- `src/ObsidianAdapter.ts` - Obsidian API wrapper
- `src/ui/interop.ts` - FullCalendar integration helpers
- `src/ui/actions.ts` - Common UI actions

## Keyboard Shortcuts (EditEvent)

### Event Actions
- `Cmd+Enter` / `Ctrl+Enter` - Save event
- `Ctrl+Backspace` - Delete event
- `Ctrl+-` - Decrease end time by 15 minutes
- `Ctrl++` - Increase end time by 15 minutes

### Calendar Selection
- `Ctrl+Q/W/E/R/T/Y/U/I/O/P/S/D/F/G/H/J/K/L` - Select calendars 1-18

## Development Notes

### Event Structure
Events use OFCEvent type with three main variants:
- `single` - One-time events with date/endDate
- `recurring` - Weekly recurring with daysOfWeek
- `rrule` - Complex recurring with RRULE string

### File Naming
FullNoteCalendar creates files with this naming pattern:
`{title} {date} {startTime}.md`

### Calendar Display Names
- Full paths shown in settings
- Only folder names shown in EditEvent selector
- Achieved by `cal.name.split('/').pop() || cal.name`

### Testing Commands
Available via Command Palette:
- "Revalidate remote calendars" - Force refresh external calendars

## Common Development Patterns

1. **Adding new event properties**:
   - Update `OFCEvent` type in `types/schema.ts`
   - Add form fields in `EditEvent.tsx`
   - Update ghost event creation logic
   - Modify calendar parsers as needed

2. **Adding new calendar types**:
   - Extend `EditableCalendar` or `Calendar` base class
   - Implement required abstract methods
   - Add initializer to `main.ts` calendar map
   - Add configuration in settings

3. **Debugging event issues**:
   - Check browser console for ghost event logs
   - Verify file contents match expected frontmatter
   - Use `window.cache` global reference in dev tools
   - Check EventCache callbacks and view updates