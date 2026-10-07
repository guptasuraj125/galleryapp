import Image from "next/image";
import Link from "next/link";

interface BrandMarkProps {
  href?: string;
  compact?: boolean;
}

export function BrandMark({ href = "/", compact = false }: BrandMarkProps) {
  return (
    <Link aria-label="ghumi.ghumi home" className="brand-lockup" href={href}>
      {compact
        ? <span aria-hidden="true" className="brand-compact-mark">g.</span>
        : <Image alt="" className="brand-logo" height={400} priority src="/brand/ghumi-logo.png" width={1150} />}
    </Link>
  );
}
