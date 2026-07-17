"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function MarkAllReadButton() {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await fetch("/api/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        router.refresh();
      }}
    >
      Mark all read
    </Button>
  );
}
