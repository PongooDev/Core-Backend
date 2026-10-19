import { readGameData } from "./read.js";

const schedules = readGameData("dailyrewards", []);

export const defaultSchedule = schedules.find((schedule) => !schedule.token);
export const tokenSchedules = schedules.filter((schedule) => schedule.token);
