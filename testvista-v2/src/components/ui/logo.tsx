import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  iconOnly?: boolean;
}

export function Logo({ className, size = "md", iconOnly = false }: LogoProps) {
  const iconSize = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-12 w-12"
  };

  const textSize = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-2xl"
  };

  const versionSize = {
    sm: "text-xs",
    md: "text-sm", 
    lg: "text-base"
  };

  if (iconOnly) {
    return (
      <img 
        src="/lovable-uploads/8f1b7e00-43c6-40df-9a5a-393392e76de0.png"
        alt="TestVista Logo"
        className={cn(iconSize[size], "object-contain", className)}
      />
    );
  }

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {/* Logo Image */}
      <img 
        src="/lovable-uploads/8f1b7e00-43c6-40df-9a5a-393392e76de0.png"
        alt="TestVista Logo"
        className={cn(iconSize[size], "object-contain")}
      />
      
      <div className="flex flex-col">
        <span className={cn(
          "font-bold text-foreground",
          textSize[size]
        )}>
          TestVista
        </span>
        <span className={cn(
          "text-foreground font-medium inline-flex items-center justify-center px-2 py-1 rounded-full text-xs",
          "bg-[#F9F9FB] border border-border/30",
          size === "sm" && "text-[10px] px-1.5 py-0.5",
          size === "lg" && "text-sm px-3 py-1.5"
        )}>
          Ver 2.0.0
        </span>
      </div>
    </div>
  );
}