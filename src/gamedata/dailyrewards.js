import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "gamedata", "dailyrewards.json");
const schedules = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];

export const defaultSchedule = schedules.find((schedule) => !schedule.token);
export const tokenSchedules = schedules.filter((schedule) => schedule.token);
