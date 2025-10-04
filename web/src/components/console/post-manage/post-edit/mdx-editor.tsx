import {
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  directivesPlugin,
  frontmatterPlugin,
  headingsPlugin,
  imagePlugin,
  jsxPlugin,
  linkPlugin,
  linkDialogPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  sandpackPlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  MDXEditor,
  MDXEditorMethods,
  MDXEditorProps,
  // tool bar
  UndoRedo,
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ChangeAdmonitionType,
  AdmonitionDirectiveDescriptor,
  ChangeCodeMirrorLanguage,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertAdmonition,
  InsertCodeBlock,
  InsertFrontmatter,
  InsertImage,
  InsertSandpack,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  ShowSandpackInfo,
  SandpackConfig,
} from "@mdxeditor/editor";
import { ForwardedRef } from "react";
import '@mdxeditor/editor/style.css';

const codeBlockLanguages = {
  py: "Python",
  cpp: "C++",
  c: "C",
  java: "Java",
  json: "JSON",
  css: "CSS",
  html: "HTML",
  yaml: "YAML",
  markdown: "Markdown",
  r: "R",
  rb: "Ruby",
  php: "PHP",
  go: "Go",
  bash: "Shell",
  lua: "Lua",
  swift: "Swift",
  kt: "Kotlin",
  kts: "Kotlin",
  dart: "Dart",
  js: "JavaScript",
  jsx: "JavaScriptX",
  ts: "TypeScript",
  tsx: "TypeScriptX",
}

const defaultSnippetContent = `
export default function App() {
  return (
    <div className="App">
      <h1>Hello CodeSandbox</h1>
      <h2>Start editing to see some magic happen!</h2>
    </div>
  );
}
`.trim()

const simpleSandpackConfig: SandpackConfig = {
  defaultPreset: 'react',
  presets: [
    {
      label: 'React',
      name: 'react',
      meta: 'live react',
      sandpackTemplate: 'react',
      sandpackTheme: 'light',
      snippetFileName: '/App.js',
      snippetLanguage: 'jsx',
      initialSnippetContent: defaultSnippetContent
    }
  ]
}


export function InitializedMDXEditor({
  editorRef,
  ...props
}: { editorRef: ForwardedRef<MDXEditorMethods> | null } & MDXEditorProps) {
  return (
    <MDXEditor
      {...props}
      ref={editorRef}
      plugins={[
        codeBlockPlugin({ defaultCodeBlockLanguage: 'yaml' }),
        codeMirrorPlugin({
          codeBlockLanguages: codeBlockLanguages
        }),
        diffSourcePlugin(),
        directivesPlugin({
          directiveDescriptors: [AdmonitionDirectiveDescriptor],
        }),
        frontmatterPlugin(),
        headingsPlugin(),
        imagePlugin(),
        jsxPlugin(),
        linkPlugin(),
        linkDialogPlugin(),
        listsPlugin(),
        markdownShortcutPlugin(),
        quotePlugin(),
        sandpackPlugin({ sandpackConfig: simpleSandpackConfig }),
        tablePlugin(),
        thematicBreakPlugin(),
        toolbarPlugin({
          toolbarClassName: 'mdx-toolbar',
          toolbarContents: () => (
            <>
              <DiffSourceToggleWrapper>
                <UndoRedo />
                <BoldItalicUnderlineToggles />
                <BlockTypeSelect />
                {/* <ChangeAdmonitionType /> */}

                {/* <ChangeCodeMirrorLanguage /> */}
                <CodeToggle />
                <CreateLink />
                <InsertAdmonition />
                <InsertCodeBlock />
                <InsertFrontmatter />
                <InsertImage />
                <InsertSandpack />
                <InsertTable />
                <InsertThematicBreak />
                <ListsToggle />
                {/* <ShowSandpackInfo /> */}
              </DiffSourceToggleWrapper>
            </>
          )
        }),
      ]}

    />
  )
}