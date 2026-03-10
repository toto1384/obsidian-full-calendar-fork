import { MarkdownView, TFile, Vault, Workspace } from "obsidian";
import moment from "moment";
import EventCache from "src/core/EventCache";
import {
    getAllDailyNotes,
    getDailyNote,
    createDailyNote,
    getDailyNoteSettings
} from "obsidian-daily-notes-interface";

/**
 * Open a file in the editor to a given event.
 * @param cache
 * @param param1 App
 * @param id event ID
 * @returns
 */
export async function openFileForEvent(
    cache: EventCache,
    { workspace, vault }: { workspace: Workspace; vault: Vault },
    id: string
) {
    const details = cache.getInfoForEditableEvent(id);
    if (!details) {
        throw new Error("Event does not have local representation.");
    }
    const {
        location: { path, lineNumber },
    } = details;
    let leaf = workspace.getMostRecentLeaf();
    const file = vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
        return;
    }
    if (!leaf) {
        return;
    }
    if (leaf.getViewState().pinned) {
        leaf = workspace.getLeaf("tab");
    }
    await leaf.openFile(file);
    if (lineNumber && leaf.view instanceof MarkdownView) {
        leaf.view.editor.setCursor({ line: lineNumber, ch: 0 });
    }
}

/**
 * Open or create a daily note for the given date
 * @param date The date to open the daily note for
 * @param workspace App workspace
 * @returns
 */
export async function openDailyNote(
    date: Date,
    { workspace }: { workspace: Workspace }
) {
    const m = moment(date);
    const allDailyNotes = getAllDailyNotes();
    let file = getDailyNote(m, allDailyNotes) as TFile;

    if (!file) {
        file = (await createDailyNote(m)) as TFile;
    }

    let leaf = workspace.getMostRecentLeaf();
    if (!leaf) {
        return;
    }
    if (leaf.getViewState().pinned) {
        leaf = workspace.getLeaf("tab");
    }
    await leaf.openFile(file);
}
