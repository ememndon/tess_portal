import logoImg from "./logo.png";

/**
 * The app logo mark. The image is statically imported so it is served from
 * /_next/static (no auth gating, works on public pages too). Rounded to match
 * the previous mark; pass a className to tune the corner radius per placement.
 */
export function Logo({ size = 22, className = "rounded-[7px]" }: { size?: number; className?: string }) {
  return (
    <img
      src={logoImg.src}
      alt="Tess Portal logo"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}
