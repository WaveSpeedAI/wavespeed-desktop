import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Template } from "@/types/template";

interface TemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: Template | null;
  onSave: (data: TemplateFormData) => void | Promise<void>;
  mode: "create" | "edit";
  defaultName?: string;
  isWorkflow?: boolean;
}

export interface TemplateFormData {
  name: string;
  description: string;
  tags: string[];
  category?: string;
  thumbnail?: string | null;
}

export function TemplateDialog({
  open,
  onOpenChange,
  template,
  onSave,
  mode,
  defaultName,
}: TemplateDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (template) {
      setName(template.name);
    } else {
      setName(defaultName || "");
    }
  }, [template, open, defaultName]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: "",
        tags: [],
        thumbnail: null,
      });
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && name.trim()) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? t("templates.createTemplate")
              : t("templates.editTemplate")}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? t("templates.createTemplateDesc")
              : t("templates.editTemplateDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template-name">{t("templates.templateName")}</Label>
            <Input
              id="template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("templates.templateNamePlaceholder")}
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || isSaving}>
            {isSaving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
