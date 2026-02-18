/**
 * useCodeMirrorTheme — 根据当前明暗模式返回 CM6 排版主题 Extension
 * 包含 Markdown 标题分级高亮 + 语法着色 + 排版布局覆盖 + accent color 点缀
 */
import { useMemo } from 'react'
import { useTheme } from 'antd-style'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const PROSE_FONT_FAMILY = [
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif'
].join(', ')

const CODE_FONT_FAMILY = '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace'

interface SyntaxPalette {
  heading: string
  strong: string
  emphasis: string
  strikethrough: string
  link: string
  url: string
  code: string
  codeBg: string
  quote: string
  listMarker: string
  meta: string
  separator: string
  keyword: string
  string: string
  number: string
  comment: string
  function: string
  typeName: string
  operator: string
  variable: string
  bool: string
  tag: string
  attribute: string
}

const LIGHT_PALETTE: SyntaxPalette = {
  heading: '#0550ae',
  strong: '#24292f',
  emphasis: '#6639ba',
  strikethrough: '#8b949e',
  link: '#0969da',
  url: '#6e7781',
  code: '#cf222e',
  codeBg: 'rgba(175,184,193,0.2)',
  quote: '#57606a',
  listMarker: '#0550ae',
  meta: '#8b949e',
  separator: '#d0d7de',
  keyword: '#cf222e',
  string: '#0a3069',
  number: '#0550ae',
  comment: '#6e7781',
  function: '#8250df',
  typeName: '#0550ae',
  operator: '#cf222e',
  variable: '#953800',
  bool: '#0550ae',
  tag: '#116329',
  attribute: '#0550ae'
}

const DARK_PALETTE: SyntaxPalette = {
  heading: '#79c0ff',
  strong: '#e6edf3',
  emphasis: '#d2a8ff',
  strikethrough: '#8b949e',
  link: '#58a6ff',
  url: '#8b949e',
  code: '#ffa657',
  codeBg: 'rgba(110,118,129,0.25)',
  quote: '#8b949e',
  listMarker: '#79c0ff',
  meta: '#8b949e',
  separator: '#30363d',
  keyword: '#ff7b72',
  string: '#a5d6ff',
  number: '#79c0ff',
  comment: '#8b949e',
  function: '#d2a8ff',
  typeName: '#79c0ff',
  operator: '#ff7b72',
  variable: '#ffa657',
  bool: '#79c0ff',
  tag: '#7ee787',
  attribute: '#79c0ff'
}

const typographyHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading1, fontSize: '2.5em', fontWeight: 'bold', lineHeight: '1.25' },
    { tag: tags.heading2, fontSize: '2em', fontWeight: 'bold', lineHeight: '1.25' },
    { tag: tags.heading3, fontSize: '1.5em', fontWeight: 'bold', lineHeight: '1.25' },
    { tag: tags.heading4, fontSize: '1.25em', fontWeight: 'bold', lineHeight: '1.25' },
    { tag: tags.heading5, fontSize: '1em', fontWeight: 'bold', lineHeight: '1.25' },
    { tag: tags.heading6, fontSize: '1em', fontWeight: 'bold', lineHeight: '1.25' },
    { tag: tags.monospace, fontFamily: CODE_FONT_FAMILY, fontSize: '0.875em' }
  ])
)

