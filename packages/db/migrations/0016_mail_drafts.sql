CREATE TABLE "mail_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"to_text" text DEFAULT '' NOT NULL,
	"cc_text" text DEFAULT '' NOT NULL,
	"bcc_text" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"html" text DEFAULT '' NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"plain_mode" boolean DEFAULT false NOT NULL,
	"attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"in_reply_to" text,
	"references_hdr" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_drafts" ADD CONSTRAINT "mail_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_drafts_user_idx" ON "mail_drafts" USING btree ("user_id","updated_at");