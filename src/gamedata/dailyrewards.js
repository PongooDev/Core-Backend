import { perBuild } from "./read.js";

// The requesting build's daily login reward schedules (1.8 has its own default schedule).
const schedules = perBuild((read) => read("dailyrewards", []));

export const defaultSchedule = () => schedules().find((schedule) => !schedule.token);
export const tokenSchedules = () => schedules().filter((schedule) => schedule.token);
