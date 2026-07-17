CREATE TABLE "mail_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"imap_host" text NOT NULL,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer DEFAULT 465 NOT NULL,
	"username" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"backfill_done" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"signature_html" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "mail_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"content_id" text,
	"is_inline" boolean DEFAULT false NOT NULL,
	"content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"use_count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "mail_contacts_user_email_uq" UNIQUE("user_id","email")
);
--> statement-breakpoint
CREATE TABLE "mail_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"special_use" text,
	"subscribed" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"uidvalidity" text,
	"uidnext" text,
	"highest_modseq" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_folders_account_path_uq" UNIQUE("account_id","path")
);
--> statement-breakpoint
CREATE TABLE "mail_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_labels_account_name_uq" UNIQUE("account_id","name")
);
--> statement-breakpoint
CREATE TABLE "mail_message_labels" (
	"message_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "mail_message_labels_message_id_label_id_pk" PRIMARY KEY("message_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"folder_id" uuid NOT NULL,
	"thread_id" uuid,
	"uid" text,
	"message_id_hdr" text,
	"in_reply_to" text,
	"references_hdrs" text[],
	"from_addr" jsonb NOT NULL,
	"to_addrs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_addrs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc_addrs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_to" jsonb,
	"subject" text,
	"snippet" text,
	"body_html" text,
	"body_text" text,
	"body_fetched" boolean DEFAULT false NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_starred" boolean DEFAULT false NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"is_answered" boolean DEFAULT false NOT NULL,
	"is_forwarded" boolean DEFAULT false NOT NULL,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"size_bytes" integer,
	"direction" text DEFAULT 'inbound' NOT NULL,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_messages_folder_uid_uq" UNIQUE("account_id","folder_id","uid")
);
--> statement-breakpoint
CREATE TABLE "mail_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"draft_message_id" uuid,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"last_error" text,
	"sent_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_outbox_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "mail_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 100 NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"stop_processing" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"subject" text,
	"snippet" text,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_attachments" ADD CONSTRAINT "mail_attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_attachments" ADD CONSTRAINT "mail_attachments_message_id_mail_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_contacts" ADD CONSTRAINT "mail_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_folders" ADD CONSTRAINT "mail_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_folders" ADD CONSTRAINT "mail_folders_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_labels" ADD CONSTRAINT "mail_labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_labels" ADD CONSTRAINT "mail_labels_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_labels" ADD CONSTRAINT "mail_message_labels_message_id_mail_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_labels" ADD CONSTRAINT "mail_message_labels_label_id_mail_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."mail_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_folder_id_mail_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."mail_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_thread_id_mail_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_draft_message_id_mail_messages_id_fk" FOREIGN KEY ("draft_message_id") REFERENCES "public"."mail_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_sent_message_id_mail_messages_id_fk" FOREIGN KEY ("sent_message_id") REFERENCES "public"."mail_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_rules" ADD CONSTRAINT "mail_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_rules" ADD CONSTRAINT "mail_rules_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_accounts_user_idx" ON "mail_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mail_attachments_message_idx" ON "mail_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "mail_folders_user_idx" ON "mail_folders" USING btree ("user_id","account_id");--> statement-breakpoint
CREATE INDEX "mail_messages_folder_time_idx" ON "mail_messages" USING btree ("folder_id","received_at");--> statement-breakpoint
CREATE INDEX "mail_messages_thread_idx" ON "mail_messages" USING btree ("thread_id","sent_at");--> statement-breakpoint
CREATE INDEX "mail_messages_msgid_idx" ON "mail_messages" USING btree ("account_id","message_id_hdr");--> statement-breakpoint
CREATE INDEX "mail_messages_user_idx" ON "mail_messages" USING btree ("user_id","account_id");--> statement-breakpoint
CREATE INDEX "mail_outbox_due_idx" ON "mail_outbox" USING btree ("status","send_after");--> statement-breakpoint
CREATE INDEX "mail_threads_list_idx" ON "mail_threads" USING btree ("user_id","account_id","last_message_at");--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "search_vec" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("subject", '')), 'A') || setweight(to_tsvector('simple', coalesce("body_text", '')), 'B')) STORED;--> statement-breakpoint
CREATE INDEX "mail_messages_fts_idx" ON "mail_messages" USING gin ("search_vec");--> statement-breakpoint
CREATE INDEX "mail_messages_from_idx" ON "mail_messages" USING gin ("from_addr" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "mail_messages_refs_idx" ON "mail_messages" USING gin ("references_hdrs");--> statement-breakpoint
CREATE INDEX "mail_messages_unread_idx" ON "mail_messages" USING btree ("folder_id","received_at") WHERE "is_read" = false;