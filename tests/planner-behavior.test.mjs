import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
let helpersPromise;

async function loadPlannerHelpers() {
  helpersPromise ??= (async () => {
    const outdir = await mkdtemp(join(tmpdir(), "plan-by-week-tests-"));
    const entry = join(outdir, "entry.ts");
    const outfile = join(outdir, "planner-helpers.cjs");
    const sourcePath = join(process.cwd(), "src/components/PlannerApp.tsx");
    const reactPath = join(process.cwd(), "node_modules/react/index.js");
    const renderPath = join(process.cwd(), "node_modules/react-dom/server.js");

    await writeFile(
      entry,
      [
        `import React from ${JSON.stringify(reactPath)};`,
        `import { renderToString } from ${JSON.stringify(renderPath)};`,
        `import PlannerApp from ${JSON.stringify(sourcePath)};`,
        'export const renderInitialPlanner = () => renderToString(React.createElement(PlannerApp));',
        'export {',
        '  getScheduleDatesForTemplate,',
        '  isNavigableMonth,',
        '  moveScheduledActivityToDate,',
        '  parseActivityDragPayload,',
        '  remapDateByWeekPattern,',
        '  replaceActivityTemplate,',
        '  replaceScheduledActivity,',
        '  serializeActivityDragPayload',
        `} from ${JSON.stringify(sourcePath)};`
      ].join("\n")
    );

    await build({
      absWorkingDir: process.cwd(),
      bundle: true,
      entryPoints: [entry],
      format: "cjs",
      loader: { ".tsx": "tsx" },
      outfile,
      platform: "node"
    });

    return require(outfile);
  })();

  return helpersPromise;
}

test("remaps cloned activities by weekday ordinal without collisions", async () => {
  const { remapDateByWeekPattern } = await loadPlannerHelpers();

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
  const { getScheduleDatesForTemplate } = await loadPlannerHelpers();
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
  const { getScheduleDatesForTemplate } = await loadPlannerHelpers();
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

test("editing a reusable activity leaves scheduled copies unchanged", async () => {
  const { replaceActivityTemplate } = await loadPlannerHelpers();
  const original = {
    id: "activity-test",
    title: "Gym",
    personIds: ["person-1"],
    color: "#10b981"
  };
  const scheduled = {
    ...original,
    id: "scheduled-test",
    templateId: original.id,
    date: "2026-09-15"
  };
  const state = {
    people: [],
    activityTemplates: [original],
    months: { "2026-09": { monthKey: "2026-09", scheduled: [scheduled] } }
  };
  const updated = replaceActivityTemplate(state, {
    ...original,
    title: "Swimming",
    color: "#0ea5e9"
  });

  assert.equal(updated.activityTemplates[0].title, "Swimming");
  assert.equal(updated.activityTemplates[0].color, "#0ea5e9");
  assert.deepEqual(updated.months["2026-09"].scheduled[0], scheduled);
  assert.equal(state.activityTemplates[0].title, "Gym");
});

test("scheduled edits are committed only when the replacement is applied", async () => {
  const { replaceScheduledActivity } = await loadPlannerHelpers();
  const original = {
    id: "scheduled-test",
    title: "Gym",
    personIds: [],
    date: "2026-09-15",
    startTime: "10:00",
    color: "#10b981"
  };
  const state = {
    people: [],
    activityTemplates: [],
    months: { "2026-09": { monthKey: "2026-09", scheduled: [original] } }
  };
  const draft = { ...original, title: "Swimming", startTime: "12:00" };

  assert.equal(state.months["2026-09"].scheduled[0].title, "Gym");

  const saved = replaceScheduledActivity(state, draft);
  assert.deepEqual(saved.months["2026-09"].scheduled[0], draft);
  assert.deepEqual(state.months["2026-09"].scheduled[0], original);
  assert.equal(replaceScheduledActivity(state, { ...draft, id: "missing" }), state);
});

test("month navigation is limited to previous, current, and next month", async () => {
  const { isNavigableMonth } = await loadPlannerHelpers();

  assert.equal(isNavigableMonth("2026-08", "2026-09"), true);
  assert.equal(isNavigableMonth("2026-09", "2026-09"), true);
  assert.equal(isNavigableMonth("2026-10", "2026-09"), true);
  assert.equal(isNavigableMonth("2026-07", "2026-09"), false);
  assert.equal(isNavigableMonth("2026-11", "2026-09"), false);
});

test("drag payloads distinguish reusable templates from scheduled copies", async () => {
  const { parseActivityDragPayload, serializeActivityDragPayload } =
    await loadPlannerHelpers();

  const templatePayload = { kind: "template", id: "activity-test" };
  const scheduledPayload = { kind: "scheduled", id: "scheduled-test" };

  assert.deepEqual(
    parseActivityDragPayload(serializeActivityDragPayload(templatePayload)),
    templatePayload
  );
  assert.deepEqual(
    parseActivityDragPayload(serializeActivityDragPayload(scheduledPayload)),
    scheduledPayload
  );
  assert.equal(parseActivityDragPayload("scheduled:"), null);
});

test("moving a scheduled card relocates the existing copy without duplicating it", async () => {
  const { moveScheduledActivityToDate } = await loadPlannerHelpers();
  const activity = {
    id: "scheduled-test",
    templateId: "activity-test",
    title: "Football",
    personIds: [],
    date: "2026-09-14",
    color: "#8b5cf6"
  };
  const state = {
    people: [],
    activityTemplates: [],
    months: {
      "2026-09": {
        monthKey: "2026-09",
        scheduled: [activity]
      }
    }
  };

  const moved = moveScheduledActivityToDate(
    state,
    activity.id,
    "2026-09-18"
  );

  assert.deepEqual(moved.months["2026-09"].scheduled, [
    { ...activity, date: "2026-09-18" }
  ]);
});

test("server render waits for browser state before showing planner controls", async () => {
  const { renderInitialPlanner } = await loadPlannerHelpers();
  const markup = renderInitialPlanner();

  assert.match(markup, /Loading planner/);
  assert.doesNotMatch(markup, /Planner options|Calendar controls/);
});
