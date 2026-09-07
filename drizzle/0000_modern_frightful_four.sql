CREATE TABLE "calendar_metadata" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"calendar_revision" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "singleton" CHECK ("calendar_metadata"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "people_version_positive" CHECK ("people"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "mutation_requests" (
	"key" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"color" text NOT NULL,
	"icon" text,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"start_time" time,
	"end_time" time,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"date" date NOT NULL,
	"template_id" text,
	"recurrence_id" text,
	CONSTRAINT "scheduled_times" CHECK ("scheduled_activities"."start_time" IS NULL OR "scheduled_activities"."end_time" IS NULL OR "scheduled_activities"."start_time" <= "scheduled_activities"."end_time"),
	CONSTRAINT "scheduled_version_positive" CHECK ("scheduled_activities"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "scheduled_activity_people" (
	"activity_id" text NOT NULL,
	"person_id" text NOT NULL,
	CONSTRAINT "scheduled_activity_people_activity_id_person_id_pk" PRIMARY KEY("activity_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "activity_template_people" (
	"activity_id" text NOT NULL,
	"person_id" text NOT NULL,
	CONSTRAINT "activity_template_people_activity_id_person_id_pk" PRIMARY KEY("activity_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "activity_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"color" text NOT NULL,
	"icon" text,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"start_time" time,
	"end_time" time,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "template_times" CHECK ("activity_templates"."start_time" IS NULL OR "activity_templates"."end_time" IS NULL OR "activity_templates"."start_time" <= "activity_templates"."end_time"),
	CONSTRAINT "template_version_positive" CHECK ("activity_templates"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "scheduled_activities" ADD CONSTRAINT "scheduled_activities_template_id_activity_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."activity_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_activity_people" ADD CONSTRAINT "scheduled_activity_people_activity_id_scheduled_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."scheduled_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_activity_people" ADD CONSTRAINT "scheduled_activity_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_template_people" ADD CONSTRAINT "activity_template_people_activity_id_activity_templates_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_template_people" ADD CONSTRAINT "activity_template_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_date_idx" ON "scheduled_activities" USING btree ("date");--> statement-breakpoint
CREATE INDEX "scheduled_recurrence_idx" ON "scheduled_activities" USING btree ("recurrence_id");--> statement-breakpoint
CREATE INDEX "scheduled_template_idx" ON "scheduled_activities" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "scheduled_person_idx" ON "scheduled_activity_people" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "template_person_idx" ON "activity_template_people" USING btree ("person_id");