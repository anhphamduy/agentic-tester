import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Minimize2, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const FullScreenModal = DialogPrimitive.Root;

const FullScreenModalTrigger = DialogPrimitive.Trigger;

const FullScreenModalPortal = DialogPrimitive.Portal;

const FullScreenModalClose = DialogPrimitive.Close;

const FullScreenModalOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
FullScreenModalOverlay.displayName = DialogPrimitive.Overlay.displayName;

const FullScreenModalContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    title?: string;
  }
>(({ className, children, title, ...props }, ref) => (
  <FullScreenModalPortal>
    <FullScreenModalOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 flex flex-col bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-card">
        <div className="flex items-center gap-3">
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="sm" className="gap-2 h-8">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </DialogPrimitive.Close>
          <div className="flex items-center gap-2">
            <Minimize2 className="h-4 w-4 text-muted-foreground" />
            <h1 className="font-semibold text-lg">
              {title || "Full Screen View"}
            </h1>
          </div>
        </div>
        <DialogPrimitive.Close className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </div>
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </DialogPrimitive.Content>
  </FullScreenModalPortal>
));
FullScreenModalContent.displayName = DialogPrimitive.Content.displayName;

export {
  FullScreenModal,
  FullScreenModalPortal,
  FullScreenModalOverlay,
  FullScreenModalTrigger,
  FullScreenModalContent,
  FullScreenModalClose,
};