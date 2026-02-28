import { useState, useEffect, useRef } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { X, ImagePlus, Trash2 } from "lucide-react";
import type { Template } from "@/types/template";

interface TemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: Template | null;
  onSave: (data: TemplateFormData) => void | Promise<void>;
  mode: "create" | "edit";
  /** Pre-fill name for create mode */
  defaultName?: string;
  /** Whether this is a workflow template (shows category field) */
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
  isWorkflow,
}: TemplateDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [category, setCategory] = useState("");
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showCategoryField = isWorkflow ?? template?.templateType === "workflow";

  // Initialize form with template data
  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description || "");
      setTags(template.tags || []);
      setThumbnail(template.thumbnail || null);
      if (template.workflowData) {
        setCategory(template.workflowData.category || "");
      }
    } else {
      setName(defaultName || "");
      setDescription("");
      setTags([]);
      setCategory("");
      setThumbnail(null);
    }
  }, [template, open, defaultName]);

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleThumbnailSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Convert to base64 data URL
    const reader = new FileReader();
    reader.onload = () => {
      setThumbnail(reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSave = async () => {
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        tags,
        category: category.trim() || undefined,
        thumbnail,
      });
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
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
          {/* Thumbnail / Cover Image */}
          <div className="space-y-2">
            <Label>{t("templates.coverImage", "Cover Image")}</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleThumbnailSelect}
              className="hidden"
            />
            {thumbnail ? (
              <div className="relative group rounded-lg overflow-hidden border border-border">
                <img
                  src={thumbnail}
                  alt="Cover"
                  className="w-full h-32 object-cover"
                />
                <button
                  onClick={() => setThumbnail(null)}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-24 rounded-lg border-2 border-dashed border-border hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <ImagePlus className="h-5 w-5" />
                <span className="text-xs">
                  {t("templates.uploadCover", "Click to upload cover image")}
                </span>
              </button>
            )}
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="template-name">{t("templates.templateName")}</Label>
            <Input
              id="template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("templates.templateNamePlaceholder")}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="template-description">
              {t("templates.descriptionLabel", "Description")}
            </Label>
            <Textarea
              id="template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("templates.descriptionPlaceholder")}
              rows={3}
            />
          </div>

          {/* Category (for workflow templates) */}
          {showCategoryField && (
            <div className="space-y-2">
              <Label htmlFor="template-category">
                {t("templates.category")}
              </Label>
              <Input
                id="template-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t("templates.categoryPlaceholder")}
              />
            </div>
          )}

          {/* Tags */}
          <div className="space-y-2">
            <Label htmlFor="template-tags">{t("templates.tags")}</Label>
            <div className="flex gap-2">
              <Input
                id="template-tags"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("templates.tagsPlaceholder")}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleAddTag}
                disabled={!tagInput.trim()}
              >
                {t("common.add")}
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
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
