import js from '@eslint/js';
import globals from 'globals';
import ts from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import path from 'node:path';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	{
		languageOptions: {
			globals: globals.node,
		},
		rules: {
			'no-undef': 'off',
		},
	},
	{
		rules: {},
	},
	prettier,
);
