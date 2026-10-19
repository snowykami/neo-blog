'use client'

import type { Editor } from '@tiptap/react'
// --- UI Primitives ---
import type { ButtonProps } from '@/components/tiptap-ui-primitive/button'

// --- Tiptap UI ---
import type { UseLinkPopoverConfig } from '@/components/tiptap-ui/link-popover'
import { useTranslations } from 'next-intl'
import * as React from 'react'

// --- Icons ---
import { CornerDownLeftIcon } from '@/components/tiptap-icons/corner-down-left-icon'
import { ExternalLinkIcon } from '@/components/tiptap-icons/external-link-icon'
import { LinkIcon } from '@/components/tiptap-icons/link-icon'
import { TrashIcon } from '@/components/tiptap-icons/trash-icon'

import { Button, ButtonGroup } from '@/components/tiptap-ui-primitive/button'
import { Card, CardBody, CardItemGroup } from '@/components/tiptap-ui-primitive/card'

import { Input, InputGroup } from '@/components/tiptap-ui-primitive/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/tiptap-ui-primitive/popover'
import { Separator } from '@/components/tiptap-ui-primitive/separator'
import { useLinkPopover } from '@/components/tiptap-ui/link-popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
// --- Hooks ---
import { useIsMobile } from '@/hooks/use-mobile'
import { useTiptapEditor } from '@/hooks/use-tiptap-editor'

export interface LinkMainProps {
  /**
   * The URL to set for the link.
   */
  url: string
  /**
   * Function to update the URL state.
   */
  setUrl: React.Dispatch<React.SetStateAction<string | null>>
  /**
   * Function to set the link in the editor.
   */
  setLink: () => void
  /**
   * Function to remove the link from the editor.
   */
  removeLink: () => void
  /**
   * Function to open the link.
   */
  openLink: () => void
  /**
   * Whether the link is currently active in the editor.
   */
  isActive: boolean
  /**
   * 是否自动匹配全文相同词语，不传 onAutoMatchChange 时不显示勾选框
   */
  autoMatch?: boolean
  onAutoMatchChange?: (autoMatch: boolean) => void
}

export interface LinkPopoverProps extends Omit<ButtonProps, 'type'>, UseLinkPopoverConfig {
  /**
   * Callback for when the popover opens or closes.
   */
  onOpenChange?: (isOpen: boolean) => void
  /**
   * Whether to automatically open the popover when a link is active.
   * @default true
   */
  autoOpenOnLinkActive?: boolean
}

/**
 * Link button component for triggering the link popover
 */
export const LinkButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <Button
        type="button"
        className={className}
        data-style="ghost"
        role="button"
        tabIndex={-1}
        aria-label="Link"
        tooltip="Link"
        ref={ref}
        {...props}
      >
        {children || <LinkIcon className="tiptap-button-icon" />}
      </Button>
    )
  },
)

LinkButton.displayName = 'LinkButton'

/**
 * Main content component for the link popover
 */
