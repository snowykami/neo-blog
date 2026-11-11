import { useTranslations } from 'next-intl'
import { useCallback } from 'react'

/**
 * 配色（blue、green…）的显示名，跟随界面语言；没有文案的配色（如旧版本保存的值）原样显示。
 * 单独成文件，后台页面引用时不会把前台配色面板的其他文案一起带进作用域
 */
export function useColorSchemeName() {
  const t = useTranslations('ColorScheme')
  return useCallback((scheme: string) => (t.has(`names.${scheme}`) ? t(`names.${scheme}`) : scheme), [t])
}
