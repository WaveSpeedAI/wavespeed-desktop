import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { KeyRound } from 'lucide-react'

interface ApiKeyRequiredProps {
  description?: string
}

export function ApiKeyRequired({
  description = "Please configure your WaveSpeed API key in Settings to continue."
}: ApiKeyRequiredProps) {
  const navigate = useNavigate()

  return (
    <div className="flex h-full items-center justify-center">
      <Card className="max-w-md">
        <CardHeader className="text-center">
          <KeyRound className="mx-auto h-12 w-12 text-muted-foreground" />
          <CardTitle>API Key Required</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button onClick={() => navigate('/settings')}>
            Go to Settings
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
