'use client';

import { useState } from 'react';
import { LanguagesIcon } from 'lucide-react';

import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import {
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@/features/i18n/config';
import { getSavedLocale, saveLocale } from '@/features/i18n/locale';
import { useTranslations } from 'next-intl';

/**
 * Selector de idioma implementado como submenú, pensado para vivir
 * dentro del menú de cuenta del Header. Al seleccionar un idioma se
 * persiste en la cookie `NEXT_LOCALE` y se recarga la página para que
 * el middleware y `next-intl` resuelvan el nuevo locale en SSR.
 */
export function LocaleSwitcher() {
  const t = useTranslations('Common');
  const [current, setCurrent] = useState<SupportedLocale>(
    getSavedLocale() ?? DEFAULT_LOCALE
  );

  const handleChange = (locale: SupportedLocale) => {
    if (locale === current) return;
    saveLocale(locale);
    setCurrent(locale);
    window.location.reload();
  };

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="w-full">
        <LanguagesIcon className="size-4" />
        <span className="flex-1">{t('language')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => handleChange(value as SupportedLocale)}
        >
          {SUPPORTED_LOCALES.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale}>
              {LOCALE_LABELS[locale]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
