import type { CreateScheduleRequest } from "@wiki-agents/contracts/schedules/create-schedule/request";
import type { Schedule } from "@wiki-agents/contracts/schedules/model";
import type { UpdateScheduleRequest } from "@wiki-agents/contracts/schedules/update-schedule/request";
import { errorMessage } from "#lib/api/client.ts";
import { createSchedule, deleteSchedule, listSchedules, pauseSchedule, resumeSchedule, runScheduleNow, updateSchedule } from "./api.ts";

/**
 * Reminders and scheduled prompts. Reloaded when the Schedules view opens and after
 * each change; a schedule firing shows up in the inbox, which is live.
 */
class SchedulesStore {
  list = $state<ReadonlyArray<Schedule>>([]);
  defaultTimezone = $state("Pacific/Auckland");
  status = $state<"loading" | "loaded" | "failed">("loading");
  error = $state<string | null>(null);

  byId(id: string | null) {
    return this.list.find((schedule) => schedule.id === id);
  }

  async load() {
    try {
      const response = await listSchedules();
      this.list = response.schedules;
      this.defaultTimezone = response.defaultTimezone;
      this.status = "loaded";
      this.error = null;
    } catch (error) {
      this.status = "failed";
      this.error = errorMessage(error, "Could not load schedules");
    }
  }

  /** Saves a new schedule; throws with why it couldn't, for the form to show. */
  async create(request: CreateScheduleRequest) {
    const { schedule } = await createSchedule(request);
    await this.load();
    return schedule;
  }

  async update(scheduleId: string, request: UpdateScheduleRequest) {
    const { schedule } = await updateSchedule(scheduleId, request);
    await this.load();
    return schedule;
  }

  pause(scheduleId: string) {
    return this.#act(pauseSchedule(scheduleId), "Could not pause");
  }

  resume(scheduleId: string) {
    return this.#act(resumeSchedule(scheduleId), "Could not resume");
  }

  runNow(scheduleId: string) {
    return this.#act(runScheduleNow(scheduleId), "Could not run it now");
  }

  remove(scheduleId: string) {
    return this.#act(deleteSchedule(scheduleId), "Could not delete");
  }

  async #act(action: Promise<unknown>, fallback: string) {
    try {
      await action;
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error, fallback);
    }
    await this.load();
  }
}

export const schedules = new SchedulesStore();
