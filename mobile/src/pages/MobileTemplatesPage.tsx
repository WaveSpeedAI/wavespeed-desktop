import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  useTemplateStore,
  type Template,
  type TemplateExport,
} from "@/stores/templateStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import {
  Search,
  FolderOpen,
  Play,
  Trash2,
  Pencil,
  Download,
  Upload,
  MoreVertical,
} from "lucide-react";
import { fuzzyMatch } from "@/lib/fuzzySearch";

export function MobileTemplatesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    templates,
    loadTemplates,
    updateTemplate,
    deleteTemplate,
    deleteTemplates,
    exportTemplates,
    importTemplates,
    isLoaded,
  } = useTemplateStore();
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit dialog state
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [editName, setEditName] = useState("");

  // Delete confirmation state
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(
    null,
  );

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchDeleteDialog, setShowBatchDeleteDialog] = useState(false);

  // Import dialog state
  const [importData, setImportData] = useState<TemplateExport | null>(null);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");

  // Load templates on mount
  useEffect(() => {
    if (!isLoaded) {
      loadTemplates();
    }
  }, [isLoaded, loadTemplates]);

  // Export all templates
  const handleExportAll = () => {
    if (templates.length === 0) {
      toast({
        title: t("templates.noTemplatesToExport"),
        description: t("templates.createSomeFirst"),
        variant: "destructive",
      });
      return;
    }

    const data = exportTemplates();
    downloadJson(data, "wavespeed-templates.json");
    toast({
      title: t("templates.templatesExported"),
      description: t("templates.exportedCount", { count: templates.length }),
    });
  };

  // Export single template
  const handleExportSingle = (template: Template) => {
    const data = exportTemplates([template.id]);
    const fileName = `${template.name.toLowerCase().replace(/\s+/g, "-")}.json`;
    downloadJson(data, fileName);
    toast({
      title: t("templates.templateExported"),
      description: t("templates.exported", { name: template.name }),
    });
  };

  // Download JSON helper
  const downloadJson = (data: TemplateExport, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Handle file selection for import
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(
          event.target?.result as string,
        ) as TemplateExport;
        if (!data.templates || !Array.isArray(data.templates)) {
          throw new Error("Invalid file format");
        }
        setImportData(data);
      } catch {
        toast({
          title: t("templates.invalidFile"),
          description: t("templates.invalidFileDesc"),
          variant: "destructive",
        });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Handle import confirmation
  const handleImportConfirm = () => {
    if (!importData) return;

    try {
      const result = importTemplates(importData, importMode);
      const skippedText =
        result.skipped > 0
          ? t("templates.skippedCount", { count: result.skipped })
          : "";
      toast({
        title: t("templates.templatesImported"),
        description: t("templates.importedCount", {
          imported: result.imported,
          skipped: skippedText,
        }),
      });
    } catch (err) {
      toast({
        title: t("templates.importFailed"),
        description: err instanceof Error ? err.message : t("common.error"),
        variant: "destructive",
      });
    }
    setImportData(null);
  };

  // Group templates by model
  const groupedTemplates = useMemo(() => {
    const filtered = searchQuery
      ? templates.filter(
          (t) =>
            fuzzyMatch(searchQuery, t.name) ||
            fuzzyMatch(searchQuery, t.modelName),
        )
      : templates;

    const groups: Record<string, { modelName: string; templates: Template[] }> =
      {};

    for (const template of filtered) {
      if (!groups[template.modelId]) {
        groups[template.modelId] = {
          modelName: template.modelName,
          templates: [],
        };
      }
      groups[template.modelId].templates.push(template);
    }

    for (const group of Object.values(groups)) {
      group.templates.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    }

    return groups;
  }, [templates, searchQuery]);

  const handleUseTemplate = (template: Template) => {
    navigate(
      `/playground/${encodeURIComponent(template.modelId)}?template=${template.id}`,
    );
  };

  const handleEditTemplate = (template: Template) => {
    setEditingTemplate(template);
    setEditName(template.name);
  };

  const handleSaveEdit = () => {
    if (!editingTemplate || !editName.trim()) return;

    updateTemplate(editingTemplate.id, { name: editName.trim() });
    toast({
      title: t("templates.templateUpdated", "Template updated"),
      description: t("templates.renamedTo", { name: editName.trim() }),
    });
    setEditingTemplate(null);
    setEditName("");
  };

  const handleDeleteTemplate = () => {
    if (!deletingTemplate) return;

    deleteTemplate(deletingTemplate.id);
    toast({
      title: t("templates.templateDeleted", "Template deleted"),
      description: t("templates.deleted", { name: deletingTemplate.name }),
    });
    setDeletingTemplate(null);
  };

  // Batch selection helpers
  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    deleteTemplates(Array.from(selectedIds));
    toast({
      title: t("templates.templatesDeleted"),
      description: t("templates.deletedCount", { count: selectedIds.size }),
    });
    setSelectedIds(new Set());
    setShowBatchDeleteDialog(false);
  };

  const modelIds = Object.keys(groupedTemplates);

  return (
    <div className="p-4 pb-20">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold">{t("templates.title")}</h1>
        <p className="text-muted-foreground text-sm">
          {t("templates.description")}
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("templates.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Action Buttons - Mobile optimized layout */}
      <div className="flex gap-2 mb-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="mr-1.5 h-4 w-4" />
          {t("templates.import")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={handleExportAll}
          disabled={templates.length === 0}
        >
          <Download className="mr-1.5 h-4 w-4" />
          {t("templates.exportAll")}
        </Button>
      </div>

      {/* Batch Delete Button */}
      {selectedIds.size > 0 && (
        <Button
          variant="destructive"
          size="sm"
          className="w-full mb-4"
          onClick={() => setShowBatchDeleteDialog(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t("templates.deleteSelected", { count: selectedIds.size })}
        </Button>
      )}

      {/* Templates List */}
      {templates.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <FolderOpen className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2">
                {t("templates.noTemplates")}
              </h3>
              <p className="text-sm">{t("templates.noTemplatesDesc")}</p>
            </div>
          </CardContent>
        </Card>
      ) : modelIds.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Search className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2">
                {t("templates.noResults")}
              </h3>
              <p className="text-sm">{t("templates.noResultsDesc")}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {modelIds.map((modelId) => {
            const group = groupedTemplates[modelId];
            return (
              <Card key={modelId}>
                <CardHeader className="pb-2 px-4 pt-4">
                  <CardTitle className="text-base">{group.modelName}</CardTitle>
                  <CardDescription className="text-xs">
                    {t("templates.templateCount", {
                      count: group.templates.length,
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="space-y-2">
                    {group.templates.map((template) => (
                      <div
                        key={template.id}
                        className="flex items-center gap-2 p-3 rounded-lg border"
                      >
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={selectedIds.has(template.id)}
                          onChange={() => toggleSelection(template.id)}
                          className="h-4 w-4 rounded border-gray-300 shrink-0"
                        />

                        {/* Template info */}
                        <div
                          className="flex-1 min-w-0"
                          onClick={() => handleUseTemplate(template)}
                        >
                          <p className="font-medium text-sm truncate">
                            {template.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(template.updatedAt).toLocaleDateString()}
                          </p>
                        </div>

                        {/* Use button */}
                        <Button
                          size="sm"
                          variant="default"
                          className="h-8 px-3 shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUseTemplate(template);
                          }}
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>

                        {/* More actions dropdown */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleEditTemplate(template)}
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              {t("templates.rename")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleExportSingle(template)}
                            >
                              <Download className="mr-2 h-4 w-4" />
                              {t("templates.export")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDeletingTemplate(template)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {t("common.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog
        open={!!editingTemplate}
        onOpenChange={(open) => !open && setEditingTemplate(null)}
      >
        <DialogContent className="max-w-[90vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("templates.renameTemplate")}</DialogTitle>
            <DialogDescription>{t("templates.renameDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editTemplateName">
                {t("templates.templateName")}
              </Label>
              <Input
                id="editTemplateName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t("templates.templateNamePlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && editName.trim()) {
                    handleSaveEdit();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setEditingTemplate(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              className="flex-1"
              onClick={handleSaveEdit}
              disabled={!editName.trim()}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deletingTemplate}
        onOpenChange={(open) => !open && setDeletingTemplate(null)}
      >
        <DialogContent className="max-w-[90vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("templates.deleteTemplate")}</DialogTitle>
            <DialogDescription>
              {t("templates.deleteConfirm", { name: deletingTemplate?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDeletingTemplate(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleDeleteTemplate}
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog
        open={!!importData}
        onOpenChange={(open) => !open && setImportData(null)}
      >
        <DialogContent className="max-w-[90vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("templates.importTemplates")}</DialogTitle>
            <DialogDescription>
              {t("templates.foundTemplates", {
                count: importData?.templates.length || 0,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-3">
              <Label>{t("templates.importMode")}</Label>
              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    value="merge"
                    checked={importMode === "merge"}
                    onChange={() => setImportMode("merge")}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium text-sm">
                      {t("templates.merge")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("templates.mergeDesc")}
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    value="replace"
                    checked={importMode === "replace"}
                    onChange={() => setImportMode("replace")}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium text-sm">
                      {t("templates.replaceAll")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("templates.replaceAllDesc")}
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setImportData(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button className="flex-1" onClick={handleImportConfirm}>
              {t("templates.import")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Delete Confirmation Dialog */}
      <Dialog
        open={showBatchDeleteDialog}
        onOpenChange={setShowBatchDeleteDialog}
      >
        <DialogContent className="max-w-[90vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("templates.deleteTemplates")}</DialogTitle>
            <DialogDescription>
              {t("templates.batchDeleteConfirm", { count: selectedIds.size })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowBatchDeleteDialog(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleBatchDelete}
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
