import FullCalendarPlugin from "../main";
import {
    App,
    DropdownComponent,
    Notice,
    PluginSettingTab,
    Setting,
    TFile,
    TFolder,
} from "obsidian";
import { makeDefaultPartialCalendarSource, CalendarInfo } from "../types";
import { ColorMode } from "./interop";
import { CalendarSettings } from "./components/CalendarSetting";
import { AddCalendarSource } from "./components/AddCalendarSource";
import * as ReactDOM from "react-dom";
import { createElement } from "react";
import { getDailyNoteSettings } from "obsidian-daily-notes-interface";
import ReactModal from "./ReactModal";
import { importCalendars } from "src/calendars/parsing/caldav/import";

export interface Category {
    name: string;
    color: string;
}

export interface FullCalendarSettings {
    calendarSources: CalendarInfo[];
    categories: Category[];
    colorMode: ColorMode;
    defaultCalendar: number;
    firstDay: number;
    initialView: {
        desktop: string;
        mobile: string;
    };
    timeFormat24h: boolean;
    clickToCreateEventFromMonthView: boolean;
    showTasksCalendar: boolean;
    tasksCalendarColor: string;

    zoom: number;
}

export const DEFAULT_SETTINGS: FullCalendarSettings = {
    calendarSources: [],
    categories: [],
    colorMode: "calendar",
    defaultCalendar: 0,
    firstDay: 0,
    initialView: {
        desktop: "timeGridWeek",
        mobile: "timeGrid3Days",
    },
    timeFormat24h: false,
    zoom: 12,
    clickToCreateEventFromMonthView: true,
    showTasksCalendar: false,
    tasksCalendarColor: "#7c3aed",
};

const WEEKDAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

const INITIAL_VIEW_OPTIONS = {
    DESKTOP: {
        timeGridDay: "Day",
        timeGridWeek: "Week",
        dayGridMonth: "Month",
        listWeek: "List",
    },
    MOBILE: {
        timeGrid3Days: "3 Days",
        timeGridDay: "Day",
        listWeek: "List",
    },
};

export function addCalendarButton(
    app: App,
    plugin: FullCalendarPlugin,
    containerEl: HTMLElement,
    submitCallback: (setting: CalendarInfo) => void,
    listUsedDirectories?: () => string[]
) {
    let dropdown: DropdownComponent;
    const directories = app.vault
        .getAllLoadedFiles()
        .filter((f) => f instanceof TFolder)
        .map((f) => f.path);

    return new Setting(containerEl)
        .setName("Calendars")
        .setDesc("Add calendar")
        .addDropdown(
            (d) =>
            (dropdown = d.addOptions({
                local: "Full note",
                dailynote: "Daily Note",
                icloud: "iCloud",
                caldav: "CalDAV",
                ical: "Remote (.ics format)",
            }))
        )
        .addExtraButton((button) => {
            button.setTooltip("Add Calendar");
            button.setIcon("plus-with-circle");
            button.onClick(() => {
                let modal = new ReactModal(app, async () => {
                    await plugin.loadSettings();
                    const usedDirectories = (
                        listUsedDirectories
                            ? listUsedDirectories
                            : () =>
                                plugin.settings.calendarSources
                                    .map(
                                        (s) =>
                                            s.type === "local" && s.directory
                                    )
                                    .filter((s): s is string => !!s)
                    )();
                    let headings: string[] = [];
                    let { template } = getDailyNoteSettings();

                    if (template) {
                        if (!template.endsWith(".md")) {
                            template += ".md";
                        }
                        const file = app.vault.getAbstractFileByPath(template);
                        if (file instanceof TFile) {
                            headings =
                                app.metadataCache
                                    .getFileCache(file)
                                    ?.headings?.map((h) => h.heading) || [];
                        }
                    }

                    return createElement(AddCalendarSource, {
                        source: makeDefaultPartialCalendarSource(
                            dropdown.getValue() as CalendarInfo["type"]
                        ),
                        directories: directories.filter(
                            (dir) => usedDirectories.indexOf(dir) === -1
                        ),
                        headings,
                        submit: async (source: CalendarInfo) => {
                            if (source.type === "caldav") {
                                try {
                                    let sources = await importCalendars(
                                        {
                                            type: "basic",
                                            username: source.username,
                                            password: source.password,
                                        },
                                        source.url
                                    );
                                    sources.forEach((source) =>
                                        submitCallback(source)
                                    );
                                } catch (e) {
                                    if (e instanceof Error) {
                                        new Notice(e.message);
                                    }
                                }
                            } else {
                                submitCallback(source);
                            }
                            modal.close();
                        },
                    });
                });
                modal.open();
            });
        });
}

export class FullCalendarSettingTab extends PluginSettingTab {
    plugin: FullCalendarPlugin;