function buildColoredHighlight(c: SyntaxPalette) {
  return syntaxHighlighting(
    HighlightStyle.define([
      {
        tag: tags.heading1,
        fontSize: '2.5em',
        fontWeight: 'bold',
        lineHeight: '1.25',
        color: c.heading
      },
      {
        tag: tags.heading2,
        fontSize: '2em',
        fontWeight: 'bold',
        lineHeight: '1.25',
        color: c.heading
      },
      {
        tag: tags.heading3,
        fontSize: '1.5em',
        fontWeight: 'bold',
        lineHeight: '1.25',
        color: c.heading
      },
      {
        tag: tags.heading4,
        fontSize: '1.25em',
        fontWeight: 'bold',
        lineHeight: '1.25',
        color: c.heading
      },
      {
        tag: tags.heading5,
        fontSize: '1em',
        fontWeight: 'bold',
        lineHeight: '1.25',
        color: c.heading
      },
      {
        tag: tags.heading6,
        fontSize: '1em',
        fontWeight: 'bold',
        lineHeight: '1.25',
        color: c.heading
      },

      { tag: tags.strong, fontWeight: 'bold', color: c.strong },
      { tag: tags.emphasis, fontStyle: 'italic', color: c.emphasis },
      { tag: tags.strikethrough, textDecoration: 'line-through', color: c.strikethrough },

      { tag: tags.link, color: c.link, textDecoration: 'underline' },
      { tag: tags.url, color: c.url },

      { tag: tags.monospace, fontFamily: CODE_FONT_FAMILY, fontSize: '0.875em', color: c.code },

      { tag: tags.quote, color: c.quote, fontStyle: 'italic' },

      { tag: tags.processingInstruction, color: c.meta },
      { tag: tags.meta, color: c.meta },
      { tag: tags.contentSeparator, color: c.separator },

      { tag: tags.keyword, color: c.keyword },
      { tag: tags.string, color: c.string },
      { tag: tags.number, color: c.number },
      { tag: tags.comment, color: c.comment, fontStyle: 'italic' },
      { tag: tags.function(tags.variableName), color: c.function },
      { tag: tags.typeName, color: c.typeName },
      { tag: tags.operator, color: c.operator },
      { tag: tags.variableName, color: c.variable },
      { tag: tags.bool, color: c.bool },
      { tag: tags.tagName, color: c.tag },
      { tag: tags.attributeName, color: c.attribute },
      { tag: tags.attributeValue, color: c.string },
      { tag: tags.definition(tags.variableName), color: c.function },
      { tag: tags.propertyName, color: c.variable },
      { tag: tags.className, color: c.typeName },
      { tag: tags.regexp, color: c.string },
      { tag: tags.self, color: c.keyword },
      { tag: tags.null, color: c.bool }
    ])
  )
}

