import logoLight from "@/assets/logo-light.png";
import logoDark from "@/assets/logo-dark.png";

interface AppLogoProps {
  className?: string;
}

export function AppLogo({ className = "h-10 w-10" }: AppLogoProps) {
  return (
    <>
      <img
        src={logoLight}
        alt="WaveSpeed"
        className={`${className} block dark:hidden object-contain`}
      />
      <img
        src={logoDark}
        alt="WaveSpeed"
        className={`${className} hidden dark:block object-contain`}
      />
    </>
  );
}
