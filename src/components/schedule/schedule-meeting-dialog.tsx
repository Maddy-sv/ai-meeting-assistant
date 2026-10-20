import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUser } from "@/lib/auth";
import { MEETING_PLATFORMS } from "@/lib/format";
import { createMeetings, dataKeys, listProjects, type MeetingListRow } from "@/lib/rpc";

const NO_PROJECT = "none";

const scheduleSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Give the meeting a title.")
    .max(120, "Keep it under 120 characters."),
  platform: z.enum(["google_meet", "teams", "manual"]),
  link: z
    .string()
    .trim()
    .max(500, "That link is too long.")
    .refine((v) => {
      if (!v) return true;
      try {
        return new URL(v).protocol === "https:";
      } catch {
        return false;
      }
    }, "Enter a full https:// link, or leave it empty."),
  date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Pick a date."),
  time: z.string().regex(/^(\d{2}:\d{2})?$/, "Pick a time."),
  projectId: z.string(),
});

type ScheduleValues = z.infer<typeof scheduleSchema>;

export interface ScheduleMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  defaultDate?: Date | null;

  defaultProjectId?: string | null;

  sendConfirmation?: boolean;

  allowStartNow?: boolean;
  title?: string;
  onCreated?: (meeting: MeetingListRow) => void;
}

function defaultsFor(
  date: Date | null | undefined,
  projectId: string | null | undefined,
  startNow: boolean,
) {
  const now = new Date();
  if (startNow && !date) {
    return {
      title: "",
      platform: "google_meet" as const,
      link: "",
      date: "",
      time: "",
      projectId: projectId ?? NO_PROJECT,
    };
  }

  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  return {
    title: "",
    platform: "google_meet" as const,
    link: "",
    date: format(date ?? now, "yyyy-MM-dd"),
    time: `${String(nextHour.getHours()).padStart(2, "0")}:00`,
    projectId: projectId ?? NO_PROJECT,
  };
}

export function ScheduleMeetingDialog({
  open,
  onOpenChange,
  defaultDate,
  defaultProjectId,
  sendConfirmation = true,
  allowStartNow = false,
  title = "Schedule a meeting",
  onCreated,
}: ScheduleMeetingDialogProps) {
  const user = useUser();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const projects = useQuery({
    queryKey: dataKeys.projects(userId),
    queryFn: () => listProjects(userId),
    enabled: !!user && open,
  });

  const form = useForm<ScheduleValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: defaultsFor(defaultDate, defaultProjectId, allowStartNow),
  });

  useEffect(() => {
    if (open) form.reset(defaultsFor(defaultDate, defaultProjectId, allowStartNow));
  }, [open, defaultDate, defaultProjectId, allowStartNow, form]);

  async function onSubmit(values: ScheduleValues) {
    if (!user) {
      toast.error("Your session has expired. Please sign in again.");
      return;
    }
    if (!values.date && !allowStartNow) {
      form.setError("date", { message: "Pick a date." });
      return;
    }
    if (values.date && !values.time) {
      form.setError("time", { message: "Pick a time." });
      return;
    }
    const scheduledAt = values.date ? new Date(`${values.date}T${values.time}`) : new Date();
    if (Number.isNaN(scheduledAt.getTime())) {
      form.setError("date", { message: "That date and time is not valid." });
      return;
    }

    setSubmitting(true);
    try {
      const [meeting] = await createMeetings([
        {
          hostId: user.id,
          title: values.title,
          platform: values.platform,
          meetingLink: values.link || null,
          scheduledAt: scheduledAt.toISOString(),
          projectId: values.projectId === NO_PROJECT ? null : values.projectId,
        },
      ]);

      if (sendConfirmation) {
        const { error } = await supabase.functions.invoke("send-confirmation", {
          body: {
            title: values.title,
            time: scheduledAt.toISOString(),
            platform: values.platform,
            link: values.link || null,
          },
        });
        if (error) {
          console.error("[schedule] confirmation email failed", error);
          toast.warning("Meeting scheduled, but the confirmation email could not be sent.");
        } else {
          toast.success("Meeting scheduled. A confirmation email is on its way.");
        }
      } else {
        toast.success("Meeting scheduled.");
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["meetings"] }),
        queryClient.invalidateQueries({ queryKey: ["project"] }),
        queryClient.invalidateQueries({ queryKey: ["user-dashboard"] }),
      ]);
      onOpenChange(false);
      if (meeting) onCreated?.(meeting);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not schedule the meeting.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {sendConfirmation
              ? "We'll add it to your calendar and email you a confirmation."
              : "It will appear in your meetings list and calendar."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Weekly project sync" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{allowStartNow ? "Date (optional)" : "Date"}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    {allowStartNow && (
                      <FormDescription>Leave empty to start the meeting now.</FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{allowStartNow ? "Time (optional)" : "Time"}</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="platform"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Platform</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MEETING_PLATFORMS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_PROJECT}>No project</SelectItem>
                        {(projects.data ?? []).map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {projects.isError && (
                      <FormDescription className="text-destructive">
                        Could not load your projects.
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="link"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Meeting link (optional)</FormLabel>
                  <FormControl>
                    <Input type="url" inputMode="url" placeholder="https://…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="glass"
                disabled={submitting}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="brand" disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" />}
                {submitting ? "Scheduling…" : "Schedule meeting"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
