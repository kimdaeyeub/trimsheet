export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.pathname.startsWith('/api/')) {
			// Hand the request to the backend unchanged and return its response as-is,
			// so SSE streams from the Flue agent router are not buffered.
			return env.BACKEND.fetch(request);
		}
		return new Response(null, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
