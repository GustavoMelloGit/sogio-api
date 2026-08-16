export function scalarUiHtml(
  specUrl: string,
  opts?: { signInPath?: string }
): string {
  const autoAuthScript = opts?.signInPath
    ? `
      const requestUrl = typeof input === 'string' ? input : input.url;
      if (requestUrl.endsWith('${opts.signInPath}') && response.ok) {
        response
          .clone()
          .json()
          .then((body) => {
            const token = body?.token;
            if (!token) return;
            localStorage.setItem('scalar_bearer_token', token);
            instance.updateConfiguration({
              ...instance.getConfiguration(),
              authentication: {
                ...(instance.getConfiguration().authentication ?? {}),
                securitySchemes: { bearerAuth: { token } },
              },
            });
          })
          .catch(() => {});
      }`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sogio API Docs</title>
    <style>
      body { margin: 0; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>
      const savedToken = localStorage.getItem('scalar_bearer_token');

      const instance = Scalar.createApiReference('#app', {
        url: '${specUrl}',
        theme: 'purple',
        persistAuth: true,
        mcp: {
          name: 'Sogio MCP',
          url: window.location.origin + '/mcp',
        },
        authentication: savedToken
          ? { securitySchemes: { bearerAuth: { token: savedToken } } }
          : undefined,
        customFetch: async (input, init) => {
          const response = await window.fetch(input, init);${autoAuthScript}
          return response;
        },
      });
    </script>
  </body>
</html>`;
}
