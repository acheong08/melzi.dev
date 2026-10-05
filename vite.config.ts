import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { researchProviderConfig, researchCspSources } from './src/lib/research/provider-config.js';

type KitOptions = NonNullable<Parameters<typeof sveltekit>[0]>;
type CspDirectives = NonNullable<NonNullable<KitOptions['csp']>['directives']>;

export default defineConfig(({ command, mode }) => {
	const config = researchProviderConfig(loadEnv(mode, process.cwd(), 'VITE_'), command === 'build');
	const sources = researchCspSources(config);
	return {
		plugins: [
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				adapter: adapter(),
				prerender: { entries: ['*'] },
				csp: command === 'build' || process.env.NODE_ENV === 'production' ? {
					mode: 'hash',
					directives: {
						'default-src': ['self'],
						'base-uri': ['none'],
						'object-src': ['none'],
						'script-src': sources.script as CspDirectives['script-src'],
						'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
						'font-src': ['self', 'https://fonts.gstatic.com'],
						'img-src': ['self', 'data:'],
						'connect-src': sources.connect as CspDirectives['connect-src'],
						'frame-src': sources.frame as CspDirectives['frame-src'],
						'form-action': ['self']
					}
				} : undefined
			})
		]
	};
});
