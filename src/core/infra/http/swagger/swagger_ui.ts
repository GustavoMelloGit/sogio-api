export function swaggerUiHtml(
  specUrl: string,
  opts?: { signInPath?: string }
): string {
  const autoAuthScript = opts?.signInPath
    ? `
        onComplete: () => {
          const saved = localStorage.getItem('swagger_bearer_token');
          if (saved) ui.preauthorizeApiKey('bearerAuth', saved);
        },
        responseInterceptor: (response) => {
          if (response.url.endsWith('${opts.signInPath}') && response.status === 200) {
            const token = response.body?.token;
            if (token) {
              localStorage.setItem('swagger_bearer_token', token);
              ui.preauthorizeApiKey('bearerAuth', token);
            }
          }
          return response;
        },`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sogio API Docs</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"
    />
    <style>
      body { margin: 0; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      let ui;
      ui = SwaggerUIBundle({
        url: '${specUrl}',
        dom_id: '#swagger-ui',
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset,
        ],
        layout: 'BaseLayout',
        deepLinking: true,
        tryItOutEnabled: true,${autoAuthScript}
      });
    </script>
  </body>
</html>`;
}
