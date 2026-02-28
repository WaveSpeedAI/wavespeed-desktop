import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KeyRound } from "lucide-react";

interface ApiKeyRequiredProps {
  description?: string;
}

export function ApiKeyRequired({ description }: ApiKeyRequiredProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex h-full items-center justify-center">
      <Card className="max-w-md">
        <CardHeader className="text-center">
          <KeyRound className="mx-auto h-12 w-12 text-muted-foreground" />
          <CardTitle>{t("apiKeyRequired.title")}</CardTitle>
          <CardDescription>
            {description || t("apiKeyRequired.defaultDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button onClick={() => navigate("/settings")}>
            {t("apiKeyRequired.goToSettings")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
