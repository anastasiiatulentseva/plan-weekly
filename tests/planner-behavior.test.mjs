import assert from "node:assert/strict";
import test from "node:test";
import { remapDateByWeekPattern, getScheduleDatesForTemplate, isNavigableMonth } from "../src/shared/planner.ts";

test("remaps cloned activities by weekday ordinal without collisions", async () => {

  assert.equal(
    remapDateByWeekPattern("2026-09-01", "2026-09", "2026-10"),
    "2026-10-06"
  );
  assert.equal(
    remapDateByWeekPattern("2026-09-08", "2026-09", "2026-10"),
    "2026-10-13"
  );
  assert.equal(
    remapDateByWeekPattern("2026-09-22", "2026-09", "2026-10"),
    "2026-10-27"
  );
  assert.equal(
    remapDateByWeekPattern("2026-09-29", "2026-09", "2026-10"),
    "2026-10-27"
  );
});

test("recurring drops begin on the selected day instead of earlier in the month", async () => {
  const template = {
    id: "activity-test",
    title: "Football",
    personIds: [],
    color: "#0ea5e9",
    isRecurring: true
  };

  assert.deepEqual(
    getScheduleDatesForTemplate(template, "2026-09-15", "2026-09"),
    ["2026-09-15", "2026-09-22", "2026-09-29"]
  );
});

test("non-recurring drops schedule only the selected date", async () => {
  const template = {
    id: "activity-test",
    title: "Gym",
    personIds: [],
    color: "#10b981"
  };

  assert.deepEqual(
    getScheduleDatesForTemplate(template, "2026-09-15", "2026-09"),
    ["2026-09-15"]
  );
});

test("month navigation is limited to previous, current, and next month", async () => {

  assert.equal(isNavigableMonth("2026-08", "2026-09"), true);
  assert.equal(isNavigableMonth("2026-09", "2026-09"), true);
  assert.equal(isNavigableMonth("2026-10", "2026-09"), true);
  assert.equal(isNavigableMonth("2026-07", "2026-09"), false);
  assert.equal(isNavigableMonth("2026-11", "2026-09"), false);
});
