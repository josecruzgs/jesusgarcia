"use client";

import { SiFacebook, SiInstagram, SiTiktok, SiX } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa6";
import { SlidersHorizontal } from "lucide-react";
import type { IconType } from "react-icons";

const PLATFORM_ICONS: Record<string, IconType> = {
  facebook: SiFacebook,
  instagram: SiInstagram,
  tiktok: SiTiktok,
  x: SiX,
  linkedin: FaLinkedin,
};

// Clases completas y literales a propósito (no interpoladas): el scanner de
// Tailwind necesita verlas escritas tal cual en el código para generarlas.
const PLATFORM_SELECTED_CLASS: Record<string, string> = {
  facebook: "border-brand-facebook bg-brand-facebook/10 text-brand-facebook",
  instagram: "border-brand-instagram bg-brand-instagram/10 text-brand-instagram",
  tiktok: "border-brand-tiktok bg-brand-tiktok/10 text-brand-tiktok",
  x: "border-brand-x bg-brand-x/10 text-brand-x",
  linkedin: "border-brand-linkedin bg-brand-linkedin/10 text-brand-linkedin",
};
const DEFAULT_SELECTED_CLASS = "border-primary bg-primary/10 text-primary";

export default function PlatformPicker({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const Icon = PLATFORM_ICONS[opt.key] ?? SlidersHorizontal;
        const selected = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all duration-150 ${
              selected ? (PLATFORM_SELECTED_CLASS[opt.key] ?? DEFAULT_SELECTED_CLASS) : "border-hairline text-ink-secondary hover:bg-page hover:text-ink"
            }`}
          >
            <Icon className="h-4 w-4" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