const LinkMain: React.FC<LinkMainProps> = ({
  url,
  setUrl,
  setLink,
  removeLink,
  openLink,
  isActive,
  autoMatch,
  onAutoMatchChange,
}) => {
  const isMobile = useIsMobile()
  const t = useTranslations('Console.post_edit')

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      setLink()
    }
  }

  return (
    <Card
      style={{
        ...(isMobile ? { boxShadow: 'none', border: 0 } : {}),
      }}
    >
      <CardBody
        style={{
          ...(isMobile ? { padding: 0 } : {}),
        }}
      >
        <CardItemGroup orientation="horizontal">
          <InputGroup>
            <Input
              type="url"
              placeholder="Paste a link..."
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
          </InputGroup>

          <ButtonGroup orientation="horizontal">
            <Button
              type="button"
              onClick={setLink}
              title="Apply link"
              disabled={!url && !isActive}
              data-style="ghost"
            >
              <CornerDownLeftIcon className="tiptap-button-icon" />
            </Button>
          </ButtonGroup>

          <Separator />

          <ButtonGroup orientation="horizontal">
            <Button
              type="button"
              onClick={openLink}
              title="Open in new window"
              disabled={!url && !isActive}
              data-style="ghost"
            >
              <ExternalLinkIcon className="tiptap-button-icon" />
            </Button>

            <Button
              type="button"
              onClick={removeLink}
              title="Remove link"
              disabled={!url && !isActive}
              data-style="ghost"
            >
              <TrashIcon className="tiptap-button-icon" />
            </Button>
          </ButtonGroup>
        </CardItemGroup>
        {onAutoMatchChange && (
          <div className="flex items-center gap-2 pt-2">
            <Checkbox
              id="link-auto-match"
              checked={!!autoMatch}
              onCheckedChange={checked => onAutoMatchChange(checked === true)}
            />
            <Label htmlFor="link-auto-match" className="text-xs font-normal">{t('auto_match')}</Label>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * Link content component for standalone use
 */
export const LinkContent: React.FC<{
  editor?: Editor | null
}> = ({ editor }) => {
  const linkPopover = useLinkPopover({
    editor,
  })

  return <LinkMain {...linkPopover} />
}

/**
 * Link popover component for Tiptap editors.
 *
 * For custom popover implementations, use the `useLinkPopover` hook instead.
 */
export const LinkPopover = React.forwardRef<HTMLButtonElement, LinkPopoverProps>(
  (
    {
      editor: providedEditor,
      hideWhenUnavailable = false,
      onSetLink,
      onOpenChange,
      autoOpenOnLinkActive = true,
      onClick,
      children,
      ...buttonProps
    },
    ref,
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const [isOpen, setIsOpen] = React.useState(false)
    const [autoMatch, setAutoMatch] = React.useState(false)

    const { isVisible, canSet, isActive, url, setUrl, setLink, removeLink, openLink, label, Icon }
      = useLinkPopover({
        editor,
        hideWhenUnavailable,
        onSetLink,
      })

    const handleOnOpenChange = React.useCallback(
      (nextIsOpen: boolean) => {
        // 打开时回填当前链接的自动匹配状态
        if (nextIsOpen && editor)
          setAutoMatch(!!editor.getAttributes('link').autoMatch)
        setIsOpen(nextIsOpen)
        onOpenChange?.(nextIsOpen)
      },
      [onOpenChange, editor],
    )

    const handleSetLink = React.useCallback(() => {
      setLink({ autoMatch })
      setIsOpen(false)
    }, [setLink, autoMatch])

    const handleAutoMatchChange = React.useCallback((checked: boolean) => {
      setAutoMatch(checked)
      // 已有链接时勾选立即生效，无需再点应用
      if (editor && isActive)
        editor.chain().extendMarkRange('link').updateAttributes('link', { autoMatch: checked }).run()
    }, [editor, isActive])

    const handleClick = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented)
          return
        setIsOpen(!isOpen)
      },
      [onClick, isOpen],
    )

    React.useEffect(() => {
      if (autoOpenOnLinkActive && isActive) {
        setAutoMatch(!!editor?.getAttributes('link').autoMatch)
        setIsOpen(true)
      }
    }, [autoOpenOnLinkActive, isActive, editor])

    if (!isVisible) {
      return null
    }

    return (
      <Popover open={isOpen} onOpenChange={handleOnOpenChange}>
        <PopoverTrigger asChild>
          <LinkButton
            disabled={!canSet}
            data-active-state={isActive ? 'on' : 'off'}
            data-disabled={!canSet}
            aria-label={label}
            aria-pressed={isActive}
            onClick={handleClick}
            {...buttonProps}
            ref={ref}
          >
            {children ?? <Icon className="tiptap-button-icon" />}
          </LinkButton>
        </PopoverTrigger>

        <PopoverContent>
          <LinkMain
            url={url}
            setUrl={setUrl}
            setLink={handleSetLink}
            removeLink={removeLink}
            openLink={openLink}
            isActive={isActive}
            autoMatch={autoMatch}
            onAutoMatchChange={handleAutoMatchChange}
          />
        </PopoverContent>
      </Popover>
    )
  },
)

LinkPopover.displayName = 'LinkPopover'

export default LinkPopover