function alpha(hex: string, a: number): string {
  const c = hex.replace('#', '')
  const r = parseInt(c.substring(0, 2), 16)
  const g = parseInt(c.substring(2, 4), 16)
  const b = parseInt(c.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

export { buildColoredHighlight, typographyHighlight, LIGHT_PALETTE, DARK_PALETTE }

export function useCodeMirrorTheme(): Extension {
  const t = useTheme()
  const p = t.colorPrimary

  return useMemo(() => {
    const layoutTheme = EditorView.theme({
      // ── Content typography ──
      '& .cm-content': {
        fontFamily: PROSE_FONT_FAMILY,
        fontSize: '16px',
        lineHeight: '1.8',
        letterSpacing: '0.02em',
        padding: '8px 0',
        caretColor: p,
        '--lobe-markdown-font-size': '16px',
        '--lobe-markdown-header-multiple': '1',
        '--lobe-markdown-margin-multiple': '2',
        '--lobe-markdown-line-height': '1.8',
        '--lobe-markdown-border-radius': String(t.borderRadiusLG),
        '--lobe-markdown-border-color': t.colorFillQuaternary
      },
      '& .cm-scroller': {
        padding: '8px 0'
      },
      '& .cm-line': {
        paddingRight: '16px'
      },

      // ── Live Preview: line decorations (must live in theme to beat baseTheme specificity) ──
      '& .cm-lp-h1': {
        fontWeight: 'bold',
        lineHeight: '1.25',
        paddingTop: '10px',
        paddingBottom: '4px'
      },
      '& .cm-lp-h2': {
        fontWeight: 'bold',
        lineHeight: '1.25',
        paddingTop: '8px',
        paddingBottom: '3px'
      },
      '& .cm-lp-h3': {
        fontWeight: 'bold',
        lineHeight: '1.25',
        paddingTop: '6px',
        paddingBottom: '2px'
      },
      '& .cm-lp-h4': {
        fontWeight: 'bold',
        lineHeight: '1.25',
        paddingTop: '4px',
        paddingBottom: '2px'
      },
      '& .cm-lp-h5, & .cm-lp-h6': {
        fontWeight: 'bold',
        lineHeight: '1.25',
        paddingTop: '3px',
        paddingBottom: '2px'
      },
      '& .cm-lp-bq': {
        borderLeft: `solid 4px ${t.colorBorder}`,
        paddingLeft: '1em',
        paddingTop: '0.15em',
        paddingBottom: '0.15em',
        color: t.colorTextSecondary
      },
      '& .cm-lp-codeblock': {
        background: t.colorFillQuaternary,
        fontSize: '13.6px'
      },
      '& .cm-lp-codeblock-first': {
        borderTopLeftRadius: `${t.borderRadiusLG}px`,
        borderTopRightRadius: `${t.borderRadiusLG}px`,
        paddingTop: '0.5em'
      },
      '& .cm-lp-codeblock-last': {
        borderBottomLeftRadius: `${t.borderRadiusLG}px`,
        borderBottomRightRadius: `${t.borderRadiusLG}px`,
        paddingBottom: '0.5em'
      },

      // ── Line numbers — minimal ──
      '& .cm-gutters': {
        borderRight: 'none',
        backgroundColor: 'transparent',
        color: t.isDarkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
        fontFamily: '"SFMono-Regular", Consolas, monospace',
        fontSize: '11px',
        minWidth: 'auto'
      },
      '& .cm-gutter.cm-lineNumbers': {
        minWidth: 'auto'
      },
      '& .cm-gutter.cm-lineNumbers .cm-gutterElement': {
        padding: '0 6px 0 8px',
        minWidth: '24px',
        textAlign: 'right',
        lineHeight: '1.8',
        opacity: '0.7',
        transition: 'opacity 0.15s, color 0.15s'
      },
      '& .cm-gutter.cm-lineNumbers .cm-activeLineGutter': {
        opacity: '1',
        color: t.colorTextSecondary
      },

      // ── Fold gutter — visible inline markers ──
      '& .cm-foldGutter': {
        width: '28px',
        minWidth: '28px'
      },
      '& .cm-foldGutter .cm-gutterElement': {
        padding: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        cursor: 'pointer',
        color: t.colorTextTertiary,
        fontSize: '18px',
        transition: 'color 0.12s'
      },
      '& .cm-foldGutter .cm-gutterElement:hover': {
        color: p
      },
      '& .cm-foldGutter .cm-gutterElement span': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '24px',
        height: '24px',
        borderRadius: '6px',
        fontSize: '16px',
        transition: 'background 0.1s, color 0.1s'
      },
      '& .cm-foldGutter .cm-gutterElement:hover span': {
        background: alpha(p, 0.1),
        color: p
      },

      // ── Cursor — accent colored ──
      '& .cm-cursor, & .cm-dropCursor': {
        borderLeftColor: p,
        borderLeftWidth: '2px'
      },

      // ── Active line — subtle accent tint ──
      '.cm-activeLine': {
        backgroundColor: alpha(p, t.isDarkMode ? 0.04 : 0.03),
        borderRadius: '2px'
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent'
      },

      // ── Focus ──
      '&.cm-focused': {
        outline: 'none'
      },

      // ── Selection — accent tint ──
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        background: `${alpha(p, t.isDarkMode ? 0.2 : 0.14)} !important`
      },

      // ── Search matches ──
      '.cm-searchMatch': {
        backgroundColor: alpha(p, 0.12),
        borderRadius: '2px',
        outline: `1px solid ${alpha(p, 0.25)}`
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: alpha(p, 0.25)
      },

      // ── Matching brackets — accent dot ──
      '&.cm-focused .cm-matchingBracket': {
        backgroundColor: alpha(p, 0.12),
        outline: `1px solid ${alpha(p, 0.3)}`,
        borderRadius: '2px'
      },

      // ── Placeholder ──
      '& .cm-placeholder': {
        color: t.colorTextQuaternary,
        fontStyle: 'italic'
      },

      // ── Scrollbar styling ──
      '& .cm-scroller::-webkit-scrollbar': {
        width: '6px',
        height: '6px'
      },
      '& .cm-scroller::-webkit-scrollbar-track': {
        background: 'transparent'
      },
      '& .cm-scroller::-webkit-scrollbar-thumb': {
        background: t.isDarkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
        borderRadius: '3px'
      },
      '& .cm-scroller::-webkit-scrollbar-thumb:hover': {
        background: alpha(p, 0.3)
      }
    })

    return [typographyHighlight, layoutTheme]
  }, [t, p])
}
