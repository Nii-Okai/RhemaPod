"use client";

import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EditorField } from "@/components/sermons/editor/field";
import { SignInImageCard } from "./sign-in-image-card";
import { isApiError } from "@/lib/api/errors";
import { formatRelativeTime } from "@/lib/format";
import {
  buildSettingsPatch,
  isSettingsPatchEmpty,
  toDraft,
  useChurchSettings,
  useUpdateChurchSettings,
  type ChurchSettings,
  type EditableSettingsField,
  type SettingsDraft,
} from "@/lib/query/hooks/use-church-settings";

/* =============================================================================
   ProfileScreen — Settings › Profile (plan-admin-settings S17, ADR 0017).

   One form over the single `church_settings` row, in three cards: Church,
   Contact, and App content (what the mobile app shows: comment guidelines and
   the two legal links). Save sends only the fields that changed, plus the
   `version` the form was loaded at.

   A 409 means someone else saved since this form loaded. The form keeps the
   user's edits on screen and shows a banner; "Load latest" re-bases the form
   on the server's current row, discarding the local edits, so the user
   reapplies them knowingly rather than overwriting the other change.

   Leaving with unsaved edits triggers the browser's "leave site?" prompt.
   ========================================================================== */

type FieldSpec = {
  field: EditableSettingsField;
  label: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  type?: "email" | "url" | "tel";
  maxLength: number;
  required?: boolean;
};

const SECTIONS: ReadonlyArray<{ title: string; description: string; fields: FieldSpec[] }> = [
  {
    title: "Church",
    description: "Who the app belongs to.",
    fields: [
      { field: "church_name", label: "Church name", maxLength: 200 },
      { field: "app_display_name", label: "App name", maxLength: 100 },
      { field: "tagline", label: "Tagline", maxLength: 200 },
      { field: "about", label: "About", multiline: true, rows: 4, maxLength: 5000 },
    ],
  },
  {
    title: "Contact",
    description: "The contact email is what the app’s “Contact us” opens.",
    fields: [
      { field: "contact_email", label: "Contact email", type: "email", maxLength: 320, required: true },
      { field: "contact_phone", label: "Phone", type: "tel", maxLength: 40 },
      { field: "website_url", label: "Website", type: "url", maxLength: 2048, hint: "Must start with https://" },
      { field: "address", label: "Address", multiline: true, rows: 2, maxLength: 500 },
    ],
  },
  {
    title: "App content",
    description:
      "Shown in the mobile app. Editing the guidelines doesn’t ask people who already accepted them to accept again.",
    fields: [
      {
        field: "comment_guidelines",
        label: "Comment guidelines",
        multiline: true,
        rows: 14,
        maxLength: 10_000,
        required: true,
        hint: "The first line is shown as the title.",
      },
      {
        field: "terms_of_use_url",
        label: "Terms of use link",
        type: "url",
        maxLength: 2048,
        hint: "Leave empty to hide the row in the app.",
      },
      {
        field: "privacy_policy_url",
        label: "Privacy policy link",
        type: "url",
        maxLength: 2048,
        hint: "Leave empty to hide the row in the app.",
      },
      { field: "copyright_notice", label: "Copyright notice", maxLength: 300 },
    ],
  },
];

function isDirty(base: ChurchSettings, draft: SettingsDraft): boolean {
  return !isSettingsPatchEmpty(buildSettingsPatch(base, draft));
}

export function ProfileScreen() {
  const settings = useChurchSettings();

  if (settings.isError) {
    return (
      <Alert variant="error" title="Couldn’t load the settings">
        {settings.error instanceof Error ? settings.error.message : "Please try again."}
      </Alert>
    );
  }
  if (!settings.data) {
    return <p className="text-body-sm text-ink-faint">Loading…</p>;
  }
  return <ProfileForm initial={settings.data} reload={() => settings.refetch()} />;
}