    constructor(app: App, plugin: FullCalendarPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async display(): Promise<void> {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl).setName("Calendar preferences").setHeading();
        new Setting(containerEl)
            .setName("Desktop Initial View")
            .setDesc("Choose the initial view range on desktop devices.")
            .addDropdown((dropdown) => {
                Object.entries(INITIAL_VIEW_OPTIONS.DESKTOP).forEach(
                    ([value, display]) => {
                        dropdown.addOption(value, display);
                    }
                );
                dropdown.setValue(this.plugin.settings.initialView.desktop);
                dropdown.onChange(async (initialView) => {
                    this.plugin.settings.initialView.desktop = initialView;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Mobile Initial View")
            .setDesc("Choose the initial view range on mobile devices.")
            .addDropdown((dropdown) => {
                Object.entries(INITIAL_VIEW_OPTIONS.MOBILE).forEach(
                    ([value, display]) => {
                        dropdown.addOption(value, display);
                    }
                );
                dropdown.setValue(this.plugin.settings.initialView.mobile);
                dropdown.onChange(async (initialView) => {
                    this.plugin.settings.initialView.mobile = initialView;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Starting Day of the Week")
            .setDesc("Choose what day of the week to start.")
            .addDropdown((dropdown) => {
                WEEKDAYS.forEach((day, code) => {
                    dropdown.addOption(code.toString(), day);
                });
                dropdown.setValue(this.plugin.settings.firstDay.toString());
                dropdown.onChange(async (codeAsString) => {
                    this.plugin.settings.firstDay = Number(codeAsString);
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("24-hour format")
            .setDesc("Display the time in a 24-hour format.")
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.timeFormat24h);
                toggle.onChange(async (val) => {
                    this.plugin.settings.timeFormat24h = val;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Click on a day in month view to create event")
            .setDesc("Switch off to open day view on click instead.")
            .addToggle((toggle) => {
                toggle.setValue(
                    this.plugin.settings.clickToCreateEventFromMonthView
                );
                toggle.onChange(async (val) => {
                    this.plugin.settings.clickToCreateEventFromMonthView = val;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl).setName("Task integration").setHeading();

        const tasksPlugin = (this.app as any).plugins?.plugins?.[
            "obsidian-tasks-plugin"
        ];
        const tasksInstalled = !!tasksPlugin;

        new Setting(containerEl)
            .setName("Show tasks on calendar")
            .setDesc(
                tasksInstalled
                    ? "Display tasks with due dates as all-day events. ⚠️ Requires a forked version of the Tasks plugin that implements the internal API — the standard community version will not work."
                    : "⚠️ Requires obsidian-tasks plugin to be installed. Note: a forked version of the Tasks plugin is required — the standard community version will not work."
            )
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.showTasksCalendar);
                toggle.setDisabled(!tasksInstalled);
                toggle.onChange(async (val) => {
                    this.plugin.settings.showTasksCalendar = val;
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        if (this.plugin.settings.showTasksCalendar && tasksInstalled) {
            new Setting(containerEl)
                .setName("Tasks calendar color")
                .addColorPicker((picker) => {
                    picker.setValue(this.plugin.settings.tasksCalendarColor);
                    picker.onChange(async (val) => {
                        this.plugin.settings.tasksCalendarColor = val;
                        await this.plugin.saveSettings();
                    });
                });
        }

        this.displayCategories(containerEl);

        new Setting(containerEl).setName("Manage calendars").setHeading();
        addCalendarButton(
            this.app,
            this.plugin,
            containerEl,
            async (source: CalendarInfo) => {
                sourceList.addSource(source);
            },
            () =>
                sourceList.state.sources
                    .map((s) => s.type === "local" && s.directory)
                    .filter((s): s is string => !!s)
        );

        const sourcesDiv = containerEl.createDiv();
        let sourceList = ReactDOM.render(
            createElement(CalendarSettings, {
                sources: this.plugin.settings.calendarSources,
                categories: this.plugin.settings.categories.map((c) => c.name),
                submit: async (settings: CalendarInfo[]) => {
                    this.plugin.settings.calendarSources = settings;
                    await this.plugin.saveSettings();
                },
            }),
            sourcesDiv
        );
    }

    displayCategories(containerEl: HTMLElement) {
        new Setting(containerEl).setName("Categories").setHeading();
        containerEl.createEl("p", {
            cls: "setting-item-description",
            text: "Each calendar can have a default category, and each event can override it. The toolbar button switches event colors between calendars and categories. In category view, per-event colors are ignored.",
        });

        const plugin = this.plugin;
        plugin.settings.categories.forEach((category) => {
            new Setting(containerEl)
                .addText((text) => {
                    text.setValue(category.name);
                    text.inputEl.addEventListener("blur", async () => {
                        const newName = text.getValue().trim();
                        if (newName === category.name) {
                            return;
                        }
                        if (
                            !newName ||
                            plugin.settings.categories.some(
                                (c) => c.name === newName
                            )
                        ) {
                            new Notice("Category names must be unique and not empty.");
                            text.setValue(category.name);
                            return;
                        }
                        const changed = await plugin.renameCategory(
                            category.name,
                            newName
                        );
                        new Notice(
                            `Renamed category. Updated ${changed} event note(s).`
                        );
                        this.display();
                    });
                })
                .addColorPicker((picker) => {
                    picker.setValue(category.color);
                    picker.onChange(async (color) => {
                        category.color = color;
                        await plugin.saveCategories();
                    });
                })
                .addExtraButton((button) => {
                    button.setIcon("trash");
                    button.setTooltip("Delete category");
                    button.onClick(async () => {
                        plugin.settings.categories =
                            plugin.settings.categories.filter(
                                (c) => c !== category
                            );
                        plugin.settings.calendarSources.forEach((s) => {
                            if (s.defaultCategory === category.name) {
                                delete s.defaultCategory;
                            }
                        });
                        await plugin.saveSettings();
                        this.display();
                    });
                });
        });

        new Setting(containerEl).addButton((button) => {
            button.setButtonText("Add category");
            button.onClick(async () => {
                let name = "New category";
                for (
                    let i = 2;
                    plugin.settings.categories.some((c) => c.name === name);
                    i++
                ) {
                    name = `New category ${i}`;
                }
                plugin.settings.categories = [
                    ...plugin.settings.categories,
                    { name, color: "#3788d8" },
                ];
                await plugin.saveCategories();
                this.display();
            });
        });
    }
}
