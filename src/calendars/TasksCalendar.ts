import { App } from "obsidian";
import { CalendarInfo, OFCEvent } from "src/types";
import { EventResponse } from "./Calendar";
import RemoteCalendar from "./RemoteCalendar";

interface TasksApiV1 {
	search(
		query: string,
	): Promise<{ taskGroups: { _groups: { tasks: TaskItem[] }[] } }>;
}

interface MomentDate {
	format(format: string): string;
}

interface TaskItem {
	description: string;
	dueDate: MomentDate | null;
	doneDate: MomentDate | null;
	status: any;
	originalMarkdown: string;
}

export default class TasksCalendar extends RemoteCalendar {
	private app: App;
	private events: EventResponse[] = [];

	constructor(app: App, color: string) {
		super(color);
		this.app = app;
	}

	get type(): CalendarInfo["type"] {
		return "tasks";
	}

	get identifier(): string {
		return "obsidian-tasks";
	}

	get name(): string {
		return "Tasks";
	}

	async revalidate(): Promise<void> {
		const tasksPlugin = (this.app as any).plugins?.plugins?.[
			"obsidian-tasks-plugin"
		];
		const tasksApi: TasksApiV1 | undefined = tasksPlugin?.apiV1;

		if (!tasksApi) {
			console.warn("Could not find obsidian-tasks plugin", tasksPlugin);
			this.events = [];
			return;
		}

		try {
			const results = await tasksApi.search("not done due this month");
			const allTasks = results.taskGroups._groups.map((i) => i.tasks).flat();
			const uniqueTasks = this.deduplicateTasksByName(allTasks);

			this.events = this.convertTasksToEvents(uniqueTasks);

			console.log("events validated", this.events);
		} catch (e) {
			console.error("Failed to fetch tasks:", e);
			this.events = [];
		}
	}

	private deduplicateTasksByName(tasks: TaskItem[]): TaskItem[] {
		const seen = new Map<string, TaskItem>();
		for (const task of tasks) {
			if (!seen.has(task.description)) {
				seen.set(task.description, task);
			}
		}
		return [...seen.values()];
	}

	async getEvents(): Promise<EventResponse[]> {
		return this.events;
	}

	private convertTasksToEvents(tasks: TaskItem[]): EventResponse[] {
		return tasks
			.filter((task) => task.dueDate && !task.status.isCompleted())
			.map((task) => {
				const event: OFCEvent = {
					title: task.description,
					type: "single",
					date: task.dueDate!.format("YYYY-MM-DD"),
					endDate: null,
					allDay: true,
				};
				return [event, null] as EventResponse;
			});
	}
}
