CREATE TABLE "chat_turns" (
	"sequence" serial NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" text NOT NULL,
	"run_id" text NOT NULL,
	"messages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_versions" (
	"artifact_id" text NOT NULL,
	"version" integer NOT NULL,
	"program" text NOT NULL,
	"scripts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_versions_artifact_id_version_pk" PRIMARY KEY("artifact_id","version")
);
--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_thread_id_app_threads_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."app_threads"("thread_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_artifacts" ADD CONSTRAINT "dashboard_artifacts_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_versions" ADD CONSTRAINT "dashboard_versions_artifact_id_dashboard_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."dashboard_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_turns_thread_run_idx" ON "chat_turns" USING btree ("thread_id","run_id");