function ProfileForm({
  initial,
  reload,
}: {
  initial: ChurchSettings;
  reload: () => Promise<{ data?: ChurchSettings }>;
}) {
  const update = useUpdateChurchSettings();

  const [base, setBase] = React.useState<ChurchSettings>(initial);
  const [draft, setDraft] = React.useState<SettingsDraft>(() => toDraft(initial));
  const [conflict, setConflict] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const dirty = isDirty(base, draft);

  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const setField = (field: EditableSettingsField, value: string) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [field]: value }));
    setFieldErrors((e) => {
      if (!(field in e)) return e;
      const next = { ...e };
      delete next[field];
      return next;
    });
  };

  const loadLatest = async () => {
    const fresh = await reload();
    if (fresh.data) {
      setBase(fresh.data);
      setDraft(toDraft(fresh.data));
    }
    setConflict(false);
    setFieldErrors({});
    setFormError(null);
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const patch = buildSettingsPatch(base, draft);
    if (isSettingsPatchEmpty(patch)) return;
    setFormError(null);
    setFieldErrors({});
    update.mutate(patch, {
      onSuccess: (row) => {
        setBase(row);
        setDraft(toDraft(row));
        setSaved(true);
      },
      onError: (err) => {
        if (isApiError(err) && err.status === 409) {
          setConflict(true);
        } else if (isApiError(err) && err.isValidation) {
          setFieldErrors(err.fieldErrorMap());
          setFormError("Some fields need fixing before this can be saved.");
        } else {
          setFormError(err.message || "Couldn’t save. Please try again.");
        }
      },
    });
  };

  const updatedLine = base.updated_by
    ? `Last saved ${formatRelativeTime(Date.parse(base.updated_at))} by ${base.updated_by}`
    : "Not edited yet — these are the values the app shipped with.";

  return (
    <form className="flex flex-col gap-16" onSubmit={onSubmit} noValidate>
      {conflict ? (
        <Alert variant="warning" title="Someone else saved these settings">
          <div className="flex flex-col items-start gap-8">
            <span>
              Your changes weren’t saved, so theirs aren’t lost. Load the latest version,
              then make your edits again.
            </span>
            <Button type="button" variant="secondary" size="sm" onClick={loadLatest}>
              Load latest
            </Button>
          </div>
        </Alert>
      ) : null}
      {saved && !dirty ? (
        <Alert variant="success" title="Settings saved">
          The mobile app picks up the change within a few minutes.
        </Alert>
      ) : null}
      {formError ? (
        <Alert variant="error" title="Couldn’t save">
          {formError}
        </Alert>
      ) : null}

      {SECTIONS.map((section) => (
        <Card key={section.title} className="flex flex-col gap-16" data-slot="settings-section">
          <div className="flex flex-col gap-2">
            <h2 className="text-[15px] font-semibold text-ink">{section.title}</h2>
            <p className="text-[13px] text-ink-muted">{section.description}</p>
          </div>
          {section.fields.map((spec) => {
            const id = `settings-${spec.field}`;
            const error =
              fieldErrors[spec.field] ??
              (spec.required && draft[spec.field].trim() === "" ? "Required" : null);
            const common = {
              id,
              value: draft[spec.field],
              maxLength: spec.maxLength,
              error: Boolean(error),
              "aria-describedby": error ? `${id}-error` : undefined,
              onChange: (
                e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
              ) => setField(spec.field, e.target.value),
            };
            return (
              <EditorField
                key={spec.field}
                label={spec.label}
                htmlFor={id}
                hint={spec.hint}
                error={error}
              >
                {spec.multiline ? (
                  <Textarea {...common} rows={spec.rows} />
                ) : (
                  <Input {...common} type={spec.type ?? "text"} />
                )}
              </EditorField>
            );
          })}
        </Card>
      ))}

      <SignInImageCard
        imageUrl={base.sign_in_image_url}
        onSaved={(row) =>
          // Saved on its own: re-base only what it changed, keep any unsaved
          // edits in the form, and carry the new version so Save isn't a 409.
          setBase((b) => ({
            ...b,
            sign_in_image_url: row.sign_in_image_url,
            version: row.version,
            updated_at: row.updated_at,
            updated_by: row.updated_by,
          }))
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-12">
        <span className="text-[12.5px] text-ink-faint">{updatedLine}</span>
        <div className="flex items-center gap-8">
          <Button
            type="button"
            variant="secondary"
            disabled={!dirty || update.isPending}
            onClick={() => {
              setDraft(toDraft(base));
              setFieldErrors({});
              setFormError(null);
            }}
          >
            Discard changes
          </Button>
          <Button
            type="submit"
            disabled={
              !dirty ||
              update.isPending ||
              conflict ||
              draft.contact_email.trim() === "" ||
              draft.comment_guidelines.trim() === ""
            }
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </form>
  );
}
