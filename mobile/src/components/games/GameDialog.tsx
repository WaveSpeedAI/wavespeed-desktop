import { X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { FlappyBird } from './FlappyBird'

interface GameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GameDialog({ open, onOpenChange }: GameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[95vw] h-[80vh] max-h-[600px] p-0 gap-0 overflow-hidden" hideCloseButton>
        <DialogHeader className="px-4 py-3 border-b flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-lg font-semibold">Mini Game</DialogTitle>
          <DialogDescription className="sr-only">
            Play a fun mini game while waiting
          </DialogDescription>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>
        <div className="flex-1 p-4 overflow-hidden">
          <FlappyBird />
        </div>
      </DialogContent>
    </Dialog>
  )
}
