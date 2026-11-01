/// <reference types="node" />
import antfu from '@antfu/eslint-config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import { PlainTextParser } from 'eslint-plugin-obsidianmd/dist/lib/plainTextParser.js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const antfuConfigs = await antfu(
  {
    typescript: { tsconfigPath: 'tsconfig.json' },
    svelte: true,
    antislop: true,
    stylistic: { semi: true },
    ignores: [
      '.agents/**',
      '.claude/**',
      '.mastracode/**',
      '.vscode/**',
      'main.js',
      'skills-lock.json',
      '**/*.md',
      'styles.css',
    ],
  },
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.mts', 'esbuild.config.mjs', 'manifest.json'],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.json', '.svelte'],
      },
    },
  },
)
  // Obsidian's preset registers eslint-plugin-import and eslint-comments under the same names antfu uses.
  .renamePlugins({ 'import': 'import-lite', 'eslint-comments': 'antfu-eslint-comments' });

const testDependencies = {
  // Tests run outside Obsidian and need their own moment; the plugin uses the one Obsidian provides.
  files: ['package.json'],
  rules: {
    'depend/ban-dependencies': [
      'error',
      {
        allowed: ['moment'],
      },
    ],
  },
} as const;

// Obsidian checks package.json with ESLint's JSON language, which antfu's code rules can't read.
const notPackageJson = antfuConfigs.map(config => config.files || !config.rules
  ? config
  : {
      ...config,
      ignores: [
        ...config.ignores ?? [],
        'package.json',
      ],
    });

// Obsidian's manifest check reads manifest.json as the TypeScript parser sees it, so antfu's JSON rules skip it.
const notManifest = notPackageJson.map(config => config.files || config.rules
  ? {
      ...config,
      ignores: [
        ...config.ignores ?? [],
        'manifest.json',
      ],
    }
  : config);

// The checks the directory runs on the files it publishes or shows: manifest, license and Svelte components.
const obsidianRules = Object.fromEntries(obsidianmd.configs.recommended
  .flatMap(config => Object.entries(config.rules ?? {}))
  .filter(([name]) => name.startsWith('obsidianmd/') && name !== 'obsidianmd/rule-custom-message'));
const obsidianFiles = [
  {
    files: ['manifest.json'],
    plugins: { obsidianmd },
    languageOptions: { parser: tseslint.parser },
    rules: { 'obsidianmd/validate-manifest': 'error' },
  },
  {
    files: ['LICENSE'],
    plugins: { obsidianmd },
    languageOptions: { parser: PlainTextParser },
    rules: { 'obsidianmd/validate-license': 'error' },
  },
  {
    files: ['src/**/*.svelte'],
    plugins: { obsidianmd },
    rules: obsidianRules,
  },
] as const;

// Obsidian's rules are for plugin code in src; scripts and tests run in Node. Its package.json checks stay.
const obsidianPlugin = obsidianmd.configs.recommended.map(config =>
  config.files?.includes('package.json')
    ? config
    : {
        ...config,
        basePath: 'src',
        ignores: [
          ...config.ignores ?? [],
          '**/__tests__/**',
        ],
      });

export default [
  ...notManifest,
  ...obsidianPlugin,
  ...obsidianFiles,
  testDependencies,
  {
    // Obsidian marks APIs it is phasing out as deprecated; the review checklist asks plugins to avoid them.
    files: ['src/**/*.ts', 'src/**/*.svelte'],
    rules: { 'ts/no-deprecated': 'error' },
  },
];
