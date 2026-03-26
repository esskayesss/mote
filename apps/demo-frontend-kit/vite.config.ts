import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const certsDirectory = path.resolve(currentDirectory, '../../certs');
const cert = fs.readFileSync(path.join(certsDirectory, 'joi.thrush-dab.ts.net.crt'));
const key = fs.readFileSync(path.join(certsDirectory, 'joi.thrush-dab.ts.net.key'));

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		host: '0.0.0.0',
		https: {
			cert,
			key
		},
		allowedHosts: ['joi.thrush-dab.ts.net'],
		port: 5174
	},
	preview: {
		host: '0.0.0.0',
		https: {
			cert,
			key
		},
		allowedHosts: ['joi.thrush-dab.ts.net'],
		port: 4174
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
